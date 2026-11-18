// Playtest multijoueur VU PAR LES JOUEURS, pendant les pannes. Nécessite `docker compose up -d` (nginx :8080, game-1..3, redis).
// A conduit (ligne droite puis virage), B regarde : saccades, véhicule visible/orienté, perso/tenue ; puis panne du pod de A, puis de Redis.
// Usage : node scripts/playtest/multi.mjs [url]   (SKIP_REDIS=1 : ne pas tuer Redis ; HARD=1 : SIGKILL du pod)   Sortie : JSON + code 1 si un critère échoue.
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const URL_ = process.argv[2] || 'http://localhost:8080/';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dc = (args) => execSync(`docker compose ${args}`, { cwd: root, stdio: 'pipe' }).toString();
const GL = ['--use-angle=' + (process.platform === 'darwin' ? 'metal' : 'default'), '--ignore-gpu-blocklist', '--enable-gpu', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
const fails = [], R = {};
const check = (ok, msg) => { if (!ok) fails.push(msg); };

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: GL });
async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`${name} exception : ${e.message}`));
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__quickStart === 'function' && window.__game, null, { timeout: 60000 });
  return page;
}
try {
  const A = await player('A'), B = await player('B');
  await A.evaluate(() => window.__quickStart(window.__game.gameplay.characters.at(-1))); // A : un perso qui n'est pas celui par défaut
  await B.evaluate(() => window.__quickStart());
  for (const p of [A, B]) await p.waitForFunction(() => window.__game.state === 'playing' && window.__game.net.connected, null, { timeout: 30000 });
  await sleep(1500);
  const aInfo = await A.evaluate(() => { const g = window.__game; return { id: g.net.id, pod: g.net.status.pod, ch: g.gameplay.currentCharacter }; });
  R.A = aInfo;

  // A monte dans la voiture la plus proche ; B se place à ~12 m de A
  await A.evaluate(() => {
    const g = window.__game, p = g.player.position;
    const cars = g.vehicles.list.filter((v) => !v.driver && !v.destroyed && v.owner !== 'remote' && v.owner !== 'police');
    cars.sort((a, b) => Math.hypot(a.object3d.position.x - p.x, a.object3d.position.z - p.z) - Math.hypot(b.object3d.position.x - p.x, b.object3d.position.z - p.z));
    const v = cars[0], o = v.object3d.position, yaw = v.object3d.rotation.y;
    g.player.teleport({ x: o.x + Math.cos(yaw) * 2.0, z: o.z - Math.sin(yaw) * 2.0 });
  });
  await sleep(500); await A.keyboard.press('KeyF');
  await A.waitForFunction(() => window.__game.player.state === 'inVehicle', null, { timeout: 8000 }).catch(() => check(false, 'A n\'entre pas dans la voiture'));
  const a0 = await A.evaluate(() => { const p = window.__game.player.position; return { x: p.x, z: p.z }; });
  await B.evaluate((a) => window.__game.player.teleport({ x: a.x + 12, z: a.z + 12 }), a0);
  await sleep(1500);

  // enregistreur côté B : à chaque image, position/orientation du véhicule distant de A et position de A dans net.players
  await B.evaluate((aid) => {
    const g = window.__game; window.__rec = { fr: [], gaps: [] };
    let last = performance.now();
    const tick = () => {
      const now = performance.now(); window.__rec.gaps.push(now - last); last = now;
      const e = g.net.players.get(aid);
      const v = g.vehicles.list.find((x) => x.owner === 'remote' && x.object3d);
      const q = v?.object3d.quaternion;
      window.__rec.fr.push({ t: now, e: e ? [e.position?.x, e.position?.z] : null, n: g.net.players.size,
        v: v ? [v.object3d.position.x, v.object3d.position.z, q.x, q.y, q.z, q.w, v.object3d.visible ? 1 : 0, v.object3d.parent ? 1 : 0] : null });
      window.__recRaf = requestAnimationFrame(tick);
    };
    tick();
  }, aInfo.id);

  // A : ligne droite 5 s puis virage 4 s ; on échantillonne aussi la vérité côté A
  await A.evaluate(() => { window.__truth = []; window.__tt = setInterval(() => { const v = window.__game.player.vehicle; if (!v) return; const o = v.object3d, q = o.quaternion; window.__truth.push([performance.now(), o.position.x, o.position.z, q.x, q.y, q.z, q.w]); }, 50); });
  await A.keyboard.down('KeyW'); await sleep(5000);
  const tStraight = Date.now();
  await A.keyboard.down('KeyD'); await sleep(4000);
  await A.keyboard.up('KeyD'); await A.keyboard.up('KeyW');
  await sleep(1500);
  const rec = await B.evaluate(() => window.__rec), truth = await A.evaluate(() => window.__truth);
  const jumps = (key, pos) => { let n = 0, max = 0, p0 = null; for (const f of rec.fr) { const p = pos(f); if (!p) { p0 = null; continue; } if (p0) { const d = Math.hypot(p[0] - p0[0], p[1] - p0[1]); max = Math.max(max, d); if (d > 3) n++; } p0 = p; } return { teleports: n, maxStepM: +max.toFixed(2) }; };
  const vehFr = rec.fr.filter((f) => f.v);
  const heading = (arr) => { // écart entre l'axe +Z du véhicule et sa direction de déplacement (mouvement > 0,15 m)
    const out = [];
    for (let i = 5; i < arr.length; i += 5) {
      const [x0, z0] = arr[i - 5], [x1, z1, qx, qy, qz, qw] = arr[i];
      if (Math.hypot(x1 - x0, z1 - z0) < 0.15) continue;
      const fx = 2 * (qx * qz + qw * qy), fz = 1 - 2 * (qx * qx + qy * qy);
      let d = Math.atan2(fx, fz) - Math.atan2(x1 - x0, z1 - z0); d = Math.atan2(Math.sin(d), Math.cos(d));
      out.push(Math.abs(d) * 180 / Math.PI);
    }
    return out.length ? +(out.sort((a, b) => a - b)[Math.floor(out.length / 2)]).toFixed(1) : null;
  };
  const gaps = rec.gaps.slice(1).sort((a, b) => a - b);
  R.view = {
    frames: rec.fr.length, fpsB: +(1000 / (gaps[Math.floor(gaps.length / 2)] || 16)).toFixed(0), worstFrameMs: Math.round(gaps.at(-1)),
    vehicleVisibleFrames: `${vehFr.filter((f) => f.v[6] && f.v[7]).length}/${rec.fr.length}`,
    vehicleJumps: jumps('v', (f) => f.v), avatarJumps: jumps('e', (f) => f.e),
    headingErrDegB: heading(vehFr.map((f) => f.v)), headingErrDegA: heading(truth.map((r) => [r[1], r[2], r[3], r[4], r[5], r[6]])),
  };
  check(vehFr.length > rec.fr.length * 0.9, `véhicule de A visible chez B seulement ${R.view.vehicleVisibleFrames}`);
  check(R.view.vehicleJumps.teleports === 0, `saccades véhicule : ${R.view.vehicleJumps.teleports} sauts > 3 m`);
  check(R.view.headingErrDegB != null && Math.abs(R.view.headingErrDegB - R.view.headingErrDegA) < 15, `orientation du véhicule chez B : ${R.view.headingErrDegB}° vs ${R.view.headingErrDegA}° chez A`);
  const look = await B.evaluate((aid) => { const g = window.__game, e = g.net.players.get(aid); return { ch: e?.character, outfit: e?.outfit, exp: g.gameplay }; }, aInfo.id).catch(() => null);
  const aLook = await A.evaluate(() => { const g = window.__game; return { ch: g.gameplay.currentCharacter, outfit: g.gameplay.getOutfit() }; });
  R.look = { A: aLook.ch, seenByB: look?.ch, outfitOk: ['skin', 'hair', 'top', 'bottom', 'shoes'].every((k) => (look?.outfit?.[k] || '').toLowerCase() === (aLook.outfit[k] || '').toLowerCase()), seen: look?.outfit, real: aLook.outfit };
  check(look?.ch === aLook.ch, `perso de A vu comme « ${look?.ch} » au lieu de « ${aLook.ch} »`);
  check(R.look.outfitOk, 'tenue de A différente chez B');

  // ---------- panne du pod de A ----------
  await A.evaluate(() => { const g = window.__game; g.gameplay.addMoney(1234, 'playtest'); g.gameplay.profile.missions.playtest_done = { done: true }; });
  const before = await A.evaluate(() => { const g = window.__game, p = g.player.position; return { money: g.gameplay.money, x: p.x, z: p.z, veh: g.player.vehicle?.id, state: g.player.state }; });
  const podOf = (n) => n; const svc = aInfo.pod;
  await B.evaluate(() => { window.__ghost = { max: 0, absent: 0, t0: performance.now(), log: [] }; });
  await B.evaluate((aid) => { const g = window.__game; const name = g.net.players.get(aid)?.name; window.__chk = setInterval(() => { const same = [...g.net.players.values()].filter((e) => e.name === name).length; window.__ghost.max = Math.max(window.__ghost.max, same); if (!g.net.players.has(aid)) window.__ghost.absent += 100; }, 100); }, aInfo.id);
  await A.evaluate(() => { window.__st = []; window.__game.bus.on('net:status', (s) => window.__st.push([Math.round(performance.now()), s.connected, s.pod])); });
  const tKill = Date.now();
  dc(process.env.HARD ? `kill ${svc}` : `stop -t 20 ${svc}`); // HARD=1 : SIGKILL (pas d'arrêt propre)
  await A.waitForFunction((pod) => window.__game.net.connected && window.__game.net.status.pod !== pod, svc, { timeout: 30000 }).catch(() => check(false, 'A ne se reconnecte pas'));
  const tBack = Date.now();
  await sleep(4000);
  const after = await A.evaluate(() => { const g = window.__game, p = g.player.position; return { money: g.gameplay.money, x: p.x, z: p.z, veh: g.player.vehicle?.id, state: g.player.state, pod: g.net.status.pod, mission: !!g.gameplay.profile.missions.playtest_done }; });
  const ghost = await B.evaluate(() => { clearInterval(window.__chk); return window.__ghost; });
  const vehB = await B.evaluate(() => window.__game.vehicles.list.filter((x) => x.owner === 'remote').length);
  const srv = await A.evaluate(async () => { const p = await window.__game.net.loadProfile(); return { money: p?.chars?.[p.current]?.money, mission: !!p?.missions?.playtest_done }; });
  R.podKill = { podStopped: svc, reconnectMs: tBack - tKill, before, after, serverProfile: srv, bSeesAbsentMs: ghost.absent, bMaxDuplicates: ghost.max, bRemoteVehicles: vehB };
  check(after.money === before.money, `argent perdu après la panne : ${before.money} -> ${after.money}`);
  check(after.mission, 'mission perdue après la panne');
  check(after.veh === before.veh && after.state === 'inVehicle', 'A a perdu sa voiture');
  check(Math.hypot(after.x - before.x, after.z - before.z) < 8, 'A a changé de position');
  check(srv.money === before.money && srv.mission, `profil non retrouvé côté serveur après la panne : ${JSON.stringify(srv)}`);
  check(ghost.max <= 1, `doublon fantôme de A chez B (${ghost.max})`);
  check(vehB === 1, `${vehB} véhicules distants chez B (attendu 1)`);
  R.podKill.indicatorSeen = null;
  dc(`start ${svc}`);

  // ---------- panne de Redis ----------
  if (!process.env.SKIP_REDIS) {
    await sleep(3000);
    const m0 = await A.evaluate(() => window.__game.gameplay.money);
    dc('stop -t 5 redis');
    await sleep(6000);
    await A.keyboard.down('KeyW'); await sleep(1500); await A.keyboard.up('KeyW');
    await A.evaluate(() => window.__game.gameplay.addMoney(77, 'playtest-redis'));
    const during = await B.evaluate((aid) => ({ connected: window.__game.net.connected, sync: window.__game.net.status.sync, seesA: window.__game.net.players.has(aid) }), aInfo.id);
    const aDuring = await A.evaluate(() => ({ connected: window.__game.net.connected, sync: window.__game.net.status.sync, state: window.__game.state }));
    dc('start redis'); await sleep(8000);
    await A.evaluate(() => window.__game.gameplay.save());
    const srv2 = await A.evaluate(async () => { const p = await window.__game.net.loadProfile(); return p?.chars?.[p.current]?.money; });
    const mAfter = await A.evaluate(() => window.__game.gameplay.money);
    R.redisKill = { moneyBefore: m0, moneyAfter: mAfter, serverMoneyAfterRestart: srv2, A: aDuring, Bduring: during };
    check(aDuring.connected && during.connected, 'des joueurs coupés pendant la panne Redis');
    check(mAfter === m0 + 77, 'argent incohérent après Redis');
    check(srv2 === mAfter, `profil non resynchronisé après Redis : serveur ${srv2} vs local ${mAfter}`);
  }
  // ---------- coupure totale de 4 s : l'indication « Reconnexion au cluster… » doit apparaître puis disparaître ----------
  dc('kill game-1 game-2 game-3'); await sleep(3500);
  const shown = await A.evaluate(() => { const e = [...document.querySelectorAll('[role=status]')].find((x) => /Reconnexion au cluster/.test(x.textContent)); return !!e && getComputedStyle(e).opacity !== '0'; });
  dc('start game-1 game-2 game-3');
  await A.waitForFunction(() => window.__game.net.connected, null, { timeout: 30000 }).catch(() => check(false, 'A ne revient pas après coupure totale'));
  await sleep(1200);
  const hidden = await A.evaluate(() => [...document.querySelectorAll('[role=status]')].every((x) => !/Reconnexion au cluster/.test(x.textContent) || getComputedStyle(x).opacity === '0'));
  R.totalOutage = { indicatorShown: shown, indicatorHiddenAfter: hidden };
  check(shown && hidden, 'indication « Reconnexion au cluster… » absente ou persistante');
} catch (e) { fails.push('script : ' + e.stack); }
finally { try { dc('start redis game-1 game-2 game-3'); } catch {} await browser.close(); }
console.log(JSON.stringify(R, null, 1));
console.log(fails.length ? 'ÉCHECS :\n- ' + fails.join('\n- ') : 'OK');
process.exit(fails.length ? 1 : 0);
