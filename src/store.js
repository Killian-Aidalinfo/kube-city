// Tout l'état partagé vit dans Redis : un pod peut mourir, le jeu continue sur les autres.
import Redis from "ioredis";
import os from "node:os";

export const POD = process.env.POD_NAME || os.hostname();
const URL = process.env.REDIS_URL || "redis://localhost:6379";
const CHANNEL = "pn:ev";

// Réglages pour une bascule rapide : on échoue vite plutôt que d'attendre un Redis mort,
// et on se reconnecte toutes les 100 ms (max 1 s).
const fast = (times) => Math.min(times * 100, 1000);
const opts = {
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
  lazyConnect: false,
  connectTimeout: 2000,
  commandTimeout: 1500,
  retryStrategy: fast,
  // l'ancien maître devenu réplica refuse les écritures : on se reconnecte au nouveau maître
  reconnectOnError: (err) => (String(err.message).includes("READONLY") ? 2 : false),
};

// Deux modes :
// - REDIS_URL : un Redis unique (simple, mais point de défaillance unique) ;
// - REDIS_SENTINELS="hote1:26379,hote2:26379" : on demande aux Sentinel qui est le maître,
//   et ioredis se reconnecte tout seul au nouveau maître après une bascule.
function connect() {
  const sentinels = (process.env.REDIS_SENTINELS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!sentinels.length) return new Redis(URL, opts);
  return new Redis({
    ...opts,
    sentinels: sentinels.map((s) => { const [host, port] = s.split(":"); return { host, port: Number(port || 26379) }; }),
    name: process.env.REDIS_SENTINEL_NAME || "mymaster",
    // écoute l'annonce « +switch-master » des Sentinel : bascule dès qu'un nouveau maître est élu
    failoverDetector: true,
    sentinelRetryStrategy: fast,
    password: process.env.REDIS_PASSWORD || undefined,
    sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD || process.env.REDIS_PASSWORD || undefined,
  });
}
export const redis = connect();
export const sub = connect();

// Arrêt voulu : ioredis remet `manuallyClosing` à false AVANT d'émettre « end », on ne peut donc pas s'y fier.
let closing = false;
export async function closeStore() {
  closing = true;
  // quit si la connexion est prête, sinon disconnect (un quit sur une connexion absente attendrait pour rien)
  await Promise.all([redis, sub].map((c) => (c.status === "ready" ? c.quit().catch(() => c.disconnect()) : c.disconnect())));
}

for (const [n, c] of [["redis", redis], ["sub", sub]]) {
  c.on("error", (e) => console.error(`[${n}] ${e.message}`));
  // ioredis peut passer en « end » pour de bon (si une annonce de bascule tombe pendant qu'il cherche déjà le maître) :
  // sans cette relance, le pod resterait sans Redis jusqu'à son redémarrage.
  c.on("end", () => {
    if (closing) return; // arrêt voulu (closeStore) : pas de relance
    console.error(`[${n}] connexion terminée, relance`);
    setTimeout(() => { if (!closing && c.status === "end") c.connect().catch(() => {}); }, 200);
  });
}

export function redisReady() {
  return redis.status === "ready" && sub.status === "ready";
}

export async function publish(ev) {
  await redis.publish(CHANNEL, JSON.stringify(ev));
}

export async function subscribe(onEvent) {
  await sub.subscribe(CHANNEL);
  sub.on("ready", () => { sub.subscribe(CHANNEL).catch(() => {}); }); // après une relance « end » : on se réabonne
  sub.on("message", (_ch, msg) => {
    try { onEvent(JSON.parse(msg)); } catch { /* message illisible : ignoré */ }
  });
}

// --- Joueurs (humains et agents) ---
export async function savePlayer(p) {
  await redis.set(`pn:p:${p.id}`, JSON.stringify(p), "EX", 60);
}

export async function loadPlayer(id) {
  const raw = await redis.get(`pn:p:${id}`);
  return raw ? JSON.parse(raw) : null;
}

// --- Scores ---
const SCORES_MAX = 2000, SCORES_TTL = 7 * 24 * 3600;
// Dernière activité par joueur (pn:seen, ms) : le classement global n'affiche que les joueurs actifs récemment.
// Mise à jour progressive : un ancien pod ne remplit pas pn:seen, ses joueurs n'apparaissent donc pas au classement.
export const LEADERBOARD_ACTIVE_MS = () => Math.max(1, Number(process.env.LEADERBOARD_ACTIVE_HOURS) || 24) * 3600_000;
export async function addScore(id, name, pts) {
  const n = Math.max(-500, Math.min(500, Math.round(pts)));
  const r = await redis.multi()
    .hset("pn:names", id, name).zincrby("pn:scores", n, id).zadd("pn:seen", Date.now(), id)
    .expire("pn:names", SCORES_TTL).expire("pn:scores", SCORES_TTL).expire("pn:seen", SCORES_TTL).zcard("pn:scores").exec();
  // Endurance : le classement et la table des pseudos ne grossissent pas sans fin (un id neuf par visiteur) :
  // on garde les SCORES_MAX meilleurs, on oublie les pseudos des autres, et tout expire après 7 jours sans activité.
  const card = r[6][1];
  if (card > SCORES_MAX + SCORES_MAX / 10) {
    // on retire d'abord les plus anciens (pn:seen) et ceux sans date, puis on complète par score : un inactif à gros score ne bloque pas les nouveaux
    const need = card - SCORES_MAX;
    const ids = await redis.zrange("pn:scores", 0, -1); // du plus faible au plus fort score
    const seen = await redis.zmscore("pn:seen", ...ids);
    const byAge = ids.map((id, i) => ({ id, i, t: seen[i] === null ? -1 : Number(seen[i]) })).sort((a, b) => a.t - b.t || a.i - b.i);
    const drop = byAge.slice(0, need).map((x) => x.id);
    if (drop.length) await redis.multi().zrem("pn:scores", ...drop).zrem("pn:seen", ...drop).hdel("pn:names", ...drop).exec();
  }
  return r[1][1];
}

// Cache de 2 s par pod : un seul calcul Redis à la fois, le résultat est partagé (hello, board, /api, look).
const LB_CACHE_MS = 2000;
const lbCache = new Map(); // n -> { t, p }
export function leaderboard(n = 10, { fresh = false } = {}) {
  if (fresh) return computeLeaderboard(n);
  const c = lbCache.get(n);
  if (c && Date.now() - c.t < LB_CACHE_MS) return c.p;
  const p = computeLeaderboard(n);
  lbCache.set(n, { t: Date.now(), p });
  p.catch(() => { if (lbCache.get(n)?.p === p) lbCache.delete(n); }); // échec : pas de cache
  return p;
}

async function computeLeaderboard(n) {
  // On lit large (les inactifs en tête sont écartés), puis on garde les n premiers actifs.
  const flat = await redis.zrevrange("pn:scores", 0, SCORES_MAX - 1, "WITHSCORES");
  const all = [];
  for (let i = 0; i < flat.length; i += 2) all.push([flat[i], Number(flat[i + 1])]);
  if (!all.length) return [];
  const seen = await redis.zmscore("pn:seen", ...all.map(([id]) => id));
  const since = Date.now() - LEADERBOARD_ACTIVE_MS();
  const top = all.filter((_, i) => seen[i] !== null && Number(seen[i]) >= since).slice(0, n);
  const names = top.length ? await redis.hmget("pn:names", ...top.map(([id]) => id)) : [];
  return top.map(([id, score], i) => ({ id, name: names[i] || "?", score }));
}

// --- Chat ---
export async function pushChat(msg) {
  await redis.lpush("pn:chat", JSON.stringify(msg));
  await redis.ltrim("pn:chat", 0, 49);
  await publish({ k: "chat", msg });
}

export async function recentChat(n = 20) {
  const list = await redis.lrange("pn:chat", 0, n - 1);
  return list.map((s) => JSON.parse(s)).reverse();
}

// --- Courses de rue ---
export async function saveRace(race) {
  await redis.set(`pn:race:${race.id}`, JSON.stringify(race), "EX", 900);
  await redis.sadd("pn:races", race.id);
}

// Vue d'une course diffusée aux joueurs : la course + ses inscrits (id -> nom)
export async function raceView(id) {
  const race = await loadRace(id);
  if (!race) return null;
  return { ...race, entrants: await raceEntrants(id), closed: await raceClosed(id) };
}
export async function publishRace(id) {
  const race = await raceView(id);
  if (race) await publish({ k: "race", race });
  return race;
}

export async function loadRace(id) {
  const raw = await redis.get(`pn:race:${id}`);
  return raw ? JSON.parse(raw) : null;
}

export async function listRaces() {
  const ids = await redis.smembers("pn:races");
  const out = [];
  for (const id of ids) {
    const r = await raceView(id);
    if (r) out.push(r); else await redis.srem("pn:races", id);
  }
  return out;
}

// Inscrits et arrivées dans des structures Redis atomiques :
// plusieurs pods peuvent écrire en même temps sans se marcher dessus.
export async function joinRace(id, playerId, name) {
  await redis.hset(`pn:race:${id}:in`, playerId, name);
  await redis.expire(`pn:race:${id}:in`, 900);
}

export async function raceEntrants(id) {
  return redis.hgetall(`pn:race:${id}:in`);
}

// Renvoie la place à l'arrivée (1 = vainqueur), ou null si déjà arrivé
export async function finishRace(id, playerId, ms) {
  const key = `pn:race:${id}:fin`;
  const added = await redis.zadd(key, "NX", ms, playerId);
  await redis.expire(key, 900);
  if (!added) return null;
  return (await redis.zrank(key, playerId)) + 1;
}

export async function raceResults(id) {
  const flat = await redis.zrange(`pn:race:${id}:fin`, 0, -1, "WITHSCORES");
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ id: flat[i], ms: Number(flat[i + 1]) });
  return out;
}

// --- Élection d'un leader : un seul pod simule les agents IA ---
const LEASE_MS = 4000;
const RENEW = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;

export async function tryLead() {
  const got = await redis.set("pn:leader", POD, "PX", LEASE_MS, "NX");
  if (got) return true;
  return (await redis.eval(RENEW, 1, "pn:leader", POD, LEASE_MS)) === 1;
}

export async function currentLeader() {
  return redis.get("pn:leader");
}

export async function releaseLead() {
  const DEL = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
  await redis.eval(DEL, 1, "pn:leader", POD);
}

// --- Agents IA ---
export async function saveBot(bot) {
  await redis.set(`pn:bot:${bot.id}`, JSON.stringify(bot), "EX", 1800);
  await redis.sadd("pn:bots", bot.id);
}

// Mise à jour par le leader : n'écrit que si l'agent existe encore. Sans ça, un despawn qui tombe pendant un tick
// (agent déjà lu, pas encore resauvegardé) était annulé : le leader recréait l'agent. Renvoie false s'il a disparu.
const UPDATE_BOT = `if redis.call("exists", KEYS[1]) == 1 then redis.call("set", KEYS[1], ARGV[1], "EX", 1800) return 1 else return 0 end`;
export async function updateBot(bot) {
  return (await redis.eval(UPDATE_BOT, 1, `pn:bot:${bot.id}`, JSON.stringify(bot))) === 1;
}

export async function botExists(id) {
  return (await redis.exists(`pn:bot:${id}`)) === 1;
}

export async function loadBot(id) {
  const raw = await redis.get(`pn:bot:${id}`);
  return raw ? JSON.parse(raw) : null;
}

export async function listBots() {
  const ids = await redis.smembers("pn:bots");
  const out = [];
  for (const id of ids) {
    const b = await loadBot(id);
    if (b) out.push(b); else await redis.srem("pn:bots", id);
  }
  return out;
}

// Ordres donnés aux agents (par n'importe quel pod) : le leader les applique au tick suivant.
// Ça évite que le leader écrase un ordre en sauvegardant l'agent qu'il est en train de déplacer.
export async function setBotOrder(id, order) {
  await redis.set(`pn:order:${id}`, JSON.stringify(order), "EX", 600);
}

export async function takeBotOrder(id) {
  const raw = await redis.getdel(`pn:order:${id}`);
  return raw ? JSON.parse(raw) : null;
}

// Anti-spam commun à tous les pods (fenêtre fixe dans Redis) : vrai si l'action est autorisée
export async function rateLimit(key, limit, windowSec) {
  const k = `pn:rl:${key}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, windowSec);
  return n <= limit;
}

export async function deleteBot(id) {
  await redis.del(`pn:bot:${id}`);
  await redis.srem("pn:bots", id);
  await publish({ k: "gone", id });
}

// --- Profils de joueur (persos, argent, progression) : clé par id joueur, TTL long (90 jours, rafraîchi à chaque écriture) ---
const PROFILE_TTL = 90 * 24 * 3600;

export async function saveProfile(id, profile) {
  await redis.set(`pn:profile:${id}`, JSON.stringify(profile), "EX", PROFILE_TTL);
}

export async function loadProfile(id) {
  const raw = await redis.get(`pn:profile:${id}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Classement final d'une course : arrivés (par temps) puis ceux qui n'ont pas fini
export async function raceBoard(id) {
  const [entrants, fin] = await Promise.all([raceEntrants(id), raceResults(id)]);
  const done = new Set(fin.map((f) => f.id));
  return {
    entrants: Object.keys(entrants).length,
    rows: [...fin.map((f) => ({ id: f.id, name: entrants[f.id] || "?", ms: f.ms })), ...Object.entries(entrants).filter(([pid]) => !done.has(pid)).map(([pid, name]) => ({ id: pid, name, ms: null }))],
  };
}
// Clôture d'une course : un verrou court (8 s) évite le doublon entre deux leaders ; s'il meurt avant d'avoir annoncé
// le résultat, le verrou expire et le suivant reprend. La marque « clôturée » n'est posée qu'après l'annonce.
export async function raceClosed(id) { return (await redis.exists(`pn:race:${id}:closed`)) === 1; }
export async function lockRaceClose(id) { return (await redis.set(`pn:race:${id}:lock`, POD, "PX", 8000, "NX")) === "OK"; }
export async function markRaceClosed(id) { await redis.set(`pn:race:${id}:closed`, "1", "EX", 900); }

// --- Classement de la session : argent gagné, courses, kubes (zsets Redis, 12 h) ---
const SESS_TTL = 12 * 3600;
export const SESS_KINDS = ["money", "races", "kubes"];
export async function bumpSession(id, name, kind, n) {
  if (!SESS_KINDS.includes(kind)) return 0;
  await redis.multi().hset("pn:names", id, name).expire("pn:names", SCORES_TTL)
    .zadd("pn:seen", Date.now(), id).expire("pn:seen", SCORES_TTL).exec();
  const v = Number(await redis.zincrby(`pn:ss:${kind}`, n, id));
  await redis.expire(`pn:ss:${kind}`, SESS_TTL);
  return v;
}
export async function sessionTop(kind) {
  const f = await redis.zrevrange(`pn:ss:${kind}`, 0, 0, "WITHSCORES");
  return f.length ? { id: f[0], score: Number(f[1]) } : null;
}
export async function sessionBoard(n = 12) {
  const tops = await Promise.all(SESS_KINDS.map((k) => redis.zrevrange(`pn:ss:${k}`, 0, n - 1)));
  const ids = [...new Set(tops.flat())];
  if (!ids.length) return [];
  const pipe = redis.pipeline();
  for (const k of SESS_KINDS) for (const id of ids) pipe.zscore(`pn:ss:${k}`, id);
  pipe.hmget("pn:names", ...ids);
  const res = await pipe.exec();
  const names = res.at(-1)[1] || [];
  const rows = ids.map((id, i) => ({
    id, name: names[i] || "?",
    ...Object.fromEntries(SESS_KINDS.map((k, ki) => [k, Number(res[ki * ids.length + i][1]) || 0])),
  }));
  return rows.sort((a, b) => b.money - a.money || b.kubes - a.kubes).slice(0, n);
}
export async function getLeaderAnnounced() { return redis.get("pn:ss:lead"); }
export async function setLeaderAnnounced(id) { await redis.set("pn:ss:lead", id, "EX", SESS_TTL); }

// --- Chasse aux kubes dorés : tout l'état est dans Redis, le leader n'en garde rien en mémoire ---
export async function huntNextAt() { const v = await redis.get("pn:hunt:next"); return v ? Number(v) : null; }
export async function setHuntNext(ts) { await redis.set("pn:hunt:next", String(ts), "EX", 24 * 3600); }
// Démarre la chasse seulement si aucune n'est en cours (NX)
export async function startHunt(hunt) {
  return (await redis.set("pn:hunt", JSON.stringify(hunt), "PX", Math.max(1000, hunt.endAt - Date.now() + 60_000), "NX")) === "OK";
}
export async function huntView() {
  const raw = await redis.get("pn:hunt");
  if (!raw) return null;
  const hunt = JSON.parse(raw);
  const claims = await redis.hgetall(`pn:hunt:${hunt.id}:claims`);
  const ids = [...new Set(Object.values(claims))];
  const nm = ids.length ? await redis.hmget("pn:names", ...ids) : [];
  return { ...hunt, claims, names: Object.fromEntries(ids.map((id, i) => [id, nm[i] || "?"])) };
}
// Atomique : le premier joueur à écrire la case gagne le kube
export async function claimKube(huntId, i, playerId) {
  const ok = await redis.hsetnx(`pn:hunt:${huntId}:claims`, String(i), playerId);
  if (ok) await redis.expire(`pn:hunt:${huntId}:claims`, 3600);
  return ok === 1;
}
// Même principe que pour les courses : verrou court, puis l'annonce, puis on efface la chasse
export async function lockHuntEnd(huntId) { return (await redis.set(`pn:hunt:${huntId}:lock`, POD, "PX", 8000, "NX")) === "OK"; }
// Prix versé une seule fois par chasse, même si un leader meurt entre le versement et l'effacement (le suivant rejoue endHunt)
export async function markHuntPaid(huntId) { return (await redis.set(`pn:hunt:${huntId}:paid`, "1", "EX", 3600, "NX")) === "OK"; }
export async function clearHunt() { await redis.del("pn:hunt"); }
