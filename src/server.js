// Kube City : serveur HTTP + WebSocket + MCP. Sans état : tout ce qui compte est dans Redis.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import client from "prom-client";
import * as store from "./store.js";
import * as game from "./game.js";
import * as proto from "./protocol.js";
import { handleMcp } from "./mcp.js";
import * as status from "./status.js";

const PORT = Number(process.env.PORT || 8080);
const VERSION = process.env.APP_VERSION || "dev";
const DRAIN_MS = Number(process.env.DRAIN_DELAY_MS || 5000);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const DIST = path.join(ROOT, "client", "dist"); // build Vite
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
const dirty = new Set();   // ids modifiés depuis le dernier envoi (snapshots incrémentaux)
store.subscribe((ev) => {
  if (ev.k === "p") { players.set(ev.p.id, { ...ev.p, ts: Date.now() }); dirty.add(ev.p.id); }
  else if (ev.k === "pb") {
    // lot d'états publié par un autre pod (les nôtres sont déjà appliqués en local)
    if (ev.pod === store.POD) return;
    const ts = Date.now();
    for (const p of ev.ps) { players.set(p.id, { ...p, ts }); dirty.add(p.id); }
  }
  else if (ev.k === "gone") { players.delete(ev.id); dirty.delete(ev.id); broadcast({ t: "gone", id: ev.id }); }
  else if (ev.k === "chat") broadcast({ t: "chat", msg: ev.msg });
  else if (ev.k === "emote") broadcast({ t: "emote", id: ev.id, e: ev.e });
  else if (ev.k === "ev") broadcast({ t: "event", from: ev.from, kind: ev.kind, data: ev.data });
  else if (ev.k === "race") broadcast({ t: "race", race: ev.race, now: Date.now() });
  else if (ev.k === "race_end") broadcast({ t: "race_end", raceId: ev.raceId, toLabel: ev.toLabel, rows: ev.rows });
  else if (ev.k === "hunt") broadcast({ t: "hunt", hunt: ev.hunt, now: Date.now() });
  else if (ev.k === "hunt_end") broadcast({ t: "hunt_end", huntId: ev.huntId, winner: ev.winner, rows: ev.rows, prize: ev.prize });
});

const sockets = new Set();
function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const ws of sockets) if (ws.readyState === 1) ws.send(s);
}

// Contre-pression : un client lent (Wi-Fi saturé, onglet en arrière-plan) ne doit pas faire gonfler la mémoire du pod.
// Au-delà de SLOW_BYTES en attente, on saute ses snapshots (le suivant est complet : il se resynchronise) ;
// au-delà de DEAD_BYTES, ou après 10 s de retard continu, on coupe : il se reconnectera proprement.
const SLOW_BYTES = 256 * 1024, DEAD_BYTES = 4 * 1024 * 1024;
const mSkipped = new client.Counter({ name: "pn_ws_snaps_skipped_total", help: "Snapshots sautés pour cause de client lent" });
const mKicked = new client.Counter({ name: "pn_ws_slow_closed_total", help: "WebSocket coupées car client trop lent" });
// true si on peut écrire à ce client ; sinon on note qu'il lui faudra un snapshot complet
function writable(ws, now) {
  if (ws.readyState !== 1) return false;
  if (ws.bufferedAmount > SLOW_BYTES) {
    ws.slowSince ??= now;
    mSkipped.inc();
    ws.needFull = true;
    if (ws.bufferedAmount > DEAD_BYTES || now - ws.slowSince > 10_000) { mKicked.inc(); ws.terminate(); }
    return false;
  }
  ws.slowSince = null;
  return true;
}
function broadcastSnap(msg, full) {
  const s = JSON.stringify(msg), now = Date.now();
  for (const ws of sockets) {
    if (!writable(ws, now)) continue;
    ws.needFull = false;
    ws.send(s);
  }
}
// snapshot incrémental filtré par distance, à partir d'entrées déjà sérialisées
function sendSnaps(items) {
  const now = Date.now();
  for (const ws of sockets) {
    if (!writable(ws, now)) continue;
    if (ws.needFull) { ws.needFull = false; ws.send(JSON.stringify(fullSnapshot())); continue; }
    const px = ws.pos?.[0], pz = ws.pos?.[2];
    const out = [];
    for (const it of items) {
      if (px === undefined || it.all || Math.hypot(it.x - px, it.z - pz) < NEAR_M) out.push(it.j);
    }
    if (out.length) ws.send(snapHead + out.join(",") + "]}");
  }
}

// Les états des joueurs de CE pod partent vers Redis en un seul lot par tick (15/s au total, pas 15/s par joueur) :
// Redis et les autres pods traitent N fois moins de messages.
const outbox = new Map(); // id -> état à publier
setInterval(() => {
  if (!outbox.size) return;
  const ps = [...outbox.values()]; outbox.clear();
  if (!store.redisReady()) return; // bascule en cours : la vue locale continue, rien ne s'empile
  store.publish({ k: "pb", pod: store.POD, ps }).catch(() => {});
}, 1000 / 15);

// Snapshots à 15 Hz : seulement les joueurs modifiés (incrémental) ; toutes les 2 s, la liste complète
// avec les champs rares (nom, perso, tenue) — les clients retirent alors ceux qui ont disparu.
// Intérêt par distance : un joueur à plus de NEAR_M mètres n'est mis à jour qu'à 15/FAR_EVERY Hz (>250 m : quelques pixels
// à l'écran). Le snapshot complet reste complet. Chaque entrée est sérialisée UNE fois puis assemblée par client.
const NEAR_M = Number(process.env.NEAR_M || 300), FAR_EVERY = 4;
const fullSnapshot = () => ({ t: "snap", full: 1, players: [...players.values()].map((p) => proto.packPlayer(p, true)) });
const snapHead = '{"t":"snap","players":[';
let snapN = 0, recoveredAt = 0, redisWasUp = true;
const dirtyFar = new Set(); // modifiés depuis le dernier envoi « lointain »
setInterval(() => {
  const now = Date.now();
  const up = store.redisReady();
  if (up && !redisWasUp) recoveredAt = now;
  redisWasUp = up;
  for (const [id, p] of players) if (proto.isStale(p.ts, now, up, recoveredAt)) { players.delete(id); dirty.delete(id); dirtyFar.delete(id); broadcast({ t: "gone", id }); }
  mPlayers.set(players.size);
  if (++snapN % 30 === 0) { broadcastSnap(fullSnapshot(), true); dirty.clear(); dirtyFar.clear(); return; }
  if (!dirty.size && !dirtyFar.size) return;
  const farTick = snapN % FAR_EVERY === 0;
  for (const id of dirty) dirtyFar.add(id);
  const ids = farTick ? [...dirtyFar] : [...dirty];
  const items = [];
  for (const id of ids) {
    const p = players.get(id);
    if (p) items.push({ x: p.p[0], z: p.p[2], j: JSON.stringify(proto.packPlayer(p, false)), all: farTick });
  }
  dirty.clear();
  if (farTick) dirtyFar.clear();
  if (items.length) sendSnaps(items);
}, 1000 / 15);

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
// Événements de ville (chasse aux kubes dorés) et clôture des courses : toutes les secondes, par le leader seulement
setInterval(async () => {
  if (!leader) return;
  try { await game.tickEvents(); await game.tickRaces(); } catch (e) { console.error("tick événements", e.message); }
}, 1000);
let lastTick = Date.now();
setInterval(async () => {
  const now = Date.now(), dt = Math.min(0.5, (now - lastTick) / 1000);
  lastTick = now;
  if (!leader) return;
  try { await game.tickBots(dt); } catch (e) { console.error("tick agents", e.message); }
}, 1000 / 15);

// ---------- HTTP ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream", ".wasm": "application/wasm", ".ogg": "audio/ogg", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".md": "text/plain; charset=utf-8" };

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://x");
  let p = decodeURIComponent(url.pathname);
  if (p === "/") p = "/index.html";
  // le build Vite (client/dist) est la seule racine statique
  for (const base of [DIST]) {
    const file = path.normalize(path.join(base, p));
    if (!file.startsWith(base + path.sep)) return res.writeHead(403).end();
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": p === "/index.html" ? "no-cache" : "public, max-age=300" });
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
      return json(res, 200, { pod: store.POD, version: VERSION, leader: await store.currentLeader().catch(() => null), uptimeSec: Math.round((Date.now() - startedAt) / 1000), clients: sockets.size, players: players.size, protocol: proto.PROTOCOL });
    }
    if (pathname === "/api/status") return json(res, 200, await status.snapshot());
    if (pathname === "/status") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
      return res.end(await fs.readFile(path.join(ROOT, "src", "status.html")));
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

// ---------- WebSocket : le jeu (protocole v2) ----------
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });
const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
// Anti-spam par connexion : vrai si le même type de message est revenu trop tôt (le jeu est public)
const tooSoon = (ws, key, ms) => { const now = Date.now(); ws.rl ||= {}; if (now - (ws.rl[key] || 0) < ms) return true; ws.rl[key] = now; return false; };

wss.on("connection", (ws) => {
  if (draining) return ws.close(1012, "pod en arrêt");
  sockets.add(ws);
  mClients.set(sockets.size);
  let me = null;
  let lastSave = 0;

  ws.on("message", async (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== "object") return;
    mMsgs.inc({ type: String(m.t).slice(0, 12) });
    try {
      if (m.t === "hello") {
        const h = proto.parseHello(m);
        if (h.v !== proto.PROTOCOL) { send(ws, { t: "error", code: "version", need: proto.PROTOCOL }); return ws.close(4001, "protocole non supporté"); }
        const id = proto.isValidId(h.id) ? h.id : game.newId("joueur");
        // Redis absent (bascule Sentinel) : on accueille tout de suite sans l'attendre, le client redemandera son profil
        const up = store.redisReady();
        const read = (f, d) => (up ? f().catch(() => d) : Promise.resolve(d));
        const [saved, profile, chat, races, board, hunt] = await Promise.all([
          read(() => store.loadPlayer(id), null), read(() => store.loadProfile(id), null),
          read(() => store.recentChat(20), []), read(() => store.listRaces(), []), read(() => store.leaderboard(10), []), read(() => store.huntView(), null),
        ]);
        me = { id, name: h.name, ch: h.ch, o: h.o, p: h.p || saved?.p || [0, 0, 0], r: 0, vel: [0, 0, 0], a: "idle", veh: null, seat: 0, st: 0, vh: null };
        send(ws, {
          t: "welcome", v: proto.PROTOCOL, id, pod: store.POD, version: VERSION, sync: store.redisReady(), leader,
          profile, chat, races, board, hunt, now: Date.now(),
        });
        send(ws, fullSnapshot());
        // après une reconnexion (pod tué, mise à jour…), pas de message : le joueur ne doit rien remarquer
        if (!h.re) await store.pushChat({ from: "Radio Kube", text: `${me.name} entre en ville.`, ts: Date.now() });
      } else if (m.t === "ping") {
        send(ws, { t: "pong", ts: m.ts, leader });
      } else if (!me) {
        return;
      } else if (m.t === "state") {
        Object.assign(me, proto.parseState(m));
        if (!me.veh) me.vh = null;
        // vue locale tout de suite (les joueurs du même pod se voient même sans Redis), lot Redis au prochain tick
        ws.pos = me.p;
        const snap = { ...me };
        players.set(me.id, { ...snap, ts: Date.now() }); dirty.add(me.id);
        if (!store.redisReady()) return;
        outbox.set(me.id, snap);
        if (Date.now() - lastSave > 1000) { lastSave = Date.now(); store.savePlayer({ id: me.id, p: me.p }).catch(() => {}); }
      } else if (m.t === "vehicle") {
        // le véhicule part avec le prochain « state » (même cadence), sans second publish
        const v = proto.parseVehicle(m);
        if (v) me.vh = v;
      } else if (m.t === "look") {
        const h = proto.parseHello({ ...m, name: me.name });
        Object.assign(me, { ch: h.ch, o: h.o });
      } else if (m.t === "chat") {
        const text = proto.parseChat(m);
        if (text) await store.pushChat({ from: me.name, text, ts: Date.now() });
      } else if (m.t === "emote") {
        const e = proto.parseEmote(m), now = Date.now();
        if (e && now - (ws.lastEmote || 0) > 600 && store.redisReady()) { ws.lastEmote = now; await store.publish({ k: "emote", id: me.id, e }); }
      } else if (m.t === "event") {
        // événement partagé (course multijoueur, mission coopérative…) : relayé tel quel, taille bornée
        const kind = String(m.kind || "").replace(/[^a-z0-9_.:-]/gi, "").slice(0, 32);
        const data = JSON.stringify(m.data ?? null).length <= 2048 ? (m.data ?? null) : null;
        if (kind) await store.publish({ k: "ev", from: me.id, kind, data });
      } else if (m.t === "profile_save") {
        const profile = proto.parseProfile(m.profile);
        if (!profile) return send(ws, { t: "profile_saved", rid: m.rid, ok: false, reason: "profil invalide ou trop gros" });
        try { await store.saveProfile(me.id, profile); send(ws, { t: "profile_saved", rid: m.rid, ok: true }); }
        catch (e) { send(ws, { t: "profile_saved", rid: m.rid, ok: false, reason: "sauvegarde indisponible" }); }
      } else if (m.t === "profile_load") {
        try { send(ws, { t: "profile", rid: m.rid, ok: true, profile: await store.loadProfile(me.id) }); }
        catch (e) { send(ws, { t: "profile", rid: m.rid, ok: false, profile: null }); }
      } else if (m.t === "race_new") {
        if (tooSoon(ws, "race_new", 15000)) return send(ws, { t: "race_error", reason: "une course à la fois, réessaie dans quelques secondes" });
        try { await game.createRace({ creatorId: me.id, creatorName: me.name, from: { x: me.p[0], z: me.p[2] }, toKey: m.to }); }
        catch (e) { send(ws, { t: "race_error", reason: e.message }); }
      } else if (m.t === "race_join") {
        if (tooSoon(ws, "race_join", 1000)) return;
        send(ws, { t: "joined", ...(await game.joinRace(String(m.raceId), me.id, me.name, me.p)) });
      } else if (m.t === "hunt_claim") {
        if (tooSoon(ws, "hunt_claim", 200)) return;
        send(ws, { t: "hunt_claim", huntId: m.huntId, ...(await game.claimHuntKube(me.id, me.name, me.p, String(m.huntId), Number(m.i))) });
      } else if (m.t === "stat") {
        // gains déclarés par le client (jeu coopératif entre étudiants, pas de compétition à enjeu) : bornés et espacés
        const now = Date.now();
        if (now - (ws.lastStat || 0) >= 2000) {
          ws.lastStat = now;
          const money = Math.min(3000, Math.max(0, Math.round(+m.money || 0))), kubes = Math.min(5, Math.max(0, Math.round(+m.kubes || 0)));
          if (money) await game.recordStat(me.id, me.name, "money", money);
          if (kubes) await game.recordStat(me.id, me.name, "kubes", kubes);
        }
      } else if (m.t === "sboard") {
        if (tooSoon(ws, "sboard", 1000)) return;
        send(ws, { t: "sboard", rows: await store.sessionBoard(12) });
      } else if (m.t === "race_finish") {
        send(ws, { t: "finish", raceId: m.raceId, ...(await game.finish(m.raceId, me.id, me.name)) });
      } else if (m.t === "mission") {
        // mission réussie : petit bonus, plafonné côté serveur
        await store.addScore(me.id, me.name, Math.min(80, Math.max(0, +m.pts || 0)));
      } else if (m.t === "busted") {
        await store.addScore(me.id, me.name, -50);
      } else if (m.t === "board") {
        send(ws, { t: "board", board: await store.leaderboard(10) });
      }
    } catch (e) {
      console.error("ws", e.message);
    }
  });

  ws.on("close", () => {
    sockets.delete(ws);
    if (me) outbox.delete(me.id);
    mClients.set(sockets.size);
    if (me) store.savePlayer({ id: me.id, p: me.p }).catch(() => {});
  });
});

status.start({ version: VERSION, getState: () => ({ ready: !draining, players: players.size, clients: sockets.size, leader }) });
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
  await status.stop();
  await new Promise((r) => setTimeout(r, DRAIN_MS));
  broadcast({ t: "bye", pod: store.POD });
  mDrains.inc(sockets.size);
  for (const ws of sockets) ws.close(1012, "redémarrage du serveur");
  server.close();
  setTimeout(() => process.exit(0), 1500).unref();
  await store.closeStore();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
