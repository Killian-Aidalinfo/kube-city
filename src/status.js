// Vue « enseignant » : battements des pods, journal des incidents et score de disponibilité, tout dans Redis.
// Rien ici ne peut bloquer le jeu : chaque appel Redis est protégé, et sans Redis on montre ce que ce pod sait.
import * as store from "./store.js";

import { BEAT_MS, BEAT_TTL_S, WINDOW_MS, computeAvailability, recentIncidents } from "./status-calc.js";
const JOURNAL_MAX = 300;

// ---------- État de ce pod ----------
let ctx = null;            // { getState: () => ({ready, players, clients, leader}) , version }
let timer = null, closing = false;
let everUp = false, downSince = 0, recoveredAt = 0, lastBeat = null, cachedAvail = null;
const local = [];          // journal local : ce que ce pod a vu, même sans Redis

function remember(e) { local.push(e); if (local.length > 100) local.shift(); }

async function log(type, extra = {}) {
  const e = { ts: Date.now(), pod: store.POD, type, ...extra };
  remember(e);
  try {
    await store.redis.lpush("pn:journal", JSON.stringify(e));
    await store.redis.ltrim("pn:journal", 0, JOURNAL_MAX - 1);
  } catch { /* Redis absent : l'incident reste dans le journal local */ }
}

function selfBeat() {
  const s = ctx.getState();
  return { pod: store.POD, version: ctx.version, ready: !!s.ready, players: s.players, clients: s.clients, leader: !!s.leader,
    uptimeSec: Math.round(process.uptime()), redis: store.redisReady(), ts: Date.now() };
}

async function beat() {
  const now = Date.now(), up = store.redisReady();
  if (!up) { if (everUp && !downSince) downSince = now; lastBeat = selfBeat(); return; }
  everUp = true;
  if (downSince) {
    const durMs = now - downSince; downSince = 0; recoveredAt = now;
    log("redis_back", { durMs });
  }
  const b = lastBeat = selfBeat();
  try {
    const r = store.redis;
    const isNew = (await r.zadd("pn:pods", b.ts, store.POD)) === 1; // 1 = entrée créée : le pod vient d'apparaître
    await r.multi()
      .set(`pn:hb:${store.POD}`, JSON.stringify(b), "EX", BEAT_TTL_S)
      .zadd("pn:hbh", b.ts, `${b.ts}|${store.POD}|${b.ready ? 1 : 0}|${b.redis ? 1 : 0}`)
      .zremrangebyscore("pn:hbh", "-inf", b.ts - WINDOW_MS - 60_000)
      .exec();
    if (isNew) { await r.del(`pn:stop:${store.POD}`); log("up", { version: b.version }); } // un ancien marqueur d'arrêt ne doit pas masquer un futur crash
    // disparitions : le premier pod qui retire l'entrée (ZREM = 1) écrit l'incident ; pas juste après un retour de Redis
    if (!recoveredAt || now - recoveredAt > 8000) {
      const dead = await r.zrangebyscore("pn:pods", "-inf", now - BEAT_TTL_S * 1000);
      for (const p of dead) {
        if (p === store.POD) continue;
        if ((await r.zrem("pn:pods", p)) === 1) {
          if (!(await r.exists(`pn:stop:${p}`))) log("gone", { about: p, pod: p });
        }
      }
    }
  } catch { /* échec ponctuel : le prochain battement réessaie */ }
}

export function start(c) {
  ctx = c;
  timer = setInterval(() => { if (!closing) beat().catch(() => {}); }, BEAT_MS);
  beat().catch(() => {});
}

// Arrêt voulu : on le note (le pod ne sera pas déclaré « disparu ») et on se retire de la liste.
export async function stop() {
  closing = true; clearInterval(timer);
  try {
    const r = store.redis;
    await r.set(`pn:stop:${store.POD}`, "1", "EX", 60);
    await log("stop");
    await r.zrem("pn:pods", store.POD);
    await r.del(`pn:hb:${store.POD}`);
  } catch { /* Redis absent : rien à faire */ }
}

// Réponse de /api/status. Sans Redis : uniquement ce que CE pod sait (battement local, son journal, dernier score connu).
export async function snapshot() {
  const now = Date.now(), self = selfBeat();
  const out = { now, pod: store.POD, redisReachable: store.redisReady(), source: "redis", pods: [], leader: null, redis: null,
    players: 0, agents: 0, incidents: [], availability: cachedAvail, windowMin: WINDOW_MS / 60000 };
  if (store.redisReady()) {
    try {
      const r = store.redis;
      const names = await r.zrangebyscore("pn:pods", now - BEAT_TTL_S * 1000, "+inf");
      const raw = names.length ? await r.mget(names.map((n) => `pn:hb:${n}`)) : [];
      out.pods = raw.filter(Boolean).map((s) => JSON.parse(s)).sort((a, b) => a.pod.localeCompare(b.pod));
      const [leader, info, journal, hist, bots] = await Promise.all([
        store.currentLeader(), r.info("replication"),
        r.lrange("pn:journal", 0, JOURNAL_MAX - 1), r.zrangebyscore("pn:hbh", now - WINDOW_MS, "+inf"), r.scard("pn:bots"),
      ]);
      out.leader = leader;
      out.agents = bots;
      const f = (k) => (info.match(new RegExp(`${k}:(.*)`)) || [])[1]?.trim();
      const st = r.stream || {}; // adresse réellement jointe (en mode Sentinel : le maître courant)
      out.redis = { role: f("role"), connectedReplicas: Number(f("connected_slaves") || 0), masterHost: f("master_host") || null,
        endpoint: st.remoteAddress ? `${st.remoteAddress}:${st.remotePort}` : null };
      out.incidents = recentIncidents(journal.map((s) => JSON.parse(s)).concat(local), now);
      const beats = hist.map((m) => { const [ts, pod, ready, redis] = m.split("|"); return { ts: +ts, pod, ready: ready === "1", redis: redis === "1" }; });
      out.availability = cachedAvail = { ...computeAvailability(beats, now), at: now };
      out.players = Math.max(0, ...out.pods.map((p) => p.players || 0)); // chaque pod voit toute la ville
      return out;
    } catch { /* Redis a lâché en cours de lecture : on retombe sur la vue locale */ }
  }
  out.source = "pod";
  out.redisReachable = false;
  out.pods = [{ ...self, redis: false }];
  out.leader = null;
  out.players = self.players;
  out.downForMs = downSince ? now - downSince : 0;
  out.incidents = recentIncidents(local, now);
  return out;
}
