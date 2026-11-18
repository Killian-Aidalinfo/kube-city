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

for (const [n, c] of [["redis", redis], ["sub", sub]]) {
  c.on("error", (e) => console.error(`[${n}] ${e.message}`));
}

export function redisReady() {
  return redis.status === "ready" && sub.status === "ready";
}

export async function publish(ev) {
  await redis.publish(CHANNEL, JSON.stringify(ev));
}

export async function subscribe(onEvent) {
  await sub.subscribe(CHANNEL);
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
export async function addScore(id, name, pts) {
  const n = Math.max(-500, Math.min(500, Math.round(pts)));
  await redis.hset("pn:names", id, name);
  return redis.zincrby("pn:scores", n, id);
}

export async function leaderboard(n = 10) {
  const flat = await redis.zrevrange("pn:scores", 0, n - 1, "WITHSCORES");
  const ids = [];
  for (let i = 0; i < flat.length; i += 2) ids.push(flat[i]);
  const names = ids.length ? await redis.hmget("pn:names", ...ids) : [];
  return ids.map((id, i) => ({ id, name: names[i] || "?", score: Number(flat[i * 2 + 1]) }));
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
  await publish({ k: "race", race });
}

export async function loadRace(id) {
  const raw = await redis.get(`pn:race:${id}`);
  return raw ? JSON.parse(raw) : null;
}

export async function listRaces() {
  const ids = await redis.smembers("pn:races");
  const out = [];
  for (const id of ids) {
    const r = await loadRace(id);
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

export async function deleteBot(id) {
  await redis.del(`pn:bot:${id}`);
  await redis.srem("pn:bots", id);
  await publish({ k: "gone", id });
}
