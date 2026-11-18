#!/usr/bin/env node
// Sonde de disponibilité : mesure ce que vit un joueur pendant les épreuves de chaos.
// Chaque seconde : une requête HTTP sur /api/info, et une WebSocket de jeu qui doit rester vivante.
//   node scripts/sonde.mjs https://jeu.mon-groupe.fr        (Ctrl+C pour le bilan)
const base = (process.argv[2] || "http://localhost:8080").replace(/\/$/, "");
const wsUrl = base.replace(/^http/, "ws") + "/ws";
let ok = 0, ko = 0, wsUpSec = 0, wsDownSec = 0, reconnects = 0, wsOpen = false;
const pods = new Map();
const started = Date.now();

function openWs() {
  const ws = new WebSocket(wsUrl);
  ws.onopen = () => { wsOpen = true; ws.send(JSON.stringify({ t: "hello", id: "sonde-ha", name: "Sonde", color: "#ffffff", re: reconnects ? 1 : 0 })); };
  ws.onclose = () => { if (wsOpen) reconnects++; wsOpen = false; setTimeout(openWs, 200); };
  ws.onerror = () => {};
}
openWs();

setInterval(async () => {
  const t0 = Date.now();
  try {
    const r = await fetch(`${base}/api/info`, { signal: AbortSignal.timeout(2000), cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    const i = await r.json();
    ok++; pods.set(i.pod, (pods.get(i.pod) || 0) + 1);
    line(`HTTP ${Date.now() - t0} ms via ${i.pod} v${i.version}`);
  } catch (e) {
    ko++; line(`HTTP ÉCHEC (${e.message})`);
  }
  if (wsOpen) wsUpSec++; else wsDownSec++;
}, 1000);

function pct(a, b) { return b ? ((a / (a + b)) * 100).toFixed(2) : "100.00"; }
function line(msg) {
  process.stdout.write(`\r\x1b[K[${new Date().toLocaleTimeString()}] dispo HTTP ${pct(ok, ko)} % · jeu ${pct(wsUpSec, wsDownSec)} % · reconnexions ${reconnects} · ${msg}`);
}
process.on("SIGINT", () => {
  const min = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`\n\nBilan sur ${min} min`);
  console.log(`  Disponibilité HTTP : ${pct(ok, ko)} % (${ko} échec(s) sur ${ok + ko})`);
  console.log(`  Connexion de jeu   : ${pct(wsUpSec, wsDownSec)} % (${wsDownSec} s coupée), ${reconnects} reconnexion(s)`);
  console.log(`  Pods vus           : ${[...pods.keys()].join(", ")}`);
  process.exit(0);
});
