// Playtest multijoueur VU PAR LES JOUEURS, pendant les pannes. Nécessite `docker compose up -d` (nginx :8080, game-1..3, redis).
// A conduit (ligne droite puis virage), B regarde : saccades, véhicule visible/orienté, perso/tenue ; puis panne du pod de A, puis de Redis.
// SENTINEL=1 : scénario HA complet (maître Redis, pod tué, pod redémarré, nouveau maître) + 20 joueurs simulés, mesures côté navigateur.
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


// ---------- SENTINEL=1 : objectif du cours (bascule détectée en 1-2 s, coupure <= 5 s) avec le vrai client + 20 joueurs simulés ----------
// Enchaîne : kill du maître Redis, kill d'un pod de jeu, restart d'un pod (mise à jour simulée), kill du nouveau maître.
// Nécessite COMPOSE_FILE=docker-compose.yml:deploy/sentinel/docker-compose.sentinel.yml et la pile démarrée.
const OBJ = { syncPauseMs: 5000, disconnectMs: 5000, visibilityMs: 5000 };
async function sentinel(A, B, aInfo) {
  const { spawn } = await import('node:child_process');
  const sh = (c) => { try { return dc(c).trim(); } catch (e) { return ''; } };
  const masterNow = () => sh('exec -T sentinel-1 redis-cli -p 26379 sentinel get-master-addr-by-name mymaster').split('\n')[0];
  const bIdent = await B.evaluate(() => ({ id: window.__game.net.id, pod: window.__game.net.status.pod }));
  const ids = { A: aInfo.id, B: bIdent.id };
  R.start = { podA: aInfo.pod, podB: bIdent.pod, master: masterNow() };
  // joueurs simulés (20) pendant tout le scénario ; SIGTERM = bilan anticipé
  const charge = spawn('node', [path.join(root, 'scripts/charge.mjs'), '--players', '20', '--agents', '0', '--duration', '900'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let chargeOut = ''; charge.stdout.on('data', (d) => { chargeOut += d; });
  // enregistreurs navigateur : transitions de connexion/synchro, et visibilité de l'autre joueur (window.__oid)
  const attach = (P, oid) => P.evaluate((oid) => {
    const g = window.__game; window.__ev = []; window.__vis = []; window.__oid = oid;
    const push = (s) => window.__ev.push({ t: Date.now(), c: s.connected, s: s.sync, pod: s.pod, r: s.reconnects });
    push(g.net.status); g.bus.on('net:status', push);
    let last = null;
    setInterval(() => { const v = g.net.players.has(window.__oid); if (v !== last) { last = v; window.__vis.push({ t: Date.now(), v }); } }, 50);
  }, oid);
  await attach(A, ids.B); await attach(B, ids.A);
  // A et B doivent être sur des pods DIFFÉRENTS (sinon la diffusion passe sans Redis) : on remplace B tant que ce n'est pas le cas
  async function apart() {
    for (let i = 0; i < 8; i++) {
      const [pa, pb] = await Promise.all([A, B].map((P) => P.evaluate(() => window.__game.net.status.pod)));
      if (pa !== pb) return true;
      await B.keyboard.up('KeyW').catch(() => {});
      await B.context().close();
      B = await player('B'); await B.evaluate(() => window.__quickStart());
      await B.waitForFunction(() => window.__game.state === 'playing' && window.__game.net.connected, null, { timeout: 30000 });
      ids.B = await B.evaluate(() => window.__game.net.id);
      await attach(B, ids.A); await A.evaluate((o) => { window.__oid = o; }, ids.B);
      await B.keyboard.down('KeyW'); await sleep(2500);
    }
    return false;
  }
  for (const P of [A, B]) await P.keyboard.down('KeyW'); // les deux marchent : leurs états partent en continu
  await sleep(3000);
  const intervals = (evs, key, t0, t1, bad) => { // durées (ms) des périodes « mauvaises » dans [t0, t1]
    const out = []; let st = null;
    const upto = evs.filter((e) => e.t <= t1);
    let cur = upto.filter((e) => e.t < t0).at(-1); if (cur && bad(cur[key])) st = t0;
    for (const e of upto.filter((e) => e.t >= t0)) {
      if (bad(e[key]) && st === null) st = e.t;
      else if (!bad(e[key]) && st !== null) { out.push(e.t - st); st = null; }
    }
    if (st !== null) out.push(t1 - st);
    return out;
  };
  const states = async () => Promise.all([A, B].map((P) => P.evaluate(() => ({ c: window.__game.net.connected, s: window.__game.net.status.sync, pod: window.__game.net.status.pod, m: window.__game.gameplay.money })))); 
  const settled = async (timeout = 45000) => {
    const t = Date.now();
    while (Date.now() - t < timeout) {
      const st = await states(); const vis = await Promise.all([A, B].map((P) => P.evaluate(() => window.__vis.at(-1)?.v)));
      if (st.every((x) => x.c && x.s) && vis.every(Boolean)) return true;
      await sleep(300);
    }
    return false;
  };
  const waitMaster = async (old, timeout = 20000) => { const t = Date.now(); while (Date.now() - t < timeout) { const m = masterNow(); if (m && m !== old) return Date.now(); await sleep(150); } return null; };
  let step = 0;
  const rows = [];
  async function phase(name, action) {
    step++;
    if (!(await settled())) check(false, `${name} : cluster pas stable avant le scénario`);
    const apartOk = await apart(); if (!apartOk) check(false, `${name} : A et B sur le même pod`);
    await settled();
    // progression à protéger : argent + mission, sauvegardés
    const prog = {};
    for (const [k, P] of [['A', A], ['B', B]]) {
      await P.evaluate((n) => { const g = window.__game; g.gameplay.addMoney(100, 'ha'); g.gameplay.profile.missions['ha_' + n] = { done: true }; g.gameplay.save(); }, step);
      prog[k] = await P.evaluate(() => window.__game.gameplay.money);
    }
    await sleep(1500);
    const t0 = Date.now();
    const info = await action(t0);
    // pendant la coupure, le joueur continue de jouer : gain d'argent local à rejouer vers le serveur
    for (const P of [A, B]) await P.evaluate(() => window.__game.gameplay.addMoney(5, 'ha-pendant'));
    for (const k of Object.keys(prog)) prog[k] += 5;
    const ok = await settled();
    const t1 = Date.now();
    await sleep(3000);
    const res = { phase: name, settled: ok, pods: await podsNow(), ...info };
    const perPlayer = {};
    for (const [k, P] of [['A', A], ['B', B]]) {
      const ev = await P.evaluate(() => window.__ev), vis = await P.evaluate(() => window.__vis);
      const cut = intervals(ev, 'c', t0, t1, (v) => !v), pause = intervals(ev, 's', t0, t1, (v) => !v), hid = intervals(vis, 'v', t0, t1, (v) => !v);
      const r0 = ev.filter((e) => e.t < t0).at(-1)?.r ?? 0, r1 = ev.at(-1)?.r ?? 0;
      await P.evaluate(() => window.__game.gameplay.save());
      await sleep(1500);
      const srv = await P.evaluate(async () => { const p = await window.__game.net.loadProfile(); return p?.chars?.[p.current]?.money; });
      const loc = await P.evaluate(() => window.__game.gameplay.money);
      perPlayer[k] = { syncPauseMs: Math.max(0, ...pause), disconnectMs: Math.max(0, ...cut), otherInvisibleMs: Math.max(0, ...hid), reconnects: r1 - r0, moneyLocal: loc, moneyServer: srv, moneyExpected: prog[k] };
      check(loc === prog[k], `${name} : argent local ${prog[k]} -> ${loc} (${k})`);
      check(srv === loc, `${name} : profil serveur ${srv} != local ${loc} (${k})`);
    }
    res.players = perPlayer;
    const worst = (f) => Math.max(...Object.values(perPlayer).map(f));
    res.max = { syncPauseMs: worst((x) => x.syncPauseMs), disconnectMs: worst((x) => x.disconnectMs), otherInvisibleMs: worst((x) => x.otherInvisibleMs) };
    check(res.max.syncPauseMs <= OBJ.syncPauseMs, `${name} : synchro en pause ${res.max.syncPauseMs} ms > ${OBJ.syncPauseMs}`);
    check(res.max.disconnectMs <= OBJ.disconnectMs, `${name} : coupure ${res.max.disconnectMs} ms > ${OBJ.disconnectMs}`);
    check(res.max.otherInvisibleMs <= OBJ.visibilityMs, `${name} : l'autre joueur invisible ${res.max.otherInvisibleMs} ms > ${OBJ.visibilityMs}`);
    check(ok, `${name} : cluster non rétabli`);
    rows.push(res);
    return res;
  }
  const podsNow = async () => (await states()).map((x) => x.pod);
  let killedMaster;
  await phase('1. kill du maître Redis', async () => {
    killedMaster = masterNow(); R.start.master = killedMaster;
    const tk = Date.now(); dc(`kill ${killedMaster}`);
    const tm = await waitMaster(killedMaster);
    return { killed: killedMaster, newMasterAfterMs: tm ? tm - tk : null };
  });
  dc(`start ${killedMaster}`); await sleep(6000); // redevient réplica
  await phase('2. kill d\'un pod de jeu', async () => {
    const pod = (await podsNow())[0]; dc(`kill ${pod}`);
    return { killed: pod };
  });
  const dead = rows.at(-1).killed; dc(`start ${dead}`); await sleep(5000);
  await phase('3. restart d\'un pod (mise à jour)', async () => {
    const pod = (await podsNow())[1]; dc(`restart -t 20 ${pod}`);
    return { restarted: pod };
  });
  await sleep(3000);
  let m2;
  await phase('4. kill du nouveau maître', async () => {
    m2 = masterNow(); const tk = Date.now(); dc(`kill ${m2}`);
    const tm = await waitMaster(m2);
    return { killed: m2, newMasterAfterMs: tm ? tm - tk : null };
  });
  dc(`start ${m2}`);
  for (const P of [A, B]) await P.keyboard.up('KeyW');
  charge.kill('SIGTERM');
  await new Promise((r) => { charge.on('exit', r); setTimeout(r, 15000); });
  const bil = Object.fromEntries((chargeOut.split('BILAN')[1] || '').split('\n').map((l) => l.trim().match(/^(\w+): (.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  R.charge = { connectesALaFin: bil.connectesALaFin, deconnexions: bil.deconnexions, reconnexionsMs: bil.reconnexionsMs };
  check(+bil.connectesALaFin >= 20, `joueurs simulés connectés à la fin : ${bil.connectesALaFin}/20`);
  R.phases = rows;
  const f = (n) => (n == null ? '-' : (n / 1000).toFixed(1) + ' s');
  R.table = '| Épreuve | Bascule Redis | Synchro en pause | Coupure joueur | Autre joueur invisible | Reconnexions | Progression |\n|---|---|---|---|---|---|---|\n' + rows.map((r) => `| ${r.phase} | ${f(r.newMasterAfterMs)} | ${f(r.max.syncPauseMs)} | ${f(r.max.disconnectMs)} | ${f(r.max.otherInvisibleMs)} | ${Object.values(r.players).map((x) => x.reconnects).join(' / ')} | ${Object.values(r.players).every((x) => x.moneyLocal === x.moneyExpected && x.moneyServer === x.moneyLocal) ? 'intacte' : 'PERDUE'} |`).join('\n');
}

async function standard(A, B, aInfo) {
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
}

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

  if (process.env.SENTINEL) await sentinel(A, B, aInfo); else await standard(A, B, aInfo);
} catch (e) { fails.push('script : ' + e.stack); }
finally { try { dc('start redis game-1 game-2 game-3'); } catch {} await browser.close(); }
console.log(JSON.stringify(R, null, 1));
if (R.table) console.log('\n' + R.table + '\n');
console.log(fails.length ? 'ÉCHECS :\n- ' + fails.join('\n- ') : 'OK');
process.exit(fails.length ? 1 : 0);
