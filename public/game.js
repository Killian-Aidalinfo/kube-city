// Kube City : le client. Le jeu tourne localement ; le serveur ne sert qu'à partager la ville.
// Si le pod qui nous sert disparaît, on continue de jouer et on se reconnecte ailleurs.
import { TILE, SIZE, WORLD, T, CITY, drivable, districtAt, PLACES, roadPath, isRoadLine, BLOCK, ROAD } from "/shared/world.js";

const $ = (id) => document.getElementById(id);
const cv = $("c"), ctx = cv.getContext("2d");
const COLORS = ["#ff3cac", "#2de2e6", "#ffd23f", "#39ff88", "#ff7a2f", "#a78bfa"];

// ---------- Identité (gardée dans le navigateur) ----------
const saved = JSON.parse(localStorage.getItem("pn:me") || "{}");
const me = {
  id: saved.id || `joueur-${Math.random().toString(36).slice(2, 10)}`,
  name: saved.name || "", color: saved.color || COLORS[0],
  x: saved.x || PLACES.garage.x, y: saved.y || PLACES.garage.y, a: 0, v: 0, score: 0,
};
const persist = () => localStorage.setItem("pn:me", JSON.stringify({ id: me.id, name: me.name, color: me.color, x: me.x, y: me.y }));

// ---------- Écran d'accueil ----------
let picked = me.color;
for (const c of COLORS) {
  const b = document.createElement("button");
  b.type = "button"; b.style.background = c; if (c === picked) b.className = "sel";
  b.onclick = () => { picked = c; [...$("colors").children].forEach((x) => x.className = ""); b.className = "sel"; };
  $("colors").append(b);
}
$("pseudo").value = me.name;
$("introform").onsubmit = (e) => {
  e.preventDefault();
  me.name = $("pseudo").value.trim().slice(0, 20) || "Anonyme";
  me.color = picked;
  persist();
  $("intro").style.display = "none";
  $("myname").textContent = me.name;
  connect();
  requestAnimationFrame(loop);
};

// ---------- Réseau : reconnexion automatique ----------
let ws = null, pod = "—", version = "—", reconnects = 0, prevPod = null, ping = 0, retry = 0, everConnected = false;
const others = new Map(); // id -> { cur, target, name, color, bot }
const races = new Map();
let chat = [], board = [];

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    retry = 0;
    send({ t: "hello", id: me.id, name: me.name, color: me.color, x: me.x, y: me.y, re: everConnected ? 1 : 0 });
  };
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  ws.onclose = () => {
    $("status").className = "hud panel off";
    if (everConnected) reconnects++;
    // petit délai aléatoire : tous les joueurs ne se reconnectent pas pile en même temps
    const delay = Math.min(3000, 200 * 2 ** retry++) * (0.5 + Math.random());
    setTimeout(connect, delay);
  };
}
const send = (m) => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));

function onMessage(m) {
  if (m.t === "welcome") {
    $("status").className = "hud panel";
    if (everConnected && prevPod && prevPod !== m.pod) toast(`Reconnecté sur ${m.pod}`, 1800, "#2de2e6");
    everConnected = true; prevPod = m.pod;
    pod = m.pod; version = m.version;
    me.id = m.id; persist();
    chat = m.chat || []; board = m.board || [];
    for (const r of m.races || []) races.set(r.id, r);
    renderChat(); renderBoard();
  } else if (m.t === "snap") {
    const seen = new Set();
    for (const p of m.players) {
      if (p.id === me.id) continue;
      seen.add(p.id);
      const o = others.get(p.id);
      if (o) { o.target = p; o.name = p.n; o.color = p.c; }
      else others.set(p.id, { cur: { ...p }, target: p, name: p.n, color: p.c, bot: p.b });
    }
    for (const id of others.keys()) if (!seen.has(id)) others.delete(id);
  } else if (m.t === "chat") {
    chat.push(m.msg); chat = chat.slice(-12); renderChat();
  } else if (m.t === "race") {
    races.set(m.race.id, m.race);
  } else if (m.t === "joined") {
    myRace = { id: m.raceId, cp: 0 };
    toast("Inscrit ! Rejoignez la ligne de départ", 1600, "#ffd23f");
  } else if (m.t === "finish") {
    if (m.ok) toast(`Arrivée : ${m.place === 1 ? "1er" : m.place + "e"} (+${m.prize})`, 2500, "#39ff88");
    else toast(m.reason, 1600, "#ff5b5b");
    myRace = null; send({ t: "board" });
  } else if (m.t === "board") {
    board = m.board; renderBoard();
  } else if (m.t === "pong") {
    ping = Math.round(performance.now() - m.ts);
  } else if (m.t === "bye") {
    toast(`${m.pod} s'arrête, on change de serveur…`, 1400, "#ffd23f");
  }
}
setInterval(() => send({ t: "ping", ts: performance.now() }), 2000);
setInterval(() => send({ t: "state", x: me.x, y: me.y, a: me.a, v: me.v }), 100);
setInterval(() => { persist(); send({ t: "board" }); }, 5000);
setInterval(async () => {
  try { const i = await (await fetch("/api/info", { cache: "no-store" })).json(); leader = i.leader; } catch { /* pod en cours de remplacement */ }
}, 3000);
let leader = "—";

// ---------- Entrées ----------
const keys = new Set();
let typing = false, menuOpen = false;
addEventListener("keydown", (e) => {
  if (typing) return;
  const k = e.key.toLowerCase();
  if (menuOpen) { onMenuKey(k); return; }
  if (k === "t") { e.preventDefault(); openChat(); return; }
  if (k === "n") { openRaceMenu(); return; }
  if (k === "r") { joinNearestRace(); return; }
  if (k === "m") { newMission(); return; }
  keys.add(k);
  if (k.startsWith("arrow") || k === " ") e.preventDefault();
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
const down = (...ks) => ks.some((k) => keys.has(k));

function openChat() {
  typing = true; keys.clear();
  const i = $("chatin"); i.style.display = "block"; i.value = ""; i.focus();
}
$("chatin").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { const text = e.target.value.trim(); if (text) send({ t: "chat", text }); }
  if (e.key === "Enter" || e.key === "Escape") { typing = false; e.target.blur(); e.target.style.display = "none"; }
  e.stopPropagation();
});

// ---------- Courses de rue ----------
let myRace = null; // { id, cp }
const placeKeys = Object.keys(PLACES);
function openRaceMenu() {
  menuOpen = true;
  $("menu").innerHTML = "<h3>Lancer une course vers…</h3>" + placeKeys.map((k, i) => `<div>${i + 1}. ${PLACES[k].label}</div>`).join("") + "<div style='color:#c9c3e6;margin-top:6px'>Échap pour annuler</div>";
  $("menu").style.display = "block";
}
function onMenuKey(k) {
  const n = Number(k);
  if (n >= 1 && n <= placeKeys.length) send({ t: "race_new", to: placeKeys[n - 1] });
  if (k === "escape" || (n >= 1 && n <= placeKeys.length)) { menuOpen = false; $("menu").style.display = "none"; }
}
function raceState(r, now = Date.now()) {
  if (now < r.startAt) return "inscriptions";
  if (now < r.startAt + 5 * 60_000) return "en cours";
  return "terminée";
}
function joinNearestRace() {
  const open = [...races.values()].filter((r) => raceState(r) !== "terminée");
  if (!open.length) { toast("Aucune course ouverte : N pour en lancer une", 1600, "#ffd23f"); return; }
  open.sort((a, b) => Math.hypot(a.from.x - me.x, a.from.y - me.y) - Math.hypot(b.from.x - me.x, b.from.y - me.y));
  send({ t: "race_join", raceId: open[0].id });
}
function updateRace() {
  const el = $("race");
  if (!myRace) { el.style.display = "none"; return; }
  const r = races.get(myRace.id);
  if (!r) return;
  const st = raceState(r);
  el.style.display = "block";
  if (st === "inscriptions") {
    const s = Math.ceil((r.startAt - Date.now()) / 1000);
    const d = Math.hypot(r.from.x - me.x, r.from.y - me.y);
    el.innerHTML = `Course vers <b>${r.toLabel}</b> · départ dans <b>${s} s</b>${d > 300 ? " · rejoignez la ligne de départ !" : ""}`;
  } else if (st === "en cours") {
    const cp = r.checkpoints[myRace.cp];
    el.innerHTML = `GO ! Point ${myRace.cp + 1}/${r.checkpoints.length} · ${((Date.now() - r.startAt) / 1000).toFixed(1)} s`;
    if (cp && Math.hypot(cp.x - me.x, cp.y - me.y) < 90) {
      myRace.cp++;
      if (myRace.cp >= r.checkpoints.length) send({ t: "race_finish", raceId: r.id });
    }
  } else { myRace = null; }
}

// ---------- Missions de livraison ----------
let mission = null; // { stage: 'pickup'|'drop', from, to, startedAt }
function newMission() {
  const ks = [...placeKeys].sort(() => Math.random() - 0.5);
  mission = { stage: "pickup", from: PLACES[ks[0]], to: PLACES[ks[1]], startedAt: Date.now() };
  toast(`Mission : colis à récupérer à ${mission.from.label}`, 2000, "#39ff88");
}
function updateMission() {
  if (!mission) return;
  const tgt = mission.stage === "pickup" ? mission.from : mission.to;
  if (Math.hypot(tgt.x - me.x, tgt.y - me.y) < 80) {
    if (mission.stage === "pickup") { mission.stage = "drop"; mission.startedAt = Date.now(); toast(`Livrez à ${mission.to.label} !`, 1600, "#39ff88"); }
    else {
      const sec = (Date.now() - mission.startedAt) / 1000;
      const pts = Math.max(20, Math.round(80 - sec));
      send({ t: "mission", pts }); toast(`Livré ! +${pts}`, 1600, "#39ff88"); mission = null;
    }
  }
}

// ---------- Trafic et police (locaux, propres à chaque joueur) ----------
const roadCenters = [];
for (let b = 0; b * BLOCK < SIZE; b++) roadCenters.push((b * BLOCK + ROAD / 2) * TILE);
function spawnTraffic() {
  const horiz = Math.random() < 0.5;
  const lane = roadCenters[Math.floor(Math.random() * roadCenters.length)];
  const along = Math.random() * WORLD * 0.9;
  const dir = Math.random() < 0.5 ? 1 : -1;
  const x = horiz ? along : lane + dir * 18, y = horiz ? lane + dir * 18 : along;
  return { x, y, horiz, dir, speed: 120 + Math.random() * 120, color: `hsl(${Math.floor(Math.random() * 360)},70%,60%)` };
}
const traffic = Array.from({ length: 90 }, spawnTraffic);
let wanted = 0, wantedAt = 0, cops = [], bustedFor = 0, crashCooldown = 0;

function updateTraffic(dt) {
  for (const c of traffic) {
    const nx = c.x + (c.horiz ? c.dir : 0) * c.speed * dt, ny = c.y + (c.horiz ? 0 : c.dir) * c.speed * dt;
    if (!drivable(nx, ny) || nx < 0 || ny < 0 || nx > WORLD || ny > WORLD) Object.assign(c, spawnTraffic());
    else { c.x = nx; c.y = ny; }
    if (Math.hypot(c.x - me.x, c.y - me.y) < 34 && Math.abs(me.v) > 120 && crashCooldown <= 0) {
      me.v *= -0.3; crashCooldown = 1;
      wanted = Math.min(3, wanted + 1); wantedAt = Date.now();
      toast("Accident ! La police vous recherche", 1200, "#ff5b5b");
    }
  }
  crashCooldown -= dt;
}

function updateCops(dt) {
  while (cops.length < wanted) {
    const a = Math.random() * Math.PI * 2;
    const x = me.x + Math.cos(a) * 900, y = me.y + Math.sin(a) * 900;
    cops.push({ x: roadCenters.reduce((p, c) => Math.abs(c - x) < Math.abs(p - x) ? c : p), y, path: [], repath: 0 });
  }
  if (wanted === 0) cops = [];
  let close = false;
  for (const c of cops) {
    c.repath -= dt;
    if (c.repath <= 0) { c.path = roadPath(c, me); c.repath = 0.8; }
    let budget = 400 * dt;
    while (budget > 0 && c.path.length) {
      const t = c.path[0], dx = t.x - c.x, dy = t.y - c.y, d = Math.hypot(dx, dy);
      if (d < 2) { c.path.shift(); continue; }
      const s = Math.min(budget, d); c.x += dx / d * s; c.y += dy / d * s; budget -= s; c.a = Math.atan2(dy, dx);
    }
    if (Math.hypot(c.x - me.x, c.y - me.y) < 700) close = true;
    if (Math.hypot(c.x - me.x, c.y - me.y) < 45 && Math.abs(me.v) < 80) bustedFor += dt;
  }
  if (close) wantedAt = Date.now();
  if (wanted > 0 && Date.now() - wantedAt > 15_000) { wanted = 0; toast("Vous avez semé la police", 1500, "#39ff88"); }
  if (bustedFor > 1.5) {
    bustedFor = 0; wanted = 0; cops = []; send({ t: "busted" });
    me.x = PLACES.garage.x; me.y = PLACES.garage.y; me.v = 0;
    toast("ARRÊTÉ ! −50", 2200, "#ff5b5b");
  }
  if (!cops.length) bustedFor = 0;
}

// ---------- Conduite ----------
function drive(dt) {
  const acc = down("arrowup", "z", "w") ? 520 : down("arrowdown", "s") ? -420 : 0;
  const steer = (down("arrowleft", "q", "a") ? -1 : 0) + (down("arrowright", "d") ? 1 : 0);
  const hand = down(" ");
  me.v += acc * dt;
  me.v *= hand ? 0.94 : acc ? 0.995 : 0.985;
  me.v = Math.max(-200, Math.min(520, me.v));
  const grip = Math.min(1, Math.abs(me.v) / 160);
  me.a += steer * (hand ? 3.4 : 2.6) * grip * dt * Math.sign(me.v || 1);
  const nx = me.x + Math.cos(me.a) * me.v * dt, ny = me.y + Math.sin(me.a) * me.v * dt;
  if (drivable(nx + Math.cos(me.a) * 18 * Math.sign(me.v), ny + Math.sin(me.a) * 18 * Math.sign(me.v))) { me.x = nx; me.y = ny; }
  else if (drivable(nx, me.y)) { me.x = nx; me.v *= 0.6; }
  else if (drivable(me.x, ny)) { me.y = ny; me.v *= 0.6; }
  else me.v *= -0.35;
}

// ---------- Rendu ----------
let W = 0, H = 0, cam = { x: me.x, y: me.y };
function resize() { W = cv.width = innerWidth * devicePixelRatio; H = cv.height = innerHeight * devicePixelRatio; }
addEventListener("resize", resize); resize();

const tileColor = { [T.ROAD]: "#1b1530", [T.PARK]: "#0f3a2a", [T.WATER]: "#06204a", [T.SAND]: "#4a3a22", [T.PLAZA]: "#2a1f45" };
function drawCity(z) {
  const x0 = Math.max(0, Math.floor((cam.x - W / 2 / z) / TILE)), x1 = Math.min(SIZE - 1, Math.ceil((cam.x + W / 2 / z) / TILE));
  const y0 = Math.max(0, Math.floor((cam.y - H / 2 / z) / TILE)), y1 = Math.min(SIZE - 1, Math.ceil((cam.y + H / 2 / z) / TILE));
  // origine du lot (immeuble de 2 x 2 cases) aligné sur le bord du pâté de maisons
  const lot = (v) => v - (((v % BLOCK) - ROAD) % 2);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * SIZE + x, t = CITY.tiles[i], px = x * TILE, py = y * TILE;
    if (t === T.BUILDING) {
      const lx = lot(x), ly = lot(y), hue = districtAt(px, py).hue, h = CITY.height[ly * SIZE + lx];
      ctx.fillStyle = `hsl(${hue},40%,${8 + h * 1.4}%)`; ctx.fillRect(px, py, TILE, TILE);
    } else {
      ctx.fillStyle = tileColor[t]; ctx.fillRect(px, py, TILE, TILE);
      if (t === T.ROAD && isRoadLine(x) !== isRoadLine(y) && (x + y) % 2 === 0) {
        ctx.fillStyle = "rgba(255,210,63,.35)";
        if (isRoadLine(x) && x % BLOCK === 1) ctx.fillRect(px + TILE / 2 - 2, py + 10, 4, 20);
        if (isRoadLine(y) && y % BLOCK === 1) ctx.fillRect(px + 10, py + TILE / 2 - 2, 20, 4);
      }
      if (t === T.PARK && (x * 7 + y * 13) % 6 === 0) { ctx.fillStyle = "#1f7a4c"; ctx.beginPath(); ctx.arc(px + 20, py + 20, 12, 0, 7); ctx.fill(); }
    }
  }
  // deuxième passe : contours et toits, une fois toutes les cases peintes
  for (let y = y0 - 1; y <= y1; y++) for (let x = x0 - 1; x <= x1; x++) {
    if (x < 0 || y < 0 || CITY.tiles[y * SIZE + x] !== T.BUILDING || lot(x) !== x || lot(y) !== y) continue;
    const px = x * TILE, py = y * TILE, hue = districtAt(px, py).hue, h = CITY.height[y * SIZE + x];
    const w = (CITY.tiles[y * SIZE + x + 1] === T.BUILDING ? 2 : 1) * TILE, hh = (CITY.tiles[(y + 1) * SIZE + x] === T.BUILDING ? 2 : 1) * TILE;
    ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 4; ctx.strokeRect(px + 2, py + 2, w - 4, hh - 4);
    ctx.strokeStyle = `hsla(${hue},100%,65%,${0.15 + h / 25})`; ctx.lineWidth = 2; ctx.strokeRect(px + 9, py + 9, w - 18, hh - 18);
    if (h > 8) { ctx.fillStyle = `hsla(${hue},100%,70%,.85)`; ctx.fillRect(px + w / 2 - 6, py + hh / 2 - 6, 12, 12); }
  }
}
function car(x, y, a, color, glow) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 18; }
  ctx.fillStyle = color; ctx.fillRect(-20, -11, 40, 22);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fillRect(-4, -9, 14, 18);
  ctx.fillStyle = "#fff8c0"; ctx.fillRect(17, -9, 4, 5); ctx.fillRect(17, 4, 4, 5);
  ctx.restore();
}
function label(text, x, y, color) {
  ctx.font = "bold 14px system-ui"; ctx.textAlign = "center";
  ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}
function ring(x, y, color, r = 60) {
  ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.shadowColor = color; ctx.shadowBlur = 20;
  ctx.beginPath(); ctx.arc(x, y, r + Math.sin(performance.now() / 200) * 6, 0, 7); ctx.stroke(); ctx.shadowBlur = 0;
}
function arrowTo(t, color) {
  const a = Math.atan2(t.y - me.y, t.x - me.x);
  ctx.save(); ctx.translate(me.x + Math.cos(a) * 70, me.y + Math.sin(a) * 70); ctx.rotate(a);
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9); ctx.fill(); ctx.restore();
}

function render() {
  const z = devicePixelRatio * Math.max(0.55, 1 - Math.abs(me.v) / 1500);
  cam.x += (me.x - cam.x) * 0.15; cam.y += (me.y - cam.y) * 0.15;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#06204a"; ctx.fillRect(0, 0, W, H);
  ctx.setTransform(z, 0, 0, z, W / 2 - cam.x * z, H / 2 - cam.y * z);
  drawCity(z);
  for (const [k, p] of Object.entries(PLACES)) { ctx.fillStyle = "rgba(45,226,230,.12)"; ctx.beginPath(); ctx.arc(p.x, p.y, 46, 0, 7); ctx.fill(); label(p.label, p.x, p.y - 54, "#2de2e6"); void k; }
  for (const r of races.values()) {
    const st = raceState(r);
    if (st === "inscriptions") { ring(r.from.x, r.from.y, "#ffd23f", 70); label(`Course → ${r.toLabel}`, r.from.x, r.from.y - 84, "#ffd23f"); }
  }
  if (myRace) {
    const r = races.get(myRace.id);
    if (r && raceState(r) === "en cours" && r.checkpoints[myRace.cp]) { const cp = r.checkpoints[myRace.cp]; ring(cp.x, cp.y, "#ffd23f"); arrowTo(cp, "#ffd23f"); }
    else if (r && raceState(r) === "inscriptions") arrowTo(r.from, "#ffd23f");
  }
  if (mission) { const t = mission.stage === "pickup" ? mission.from : mission.to; ring(t.x, t.y, "#39ff88"); arrowTo(t, "#39ff88"); }
  for (const c of traffic) car(c.x, c.y, c.horiz ? (c.dir > 0 ? 0 : Math.PI) : (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2), c.color, false);
  for (const c of cops) car(c.x, c.y, c.a || 0, Math.floor(performance.now() / 150) % 2 ? "#3b82f6" : "#ef4444", true);
  for (const o of others.values()) {
    o.cur.x += (o.target.x - o.cur.x) * 0.25; o.cur.y += (o.target.y - o.cur.y) * 0.25; o.cur.a = o.target.a;
    car(o.cur.x, o.cur.y, o.cur.a, o.color, true);
    label(o.bot ? `🤖 ${o.name}` : o.name, o.cur.x, o.cur.y - 28, o.bot ? "#39ff88" : "#fff");
  }
  car(me.x, me.y, me.a, me.color, true);
  label(me.name, me.x, me.y - 28, me.color);
  drawMinimap();
}

function drawMinimap() {
  const s = 200 * devicePixelRatio, k = s / WORLD, ox = W - s - 12 * devicePixelRatio, oy = H - s - 12 * devicePixelRatio;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 0.85; ctx.drawImage(minimap, ox, oy, s, s); ctx.globalAlpha = 1;
  const dot = (x, y, c, r = 3) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(ox + x * k, oy + y * k, r * devicePixelRatio, 0, 7); ctx.fill(); };
  for (const o of others.values()) dot(o.cur.x, o.cur.y, o.bot ? "#39ff88" : o.color);
  for (const c of cops) dot(c.x, c.y, "#ef4444");
  dot(me.x, me.y, "#fff", 4);
}
const minimap = document.createElement("canvas");
minimap.width = minimap.height = SIZE;
{
  const m = minimap.getContext("2d");
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const t = CITY.tiles[y * SIZE + x];
    m.fillStyle = t === T.BUILDING ? `hsl(${districtAt(x * TILE, y * TILE).hue},40%,22%)` : tileColor[t];
    m.fillRect(x, y, 1, 1);
  }
}

// ---------- HUD ----------
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }
function renderChat() {
  $("chat").innerHTML = chat.slice(-8).map((m) => `<div class="line"><span class="${m.from === "Radio Kube" ? "radio" : "from"}">${esc(m.from)}</span> : ${esc(m.text)}</div>`).join("");
}
function renderBoard() {
  $("boardlist").innerHTML = board.map((b) => `<li>${esc(b.name)} <b>${b.score}</b></li>`).join("");
  const mine = board.find((b) => b.id === me.id); if (mine) $("score").textContent = mine.score;
}
let toastUntil = 0;
function toast(text, ms, color) {
  const t = $("toast"); t.textContent = text; t.style.color = color; t.style.display = "block"; toastUntil = performance.now() + ms;
}
function hud() {
  $("server").innerHTML = `Servi par <b>${esc(pod)}</b><br>Version <b>${esc(version)}</b> · ping ${ping} ms<br>Reconnexions : <b>${reconnects}</b> · leader IA : ${esc(leader || "—")}<br>${esc(districtAt(me.x, me.y).name)} · ${Math.round(Math.abs(me.v) / 4)} km/h`;
  $("stars").textContent = "★".repeat(wanted) + "☆".repeat(3 - wanted);
  if (performance.now() > toastUntil) $("toast").style.display = "none";
}

// ---------- Boucle ----------
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!typing && !menuOpen) drive(dt);
  updateTraffic(dt); updateCops(dt); updateMission(); updateRace();
  render(); hud();
  requestAnimationFrame(loop);
}
