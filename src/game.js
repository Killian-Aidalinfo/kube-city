// Règles du jeu côté serveur : courses de rue et agents IA (coordonnées x/z en mètres).
import crypto from "node:crypto";
import { PLACES, roadPath, districtAt, resolvePlace, randomRoadPoint, groundHeight } from "./city.js";
import * as store from "./store.js";

export const BOT_SPEED = 14;         // m/s (~50 km/h) : les agents roulent sagement
const BOT_TURN = 3;                  // rad/s : vitesse de rotation max du véhicule
const RACE_LOBBY_MS = 20_000;        // délai pour s'inscrire avant le départ
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
  await store.pushChat({ from: "Radio Kube", text: `${creatorName} lance une course vers ${to.label} ! Départ dans 20 s, rejoignez-la depuis le téléphone.`, ts: now });
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
  if (raceStatus(race, now) !== "en cours") return { ok: false, reason: "la course n'est pas en cours" };
  const ms = now - race.startAt;
  if (ms < minDurationMs(race)) return { ok: false, reason: "trop rapide pour être vrai" };
  const entrants = await store.raceEntrants(raceId);
  if (!entrants[playerId]) return { ok: false, reason: "pas inscrit" };
  const place = await store.finishRace(raceId, playerId, ms);
  if (!place) return { ok: false, reason: "déjà arrivé" };
  const prize = PRIZES[place - 1] ?? 50;
  await store.addScore(playerId, name, prize);
  await store.pushChat({ from: "Radio Kube", text: `${name} termine ${place === 1 ? "1er" : `${place}e`} de la course vers ${race.toLabel} en ${(ms / 1000).toFixed(1)} s (+${prize}).`, ts: now });
  return { ok: true, place, ms, prize };
}

// ---------- Agents IA ----------
export async function spawnBot({ name, color }) {
  const start = randomRoadPoint();
  const bot = {
    id: newId("agent"),
    name: String(name || "Agent").slice(0, 24),
    color: /^#[0-9a-f]{6}$/i.test(color || "") ? color : "#39ff88",
    vtype: BOT_VEHICLES[Math.floor(Math.random() * BOT_VEHICLES.length)],
    bot: true,
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
  const order = { path: roadPath(bot, to), goal: to.label, raceId: null, raceStage: null };
  await store.setBotOrder(id, order);
  return { ...bot, ...order };
}

export async function botJoinRace(id, raceId) {
  const bot = await store.loadBot(id);
  if (!bot) throw new Error("agent inconnu");
  const race = await store.loadRace(raceId);
  if (!race) throw new Error("course inconnue");
  if (raceStatus(race) === "terminée") throw new Error("course terminée");
  await store.joinRace(raceId, bot.id, bot.name);
  // l'agent va d'abord sur la ligne de départ, puis attend le signal
  const order = { path: roadPath(bot, race.from), goal: `départ de la course vers ${race.toLabel}`, raceId, raceStage: "approche" };
  await store.setBotOrder(id, order);
  return { bot: { ...bot, ...order }, race };
}

export function describe(bot) {
  return {
    id: bot.id, name: bot.name,
    x: Math.round(bot.x), z: Math.round(bot.z),
    quartier: districtAt(bot.x, bot.z).name,
    destination: bot.goal, enCourse: bot.raceId,
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
      await finish(bot.raceId, bot.id, bot.name);
      bot.raceId = null; bot.raceStage = null; bot.goal = null;
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
    await store.saveBot(bot);
    // un agent à l'arrêt se signale quand même deux fois par seconde (sinon les pods l'oublient)
    if (publish) await store.publish({ k: "p", p: botAsPlayer(bot) });
  }
}
