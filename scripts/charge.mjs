#!/usr/bin/env node
// Simulateur de charge : N joueurs (WebSocket protocole v2, sans navigateur) qui se déplacent et conduisent,
// plus quelques agents IA (MCP). Mesure ce que vivent les joueurs pendant les épreuves de chaos.
//   node scripts/charge.mjs --players 60 --agents 3 --duration 60 [--url http://localhost:8080]
//   --docker           échantillonne CPU/mémoire des conteneurs (docker stats)
//   --chaos redis@20,pod@35   chaos pendant la charge (docker compose : tue le maître Redis, un pod de jeu)
//   --churn 45         chaque joueur se déconnecte puis revient (nouvel identifiant) toutes les ~45 s (endurance)
//   --redis-service auto  (Sentinel) tue le maître courant ; --redis-back 25  le redémarre 25 s après (il revient en réplica)
//   --redis-service redis-a   service Redis à tuer (redis par défaut, redis-a avec Sentinel)
import { spawn, execFile } from "node:child_process";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : (process.argv[i + 1]?.startsWith("--") || i + 1 >= process.argv.length ? true : process.argv[i + 1]); };
const BASE = String(arg("url", "http://localhost:8080")).replace(/\/$/, "");
const WS_URL = BASE.replace(/^http/, "ws") + "/ws";
const N = +arg("players", 30), AGENTS = +arg("agents", 3), DURATION = +arg("duration", 60);
const CHURN = +arg("churn", 0), HZ = 15, DOCKER = !!arg("docker", false), REDIS_SVC = String(arg("redis-service", "redis"));
const chaos = String(arg("chaos", "")).split(",").filter(Boolean).map((c) => { const [what, at] = c.split("@"); return { what, at: +at }; });
const t0 = Date.now(), now = () => performance.now();

const st = { rx: 0, rxBytes: 0, tx: 0, snaps: 0, snapEntries: 0, lat: [], rtt: [], gaps: [], drops: 0, reconnects: [], opened: 0, errors: 0, msgsByType: {} };
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10; };

class Bot {
  constructor(i) {
    this.i = i; this.id = `charge-${String(i).padStart(3, "0")}-${Date.now().toString(36)}`;
    this.x = (Math.random() - 0.5) * 1000; this.z = (Math.random() - 0.5) * 1000; this.yaw = Math.random() * 6.28;
    this.driving = i % 2 === 0; this.seq = 0; this.sent = new Map(); this.everOpen = false; this.closedAt = 0; this.attempt = 0; this.lastSnap = 0;
    this.open();
    if (CHURN) this.scheduleChurn();
  }
  // Endurance : le joueur part pour de bon (fermeture propre), puis un « nouveau » joueur arrive avec un autre id
  scheduleChurn() {
    this.churnTimer = setTimeout(() => {
      if (this.stopped) return;
      this.stopped = true; clearInterval(this.timer); clearInterval(this.ping); this.ws?.close();
      setTimeout(() => {
        this.id = `charge-${String(this.i).padStart(3, "0")}-${Date.now().toString(36)}`; this.stopped = false;
        this.everOpen = false; this.closedAt = 0; this.attempt = 0; this.sent.clear(); this.open(); this.scheduleChurn();
      }, 500 + Math.random() * 4000);
    }, CHURN * 1000 * (0.5 + Math.random()));
  }
  open() {
    const ws = this.ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      this.opened = true;
      ws.send(JSON.stringify({ t: "hello", v: 2, id: this.id, name: `Charge${this.i}`, ch: "ines", re: this.everOpen, p: [this.x, 0, this.z] }));
      this.timer = setInterval(() => this.tick(), 1000 / HZ);
      this.ping = setInterval(() => this.send({ t: "ping", ts: now() }), 2000);
    };
    ws.onmessage = (e) => {
      const raw = typeof e.data === "string" ? e.data : ""; st.rx++; st.rxBytes += raw.length;
      let m; try { m = JSON.parse(raw); } catch { return; }
      st.msgsByType[m.t] = (st.msgsByType[m.t] || 0) + 1;
      if (m.t === "welcome") {
        st.opened++;
        if (this.closedAt) { st.reconnects.push(now() - this.closedAt); this.closedAt = 0; }
        this.everOpen = true; this.attempt = 0;
      } else if (m.t === "pong") st.rtt.push(now() - m.ts);
      else if (m.t === "snap") {
        const t = now(); st.snaps++; st.snapEntries += m.players.length;
        if (this.lastSnap) st.gaps.push(t - this.lastSnap);
        this.lastSnap = t;
        for (const p of m.players) if (p.id === this.id) {
          const k = Math.round(p.p[1] * 100), s = this.sent.get(k);
          if (s !== undefined) { st.lat.push(t - s); this.sent.delete(k); }
        }
      }
    };
    ws.onclose = () => {
      clearInterval(this.timer); clearInterval(this.ping);
      if (this.stopped) { this.opened = false; return; }
      if (this.opened && this.everOpen) { st.drops++; if (!this.closedAt) this.closedAt = now(); }
      else if (!this.closedAt && this.everOpen) this.closedAt = now();
      this.opened = false;
      if (!this.stopped) setTimeout(() => this.open(), 100 + Math.random() * Math.min(5000, 250 * 2 ** this.attempt++));
    };
    ws.onerror = () => { st.errors++; };
  }
  send(o) { if (this.ws?.readyState === 1) { this.ws.send(JSON.stringify(o)); st.tx++; } }
  tick() {
    const dt = 1 / HZ, speed = this.driving ? 14 : 3;
    if (Math.random() < 0.02) this.yaw += (Math.random() - 0.5) * 2;
    this.x += Math.sin(this.yaw) * speed * dt; this.z += Math.cos(this.yaw) * speed * dt;
    if (Math.abs(this.x) > 580 || Math.abs(this.z) > 580) this.yaw += Math.PI;
    const r2 = (v) => Math.round(v * 100) / 100;
    this.seq = (this.seq + 1) % 4000; // le « y » sert de marqueur : on mesure le temps état -> snapshot
    this.sent.set(this.seq, now()); if (this.sent.size > 200) this.sent.delete(this.sent.keys().next().value);
    const p = [r2(this.x), this.seq / 100, r2(this.z)];
    if (this.driving) this.send({ t: "vehicle", id: `${this.id}-v`, type: "sedan", p, q: [0, Math.sin(this.yaw / 2), 0, Math.cos(this.yaw / 2)], w: [0, 0], col: "#39ff88", sir: 0, li: 1 });
    this.send({ t: "state", p, r: r2(this.yaw), vel: [r2(Math.sin(this.yaw) * speed), 0, r2(Math.cos(this.yaw) * speed)], a: this.driving ? "drive" : "walk", veh: this.driving ? `${this.id}-v` : null, seat: 0, st: 0 });
    if (Math.random() < 0.0015) this.send({ t: "mission", pts: 10 }); // alimente le classement (pn:scores, pn:names)
    if (Math.random() < 0.002) this.send({ t: "chat", text: "salut depuis la charge" });
  }
}

// key : un X-Kube-Key par « étudiant » (sans clé, tous les agents partagent le quota perKey de l'IP : 3 par défaut)
async function mcp(name, args, key) {
  const r = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(key ? { "x-kube-key": key } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }) });
  const txt = await r.text(); const line = txt.split("\n").find((l) => l.startsWith("data:")) || txt;
  try { return JSON.parse(line.replace(/^data:\s*/, "")).result; } catch { return null; }
}

const docker = [];
function sampleDocker() {
  execFile("docker", ["stats", "--no-stream", "--format", "{{.Name}} {{.CPUPerc}} {{.MemUsage}}"], (err, out) => {
    if (err) return;
    for (const l of out.trim().split("\n")) {
      const [name, cpu, mem] = l.split(/\s+/); if (!/game|redis|lb/.test(name)) continue;
      const mb = parseFloat(mem) * (/GiB/.test(mem) ? 1024 : /KiB/.test(mem) ? 1 / 1024 : 1);
      docker.push({ name: name.replace(/^.*?-(game|redis|lb|sentinel)/, "$1").replace(/-1$/, ""), cpu: parseFloat(cpu), mem: mb });
    }
  });
}

const bots = Array.from({ length: N }, (_, i) => new Bot(i));
const RUN = Math.random().toString(16).slice(2, 8);
const agentIds = [];
for (let i = 0; i < AGENTS; i++) {
  const key = `charge-${RUN}-${i}`;
  const r = await mcp("spawn_agent", { name: `Agent-charge-${i}` }, key);
  const id = (() => { try { return JSON.parse(r.content[0].text).agentId; } catch { return null; } })();
  if (id) agentIds.push({ id, key }); else console.error(`agent ${i} non créé : ${r?.content?.[0]?.text ?? "pas de réponse MCP"}`);
}
const places = ["aeroport", "port", "mairie", "stade", "phare"];
const agentTimer = setInterval(() => agentIds.forEach(({ id, key }) => mcp("drive_to", { agentId: id, place: places[Math.floor(Math.random() * places.length)] }, key).catch(() => {})), 20000);

const compose = (...a) => spawn("docker", ["compose", ...a], { stdio: "ignore" });
const BACK = +arg("redis-back", 0);
const sh = (...a) => new Promise((r) => execFile("docker", ["compose", ...a], { timeout: 15000 }, (e, out) => r(e ? "" : out)));
async function masterService() { // variante Sentinel : le maître change à chaque bascule
  if (REDIS_SVC !== "auto") return REDIS_SVC;
  for (const svc of ["redis-a", "redis-b", "redis-c"]) if ((await sh("exec", "-T", svc, "redis-cli", "role")).startsWith("master")) return svc;
  return "redis-a";
}
for (const c of chaos) setTimeout(() => {
  console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] CHAOS ${c.what}`);
  if (c.what === "redis") masterService().then((svc) => { console.log(`  maître : ${svc}`); compose("kill", svc); if (BACK) setTimeout(() => compose("start", svc), BACK * 1000); });
  else if (c.what === "pod") { compose("kill", "game-2"); setTimeout(() => compose("start", "game-2"), 20000); } // le pod « revient » comme sous Kubernetes
  else if (c.what === "podrestart") compose("restart", "game-2");
}, c.at * 1000);

let last = { rx: 0, tx: 0, b: 0 };
const report = setInterval(() => {
  if (DOCKER) sampleDocker();
  const up = bots.filter((b) => b.opened).length;
  console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] connectés ${up}/${N}  rx ${((st.rx - last.rx) / 5).toFixed(0)}/s ${((st.rxBytes - last.b) / 5 / 1024).toFixed(0)} Ko/s  tx ${((st.tx - last.tx) / 5).toFixed(0)}/s  lat p50/p95 ${pct(st.lat, .5)}/${pct(st.lat, .95)} ms  coupures ${st.drops}`);
  last = { rx: st.rx, tx: st.tx, b: st.rxBytes };
}, 5000);

let finishing = false;
async function finish() {
  if (finishing) return; finishing = true;
  clearInterval(report); clearInterval(agentTimer);
  await new Promise((r) => setTimeout(r, 6000)); // laisse les reconnexions finir
  const up = bots.filter((b) => b.opened).length;
  for (const b of bots) { b.stopped = true; b.ws?.close(); }
  for (const { id, key } of agentIds) await mcp("despawn_agent", { agentId: id }, key).catch(() => {});
  const secs = Math.max(1, Math.round((Date.now() - t0) / 1000)), perPod = {};
  for (const d of docker) (perPod[d.name] ||= []).push(d);
  const dockerSum = Object.fromEntries(Object.entries(perPod).map(([k, v]) => [k, { cpuMoy: Math.round(v.reduce((a, x) => a + x.cpu, 0) / v.length), cpuMax: Math.round(Math.max(...v.map((x) => x.cpu))), memMaxMo: Math.round(Math.max(...v.map((x) => x.mem))) }]));
  const out = {
    joueurs: N, agents: agentIds.length, dureeS: DURATION, connectesALaFin: up,
    rxMsgParSec: Math.round(st.rx / secs), rxKoParSec: Math.round(st.rxBytes / secs / 1024), txMsgParSec: Math.round(st.tx / secs),
    snapsParSecParJoueur: +(st.snaps / secs / N).toFixed(1), entreesParSnap: +(st.snapEntries / Math.max(1, st.snaps)).toFixed(1), octetsParSnapMoy: Math.round(st.rxBytes / Math.max(1, st.rx)),
    latenceEtatSnapMs: { p50: pct(st.lat, .5), p95: pct(st.lat, .95), p99: pct(st.lat, .99) }, rttPingMs: { p50: pct(st.rtt, .5), p95: pct(st.rtt, .95) },
    ecartEntreSnapsMs: { p50: pct(st.gaps, .5), p99: pct(st.gaps, .99), max: pct(st.gaps, 1) },
    deconnexions: st.drops, reconnexionsMs: { n: st.reconnects.length, p50: pct(st.reconnects, .5), max: pct(st.reconnects, 1) }, erreursWs: st.errors,
    docker: dockerSum,
  };
  console.log("\nBILAN\n" + Object.entries(out).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`).join("\n"));
  process.exit(0);
}
setTimeout(finish, DURATION * 1000);
process.on("SIGTERM", finish); // bilan anticipé (utilisé par playtest/multi.mjs)
