// Kube City : serveur HTTP + WebSocket + MCP. Sans état : tout ce qui compte est dans Redis.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import client from "prom-client";
import * as store from "./store.js";
import * as game from "./game.js";
import { handleMcp } from "./mcp.js";

const PORT = Number(process.env.PORT || 8080);
const VERSION = process.env.APP_VERSION || "dev";
const DRAIN_MS = Number(process.env.DRAIN_DELAY_MS || 5000);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const DIST = path.join(ROOT, "client", "dist"); // build Vite, prioritaire sur public/
const startedAt = Date.now();
let draining = false;

// ---------- Métriques Prometheus ----------
client.collectDefaultMetrics();
const mClients = new client.Gauge({ name: "pn_clients_connected", help: "Joueurs connectés à ce pod" });
const mPlayers = new client.Gauge({ name: "pn_players_visible", help: "Joueurs et agents visibles dans la ville" });
const mLeader = new client.Gauge({ name: "pn_is_leader", help: "1 si ce pod simule les agents IA" });
const mMsgs = new client.Counter({ name: "pn_ws_messages_total", help: "Messages WebSocket reçus", labelNames: ["type"] });
const mDrains = new client.Counter({ name: "pn_drained_clients_total", help: "Joueurs prévenus lors d'un arrêt propre" });

// ---------- Vue locale de la ville (alimentée par le Pub/Sub Redis) ----------
const players = new Map(); // id -> { ...état, ts }
store.subscribe((ev) => {
  if (ev.k === "p") players.set(ev.p.id, { ...ev.p, ts: Date.now() });
  else if (ev.k === "gone") players.delete(ev.id);
  else broadcast(ev.k === "chat" ? { t: "chat", msg: ev.msg } : { t: "race", race: ev.race });
});

const sockets = new Set();
function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const ws of sockets) if (ws.readyState === 1) ws.send(s);
}

// Instantané envoyé 10 fois par seconde à chaque joueur de ce pod
setInterval(() => {
  const now = Date.now();
  for (const [id, p] of players) if (now - p.ts > 6000) players.delete(id);
  mPlayers.set(players.size);
  const list = [...players.values()].map((p) => ({ id: p.id, n: p.name, c: p.color, x: Math.round(p.x), y: Math.round(p.y), a: +p.a.toFixed(2), v: Math.round(p.v), b: p.bot ? 1 : 0 }));
  broadcast({ t: "snap", players: list, now });
}, 100);

// ---------- État de la synchro Redis, affiché aux joueurs ----------
let syncOk = true;
setInterval(() => {
  const ok = store.redisReady();
  if (ok !== syncOk) { syncOk = ok; broadcast({ t: "sync", ok }); console.log(`synchro Redis ${ok ? "rétablie" : "en pause"}`); }
}, 250);

// ---------- Leader : un seul pod fait rouler les agents IA ----------
let leader = false;
setInterval(async () => {
  if (draining || !store.redisReady()) { leader = false; mLeader.set(0); return; }
  try { leader = await store.tryLead(); } catch { leader = false; }
  mLeader.set(leader ? 1 : 0);
}, 1000);
let lastTick = Date.now();
setInterval(async () => {
  const now = Date.now(), dt = Math.min(0.5, (now - lastTick) / 1000);
  lastTick = now;
  if (!leader) return;
  try { await game.tickBots(dt); } catch (e) { console.error("tick agents", e.message); }
}, 100);

// ---------- HTTP ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream", ".wasm": "application/wasm", ".ogg": "audio/ogg", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".md": "text/plain; charset=utf-8" };

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://x");
  let p = decodeURIComponent(url.pathname);
  if (p === "/") p = "/index.html";
  // client/dist d'abord, repli sur public/
  for (const base of [DIST, PUBLIC]) {
    const file = path.normalize(path.join(base, p));
    if (!file.startsWith(base)) return res.writeHead(403).end();
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": p === "/index.html" ? "no-cache" : "public, max-age=60" });
      return res.end(data);
    } catch { /* on tente la base suivante */ }
  }
  res.writeHead(404).end("introuvable");
}

function json(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(obj));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) { chunks.push(c); if (chunks.length > 64) break; }
  const s = Buffer.concat(chunks).toString();
  return s ? JSON.parse(s) : undefined;
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://x");
    if (pathname === "/healthz") return json(res, 200, { ok: true });
    if (pathname === "/readyz") {
      // Prêt = pas en train de s'arrêter. Volontairement indépendant de Redis : pendant une bascule
      // Sentinel, si tous les pods devenaient « pas prêts » en même temps, le Service n'aurait plus
      // aucun pod et TOUS les joueurs seraient coupés. On garde les joueurs connectés, la synchro reprend seule.
      const ok = !draining;
      return json(res, ok ? 200 : 503, { ok, draining, redis: store.redisReady(), pod: store.POD });
    }
    if (pathname === "/metrics") {
      res.writeHead(200, { "content-type": client.register.contentType });
      return res.end(await client.register.metrics());
    }
    if (pathname === "/api/info") {
      return json(res, 200, { pod: store.POD, version: VERSION, leader: await store.currentLeader().catch(() => null), uptimeSec: Math.round((Date.now() - startedAt) / 1000), clients: sockets.size, players: players.size });
    }
    if (pathname === "/api/leaderboard") return json(res, 200, await store.leaderboard(10));
    if (pathname === "/api/places") return json(res, 200, game.placeList());
    if (pathname === "/mcp") return await handleMcp(req, res, req.method === "POST" ? await readBody(req) : undefined, () => players);
    return await serveStatic(req, res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: "erreur interne" });
  }
});

// ---------- WebSocket : le jeu ----------
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 16 * 1024 });

wss.on("connection", (ws) => {
  if (draining) return ws.close(1012, "pod en arrêt");
  sockets.add(ws);
  mClients.set(sockets.size);
  let me = null;
  let lastSave = 0;

  ws.on("message", async (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    mMsgs.inc({ type: String(m.t).slice(0, 12) });
    try {
      if (m.t === "hello") {
        const id = /^[a-z0-9-]{6,40}$/i.test(m.id || "") ? m.id : game.newId("joueur");
        const saved = await store.loadPlayer(id);
        me = { id, name: String(m.name || "Anonyme").slice(0, 20), color: /^#[0-9a-f]{6}$/i.test(m.color || "") ? m.color : "#ff3cac", x: m.x ?? saved?.x ?? 0, y: m.y ?? saved?.y ?? 0, a: 0, v: 0 };
        ws.send(JSON.stringify({
          t: "welcome", id, pod: store.POD, version: VERSION, sync: store.redisReady(),
          chat: await store.recentChat(20), races: await store.listRaces(), board: await store.leaderboard(10),
        }));
        // après une reconnexion (pod tué, mise à jour…), pas de message : le joueur ne doit rien remarquer
        if (!m.re) await store.pushChat({ from: "Radio Kube", text: `${me.name} entre en ville.`, ts: Date.now() });
      } else if (m.t === "ping") {
        ws.send(JSON.stringify({ t: "pong", ts: m.ts }));
      } else if (!me) {
        return;
      } else if (m.t === "state") {
        Object.assign(me, { x: +m.x || 0, y: +m.y || 0, a: +m.a || 0, v: +m.v || 0 });
        // Redis absent (bascule en cours) : les joueurs du même pod se voient quand même
        if (!store.redisReady()) { players.set(me.id, { ...me, ts: Date.now() }); return; }
        await store.publish({ k: "p", p: me });
        if (Date.now() - lastSave > 1000) { lastSave = Date.now(); await store.savePlayer(me); }
      } else if (m.t === "chat") {
        const text = String(m.text || "").trim().slice(0, 160);
        if (text) await store.pushChat({ from: me.name, text, ts: Date.now() });
      } else if (m.t === "race_new") {
        await game.createRace({ creatorId: me.id, creatorName: me.name, from: me, toKey: m.to });
      } else if (m.t === "race_join") {
        const race = await store.loadRace(m.raceId);
        if (race && game.raceStatus(race) !== "terminée") {
          await store.joinRace(race.id, me.id, me.name);
          ws.send(JSON.stringify({ t: "joined", raceId: race.id }));
        }
      } else if (m.t === "race_finish") {
        ws.send(JSON.stringify({ t: "finish", ...(await game.finish(m.raceId, me.id, me.name)) }));
      } else if (m.t === "mission") {
        // livraison réussie : petit bonus, plafonné côté serveur
        await store.addScore(me.id, me.name, Math.min(80, Math.max(0, +m.pts || 0)));
      } else if (m.t === "busted") {
        await store.addScore(me.id, me.name, -50);
      } else if (m.t === "board") {
        ws.send(JSON.stringify({ t: "board", board: await store.leaderboard(10) }));
      }
    } catch (e) {
      console.error("ws", e.message);
    }
  });

  ws.on("close", () => {
    sockets.delete(ws);
    mClients.set(sockets.size);
    if (me) store.savePlayer(me).catch(() => {});
  });
});

server.listen(PORT, () => console.log(`Kube City ${VERSION} sur :${PORT} (pod ${store.POD})`));

// ---------- Arrêt propre ----------
// 1. readyz passe en 503 : Kubernetes retire le pod du Service.
// 2. on attend que les Ingress/kube-proxy aient suivi (DRAIN_MS).
// 3. on prévient les joueurs et on ferme leurs WebSocket : ils se reconnectent ailleurs.
async function shutdown(sig) {
  if (draining) return;
  draining = true;
  console.log(`${sig} reçu : arrêt propre dans ${DRAIN_MS} ms`);
  await store.releaseLead().catch(() => {});
  await new Promise((r) => setTimeout(r, DRAIN_MS));
  broadcast({ t: "bye", pod: store.POD });
  mDrains.inc(sockets.size);
  for (const ws of sockets) ws.close(1012, "redémarrage du serveur");
  server.close();
  setTimeout(() => process.exit(0), 1500).unref();
  await store.redis.quit().catch(() => {});
  await store.sub.quit().catch(() => {});
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
