// Règles du jeu côté serveur : courses de rue et agents IA (coordonnées x/z en mètres).
import crypto from "node:crypto";
import { PLACES, HALF, roadPath, districtAt, resolvePlace, randomRoadPoint, groundHeight } from "./city.js";
import * as store from "./store.js";

export const BOT_SPEED = 14;         // m/s (~50 km/h) : les agents roulent sagement
const BOT_TURN = 3;                  // rad/s : vitesse de rotation max du véhicule
const RACE_LOBBY_MS = Number(process.env.RACE_LOBBY_MS || 30_000); // délai pour s'inscrire avant le départ
const RACE_GRACE_MS = 45_000;        // après le premier arrivé, les autres ont ce temps pour finir
export const JOIN_RADIUS = 200;      // m : pour s'inscrire, il faut être près de la ligne de départ
const RACE_MAX_MS = 5 * 60_000;
const MAX_SPEED = 45;                // m/s : au-delà, une arrivée est jugée invraisemblable
const PRIZES = [300, 200, 100];
const BOT_VEHICLES = ["sedan", "taxi", "suv", "hatchback-sports", "van"];

export const newId = (p) => `${p}-${crypto.randomBytes(3).toString("hex")}`;

export function placeList() {
  return Object.entries(PLACES).map(([key, p]) => ({ key, label: p.label, x: Math.round(p.x), z: Math.round(p.z) }));
}
export { resolvePlace };

export function raceStatus(race, now = Date.now()) {
  if (now < race.startAt) return "inscriptions";
  if (now < race.startAt + RACE_MAX_MS) return "en cours";
  return "terminée";
}

export async function createRace({ creatorId, creatorName, from, toKey }) {
  const to = resolvePlace(toKey);
  if (!to) throw new Error(`lieu inconnu : ${toKey}`);
  const now = Date.now();
  const race = {
    id: newId("course"),
    creator: creatorId,
    creatorName,
    toKey,
    toLabel: to.label,
    from: { x: Math.round(from.x), z: Math.round(from.z) },
    checkpoints: roadPath(from, to).map((p) => ({ x: Math.round(p.x), z: Math.round(p.z) })),
    createdAt: now,
    startAt: now + RACE_LOBBY_MS,
  };
  await store.saveRace(race);
  await store.joinRace(race.id, creatorId, creatorName);
  await store.publishRace(race.id);
  await store.pushChat({ from: "Radio Kube", text: `${creatorName} lance une course vers ${to.label} ! Départ dans ${Math.round(RACE_LOBBY_MS / 1000)} s : rejoignez-la depuis le téléphone (P, puis Courses).`, ts: now });
  return race;
}

// Contrôle de vraisemblance : impossible d'arriver plus vite qu'une voiture à fond
export function minDurationMs(race) {
  let d = 0, prev = race.from;
  for (const c of race.checkpoints) { d += Math.hypot(c.x - prev.x, c.z - prev.z); prev = c; }
  return (d / MAX_SPEED) * 1000;
}

export async function finish(raceId, playerId, name) {
  const race = await store.loadRace(raceId);
  if (!race) return { ok: false, reason: "course inconnue" };
  const now = Date.now();
  if (raceStatus(race, now) !== "en cours" || (await store.raceClosed(raceId))) return { ok: false, reason: "la course n'est pas en cours" };
  const ms = now - race.startAt;
  if (ms < minDurationMs(race)) return { ok: false, reason: "trop rapide pour être vrai" };
  const entrants = await store.raceEntrants(raceId);
  if (!entrants[playerId]) return { ok: false, reason: "pas inscrit" };
  const place = await store.finishRace(raceId, playerId, ms);
  if (!place) return { ok: false, reason: "déjà arrivé" };
  const prize = PRIZES[place - 1] ?? 50;
  await store.addScore(playerId, name, prize);
  await store.pushChat({ from: "Radio Kube", text: `${name} termine ${place === 1 ? "1er" : `${place}e`} de la course vers ${race.toLabel} en ${(ms / 1000).toFixed(1)} s (+${prize}).`, ts: now });
  await recordStat(playerId, name, "races", 1);
  return { ok: true, place, ms, prize };
}

// Inscription : avant le départ seulement, et près de la ligne de départ (sinon le chrono serait injuste)
export async function joinRace(raceId, playerId, name, pos) {
  const race = await store.loadRace(raceId);
  if (!race) return { ok: false, reason: "course inconnue" };
  if (raceStatus(race) !== "inscriptions") return { ok: false, reason: "les inscriptions sont closes" };
  if (pos && Math.hypot(pos[0] - race.from.x, pos[2] - race.from.z) > JOIN_RADIUS) return { ok: false, reason: `trop loin du départ (à plus de ${JOIN_RADIUS} m)` };
  await store.joinRace(raceId, playerId, name);
  await store.publishRace(raceId);
  return { ok: true, raceId };
}

// Clôture (leader) : tout le monde a fini, ou le délai après le premier arrivé est écoulé, ou la course est trop vieille.
// Classement final diffusé à tous. Tout vit dans Redis : si le leader meurt, le suivant reprend.
export async function tickRaces(now = Date.now()) {
  for (const race of await store.listRaces()) {
    if (now < race.startAt || race.closed) continue;
    const board = await store.raceBoard(race.id);
    const fin = board.rows.filter((r) => r.ms != null);
    const over = fin.length >= board.entrants || now > race.startAt + RACE_MAX_MS || (fin.length > 0 && now > race.startAt + fin[0].ms + RACE_GRACE_MS);
    if (!over || !(await store.lockRaceClose(race.id))) continue;
    const rows = board.rows.map((r, i) => ({ ...r, place: r.ms != null ? i + 1 : null, prize: r.ms != null ? (PRIZES[i] ?? 50) : 0 }));
    await store.publish({ k: "race_end", raceId: race.id, toLabel: race.toLabel, rows });
    if (fin.length) await store.pushChat({ from: "Radio Kube", text: `Course vers ${race.toLabel} terminée. Podium : ${rows.filter((r) => r.place && r.place <= 3).map((r) => `${r.place}. ${r.name}`).join(", ")}.`, ts: now });
    await store.markRaceClosed(race.id);
  }
}

// ---------- Classement de session et exploits (Radio Kube) ----------
const MILES = { money: [1000, 5000, 10000, 25000, 50000], races: [3, 10], kubes: [10, 25, 50] };
/** Plus haut palier franchi en passant de `before` à `after`, ou null. */
export function crossedMilestone(kind, before, after) {
  const l = (MILES[kind] || []).filter((t) => before < t && after >= t);
  return l.length ? l.at(-1) : null;
}
export function exploitText(name, kind, t) {
  if (kind === "money") return `${name} dépasse ${t} € gagnés depuis le début de la session !`;
  if (kind === "races") return `${name} compte déjà ${t} courses terminées. Quelqu'un peut l'arrêter ?`;
  return `${name} a ramassé ${t} kubes. La ville en perd son éclat.`;
}
const LEAD_MIN = 3000;
export async function recordStat(id, name, kind, n) {
  n = Math.round(n);
  if (!(n > 0)) return;
  const after = await store.bumpSession(id, name, kind, n);
  const t = crossedMilestone(kind, after - n, after);
  if (t) await store.pushChat({ from: "Radio Kube", text: exploitText(name, kind, t), ts: Date.now() });
  if (kind === "money") {
    const top = await store.sessionTop("money");
    if (top && top.id === id && top.score >= LEAD_MIN && (await store.getLeaderAnnounced()) !== id) {
      await store.setLeaderAnnounced(id);
      await store.pushChat({ from: "Radio Kube", text: `${name} prend la tête du classement de la session avec ${Math.round(top.score)} € !`, ts: Date.now() });
    }
  }
}

// ---------- Événement de ville : la Chasse aux kubes dorés (toutes les ~10 min, pilotée par le leader) ----------
const HUNT_EVERY_MS = Number(process.env.HUNT_EVERY_MS || 10 * 60_000);
const HUNT_DURATION_MS = Number(process.env.HUNT_DURATION_MS || 3 * 60_000);
export const HUNT_KUBES = 5;
export const HUNT_CLAIM_RADIUS = 25; // m : tolérance côté serveur (latence, vitesse d'un véhicule)

/** Classement d'une chasse : plus de kubes d'abord ; à égalité, celui qui a le kube de plus petit numéro. Pure. */
export function huntRows(claims, names = {}) {
  const by = new Map();
  for (const [i, id] of Object.entries(claims)) {
    const e = by.get(id) || { id, name: names[id] || "?", count: 0, first: Infinity };
    e.count++; e.first = Math.min(e.first, Number(i));
    by.set(id, e);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.first - b.first).map(({ id, name, count }) => ({ id, name, count }));
}

function pickHuntPoints(n) {
  const pts = [];
  for (let tries = 0; pts.length < n && tries < 200; tries++) {
    const p = randomRoadPoint();
    if (pts.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > 150) || tries > 150) pts.push({ x: Math.round(p.x), z: Math.round(p.z) });
  }
  return pts.map((p, i) => ({ i, ...p }));
}

export async function startHunt(now = Date.now()) {
  const hunt = { id: newId("chasse"), startAt: now, endAt: now + HUNT_DURATION_MS, kubes: pickHuntPoints(HUNT_KUBES), prize: 500 };
  // prochaine date posée AVANT : si le leader meurt juste après le départ, le suivant n'enchaîne pas une 2e chasse
  await store.setHuntNext(now + HUNT_EVERY_MS);
  if (!(await store.startHunt(hunt))) return null;
  await store.publish({ k: "hunt", hunt: await store.huntView() });
  await store.pushChat({ from: "Radio Kube", text: `Chasse aux kubes dorés ! ${HUNT_KUBES} kubes dorés viennent d'apparaître en ville. Le plus rapide en ramasse le plus : ${Math.round(HUNT_DURATION_MS / 60000 * 10) / 10} min.`, ts: now });
  return hunt;
}

export async function endHunt(hunt) {
  if (!(await store.lockHuntEnd(hunt.id))) return;
  const rows = huntRows(hunt.claims || {}, hunt.names || {});
  const winner = rows[0] || null;
  if (winner && (await store.markHuntPaid(hunt.id))) await store.addScore(winner.id, winner.name, hunt.prize / 10);
  await store.publish({ k: "hunt_end", huntId: hunt.id, winner, rows, prize: hunt.prize });
  await store.pushChat({ from: "Radio Kube", text: winner ? `Chasse terminée ! ${winner.name} l'emporte avec ${winner.count} kube${winner.count > 1 ? "s" : ""} doré${winner.count > 1 ? "s" : ""} (+${hunt.prize} €).` : "Chasse terminée : personne n'a trouvé de kube doré. Les kubes retournent dans l'ombre.", ts: Date.now() });
  await store.clearHunt();
}

/** Appelée ~1 fois par seconde par le leader. Aucun état en mémoire : tout est relu dans Redis. */
export async function tickEvents(now = Date.now()) {
  const hunt = await store.huntView();
  if (hunt) {
    if (Object.keys(hunt.claims).length >= hunt.kubes.length || now >= hunt.endAt) await endHunt(hunt);
    return;
  }
  const next = await store.huntNextAt();
  if (next === null) await store.setHuntNext(now + HUNT_EVERY_MS);
  else if (now >= next) await startHunt(now);
}

/** Un joueur ramasse un kube doré : le premier qui écrit la case gagne (atomique côté Redis). */
export async function claimHuntKube(playerId, name, pos, huntId, i) {
  const hunt = await store.huntView();
  if (!hunt || hunt.id !== huntId || Date.now() > hunt.endAt) return { ok: false, reason: "pas de chasse en cours" };
  const k = hunt.kubes.find((x) => x.i === i);
  if (!k) return { ok: false, reason: "kube inconnu" };
  if (Math.hypot(pos[0] - k.x, pos[2] - k.z) > HUNT_CLAIM_RADIUS) return { ok: false, reason: "trop loin" };
  if (!(await store.claimKube(hunt.id, i, playerId))) return { ok: false, taken: true, reason: "déjà pris" };
  await recordStat(playerId, name, "kubes", 1);
  await store.publish({ k: "hunt", hunt: await store.huntView() });
  return { ok: true, i, reward: 100 };
}

// ---------- Agents IA ----------
export async function spawnBot({ name, color, owner = null, keyed = false, ip = null }) {
  const start = randomRoadPoint();
  const bot = {
    id: newId("agent"),
    name: String(name || "Agent").slice(0, 24),
    color: /^#[0-9a-f]{6}$/i.test(color || "") ? color : "#39ff88",
    vtype: BOT_VEHICLES[Math.floor(Math.random() * BOT_VEHICLES.length)],
    bot: true, owner, keyed: !!keyed, ip,
    x: start.x, z: start.z, yaw: 0, v: 0,
    path: [], goal: null, raceId: null,
    createdAt: Date.now(), lastCmd: Date.now(),
  };
  await store.saveBot(bot);
  await store.pushChat({ from: "Radio Kube", text: `L'agent ${bot.name} arrive en ville.`, ts: Date.now() });
  return bot;
}

export async function botDriveTo(id, toKey) {
  const bot = await store.loadBot(id);
  if (!bot) throw new Error("agent inconnu");
  const to = resolvePlace(toKey);
  if (!to) throw new Error(`lieu inconnu : ${toKey}`);
  const order = { path: roadPath(bot, to), goal: to.label, raceId: null, raceStage: null, claim: null };
  await store.setBotOrder(id, order);
  return { ...bot, ...order };
}

/** Rouler vers des coordonnées x/z (bornées à la ville, ramenées sur la route la plus proche). */
export async function botDriveToXY(id, x, z) {
  const bot = await store.loadBot(id);
  if (!bot) throw new Error("agent inconnu");
  const lim = HALF - 5;
  const to = { x: Math.max(-lim, Math.min(lim, +x)), z: Math.max(-lim, Math.min(lim, +z)) };
  if (!Number.isFinite(to.x) || !Number.isFinite(to.z)) throw new Error("coordonnées invalides");
  const order = { path: roadPath(bot, to), goal: `x=${Math.round(to.x)}, z=${Math.round(to.z)}`, raceId: null, raceStage: null, claim: null };
  await store.setBotOrder(id, order);
  return { ...bot, ...order };
}

// Aller ramasser un kube doré de la chasse en cours : l'agent roule jusqu'au kube puis le réclame à l'arrivée.
export async function botGoForKube(id, i) {
  const bot = await store.loadBot(id);
  if (!bot) throw new Error("agent inconnu");
  const hunt = await store.huntView();
  if (!hunt || Date.now() > hunt.endAt) throw new Error("pas de chasse en cours");
  const k = hunt.kubes.find((x) => x.i === Number(i));
  if (!k) throw new Error("kube inconnu");
  if (hunt.claims[k.i]) throw new Error("ce kube est déjà pris");
  const order = { path: roadPath(bot, k), goal: `kube doré n°${k.i}`, raceId: null, raceStage: null, claim: { huntId: hunt.id, i: k.i } };
  await store.setBotOrder(id, order);
  return { bot: { ...bot, ...order }, kube: k };
}

export async function botJoinRace(id, raceId) {
  const bot = await store.loadBot(id);
  if (!bot) throw new Error("agent inconnu");
  const race = await store.loadRace(raceId);
  if (!race) throw new Error("course inconnue");
  if (raceStatus(race) !== "inscriptions") throw new Error("les inscriptions sont closes");
  // même règle que pour les humains : il faut être près de la ligne de départ (voir drive_to_xy vers `depart`)
  if (Math.hypot(bot.x - race.from.x, bot.z - race.from.z) > JOIN_RADIUS) throw new Error(`trop loin du départ (à plus de ${JOIN_RADIUS} m) : va d'abord à x=${race.from.x}, z=${race.from.z}`);
  await store.joinRace(raceId, bot.id, bot.name);
  // l'agent va d'abord sur la ligne de départ, puis attend le signal
  const order = { path: roadPath(bot, race.from), goal: `départ de la course vers ${race.toLabel}`, raceId, raceStage: "approche", claim: null };
  await store.setBotOrder(id, order);
  return { bot: { ...bot, ...order }, race };
}

export function describe(bot) {
  return {
    id: bot.id, name: bot.name,
    x: Math.round(bot.x), z: Math.round(bot.z),
    quartier: districtAt(bot.x, bot.z).name,
    destination: bot.goal, enCourse: bot.raceId, etape: bot.raceStage || null,
    enRoute: bot.path.length > 0,
  };
}

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Fait avancer un agent le long de son itinéraire (le cap tourne progressivement, comme un véhicule).
 * Pure : utilisée par la boucle du leader et par les tests. Renvoie true si l'agent a bougé.
 */
export function advance(bot, dt, speed = BOT_SPEED) {
  if (!bot.path.length) { bot.v = 0; return false; }
  let budget = speed * dt;
  while (budget > 0 && bot.path.length) {
    const t = bot.path[0];
    const dx = t.x - bot.x, dz = t.z - bot.z, d = Math.hypot(dx, dz);
    if (d < 0.5) { bot.path.shift(); continue; }
    // cap voulu : le véhicule ne pivote pas sur place, il ralentit le temps de tourner
    const want = Math.atan2(dx, dz);
    const diff = wrapAngle(want - bot.yaw);
    const turn = Math.sign(diff) * Math.min(Math.abs(diff), BOT_TURN * dt);
    bot.yaw = wrapAngle(bot.yaw + turn);
    const align = Math.max(0.15, Math.cos(Math.min(Math.abs(diff), Math.PI / 2)));
    const step = Math.min(budget * align, d);
    bot.x += (dx / d) * step; bot.z += (dz / d) * step;
    budget = 0;
  }
  bot.v = bot.path.length ? speed : 0;
  return true;
}

// Un pas de simulation pour un agent (ordres, courses, balade). Renvoie true si l'agent a bougé.
async function stepBot(bot, dt, now) {
  if (bot.raceId && bot.raceStage === "attente") {
    const race = await store.loadRace(bot.raceId);
    if (!race || raceStatus(race, now) === "terminée") { bot.raceId = null; bot.raceStage = null; }
    else if (now >= race.startAt) { bot.path = race.checkpoints.map((c) => ({ ...c })); bot.raceStage = "course"; }
    else { bot.v = 0; return false; }
  }
  if (!bot.path.length) {
    bot.v = 0;
    // un agent sans ordre depuis 30 s se promène : la ville reste vivante
    if (now - bot.lastCmd > 30_000 && !bot.raceId) {
      const keys = Object.keys(PLACES);
      const to = PLACES[keys[Math.floor(Math.random() * keys.length)]];
      bot.path = roadPath(bot, to);
      bot.goal = `${to.label} (balade)`;
      bot.lastCmd = now;
    }
    return false;
  }
  const moved = advance(bot, dt, bot.raceStage === "course" ? BOT_SPEED * 1.6 : BOT_SPEED);
  if (!bot.path.length) {
    bot.v = 0;
    if (bot.raceId && bot.raceStage === "approche") bot.raceStage = "attente";
    else if (bot.raceId && bot.raceStage === "course") {
      // retiré (despawn) pendant le tick : pas de score ni de classement pour un agent disparu
      if (await store.botExists(bot.id)) await finish(bot.raceId, bot.id, bot.name);
      bot.raceId = null; bot.raceStage = null; bot.goal = null;
    } else if (bot.claim) {
      const c = bot.claim; bot.claim = null; bot.goal = null;
      const r = (await store.botExists(bot.id)) ? await claimHuntKube(bot.id, bot.name, [bot.x, 0, bot.z], c.huntId, c.i) : { ok: false };
      if (r.ok) await store.pushChat({ from: `${bot.name} (IA)`, bot: true, text: "Kube doré ramassé !", ts: Date.now() });
    } else bot.goal = null;
  }
  return moved;
}

/** Entrée « joueur » diffusée pour un agent : même forme qu'un joueur dans un véhicule. */
export function botAsPlayer(bot) {
  const y = Math.round(Math.max(0, groundHeight(bot.x, bot.z)) * 100) / 100; // collines : on suit le relief
  return {
    id: bot.id, name: bot.name, ch: "agent", o: null, bot: true,
    p: [Math.round(bot.x * 100) / 100, y, Math.round(bot.z * 100) / 100],
    r: Math.round(bot.yaw * 100) / 100,
    vel: [Math.round(Math.sin(bot.yaw) * bot.v * 100) / 100, 0, Math.round(Math.cos(bot.yaw) * bot.v * 100) / 100],
    a: "drive", veh: `${bot.id}-v`, seat: 0, st: 0,
    vh: {
      id: `${bot.id}-v`, type: bot.vtype || "sedan",
      p: [Math.round(bot.x * 100) / 100, y, Math.round(bot.z * 100) / 100],
      q: [0, Math.round(Math.sin(bot.yaw / 2) * 1000) / 1000, 0, Math.round(Math.cos(bot.yaw / 2) * 1000) / 1000],
      w: [0, 0], col: bot.color, sir: 0, li: 0,
    },
  };
}

// Boucle du leader : appelée ~15 fois par seconde par le seul pod élu
export async function tickBots(dt) {
  const now = Date.now();
  const bots = await store.listBots();
  for (const bot of bots) {
    if (now - bot.lastCmd > 30 * 60_000 && !bot.path.length) { await store.deleteBot(bot.id); continue; }
    const order = await store.takeBotOrder(bot.id);
    if (order) Object.assign(bot, order, { lastCmd: now });
    const moved = await stepBot(bot, dt, now);
    const publish = moved || now - (bot.pub || 0) > 500;
    if (publish) bot.pub = now;
    if (!(await store.updateBot(bot))) continue; // retiré (despawn) pendant le tick : on ne le ressuscite pas
    // un agent à l'arrêt se signale quand même deux fois par seconde (sinon les pods l'oublient)
    if (publish) await store.publish({ k: "p", p: botAsPlayer(bot) });
  }
}
