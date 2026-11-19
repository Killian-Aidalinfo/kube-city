// Smoke test du jeu 3D : Chrome headless, parcours complet, une capture par étape, échec sur toute erreur console.
// Étapes : __quickStart → marcher → entrer dans une voiture (F) → rouler → police → carte (M) → changer de perso.
// Usage : node scripts/smoke.mjs [url]   (sans argument : lance le serveur local, nécessite Redis sur REDIS_URL)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
mkdirSync(out, { recursive: true });
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server = null;
let url = process.argv[2];
if (!url) {
  const port = 18080 + Math.floor(Math.random() * 500);
  server = spawn('node', ['src/server.js'], { cwd: root, env: { ...process.env, PORT: String(port), REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6380' }, stdio: 'ignore' });
  url = `http://localhost:${port}/`;
  for (let i = 0; i < 40; i++) { try { if ((await fetch(url + 'healthz')).ok) break; } catch { /* pas prêt */ } await sleep(250); }
}

const errors = [];
const report = {};
// GPU réel par défaut (Metal sur macOS : ~60 i/s) ; SMOKE_GL=swiftshader pour une machine sans GPU (le jeu tourne alors au ralenti)
const GL_ARGS = process.env.SMOKE_GL === 'swiftshader'
  ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  : ['--use-angle=' + (process.env.SMOKE_GL || (process.platform === 'darwin' ? 'metal' : 'default')), '--ignore-gpu-blocklist', '--enable-gpu'];
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: GL_ARGS });
let step = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console (étape ${step}) : ${m.text()}`);
    else if (m.type() === 'warning' && /shader|WebGL|GL_INVALID|vFogDepth/i.test(m.text())) errors.push(`avertissement GL (étape ${step}) : ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => errors.push(`exception (étape ${step}) : ${e.message}`));
  page.on('requestfailed', (r) => { if (!/favicon/.test(r.url())) errors.push('requête échouée : ' + r.url()); });
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`HTTP ${r.status()} : ${r.url()}`); });

  const shot = async (name) => { step++; await page.screenshot({ path: path.join(out, `smoke-${step}-${name}.png`) }); };
  const state = () => page.evaluate(() => { const g = window.__game; return { state: g.state, p: g.player?.state, x: g.player?.position.x, z: g.player?.position.z }; });
  // état détaillé joint au message d'échec de l'étape 1 (entrée reçue ou non, focus, pointer lock, joueur)
  const diag = () => page.evaluate(() => { const g = window.__game; return JSON.stringify({ jeu: g.state, joueur: g.player?.state, pos: [g.player?.position.x, g.player?.position.y, g.player?.position.z].map((v) => +v?.toFixed(2)), focus: document.hasFocus(), lock: !!document.pointerLockElement, touches: window.__keys, axeY: g.input.axis('moveY'), ecrans: [...document.querySelectorAll('.kc-screen,.kc-modal')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.className) }); });
  const must = (cond, msg) => { if (!cond) errors.push(`étape ${step} : ${msg}`); };

  await page.addInitScript(() => { window.__keys = []; addEventListener('keydown', (e) => window.__keys.push(e.code + '@' + Math.round(performance.now())), true); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__quickStart === 'function' && window.__game, null, { timeout: 60000 });
  await page.evaluate(() => window.__quickStart());
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 30000 });
  // compile tous les matériaux de la scène (eau, ciel…) quelle que soit la vue : toute erreur de shader remonte ici
  await page.evaluate(() => { const { renderer, scene, camera } = window.__game.three; renderer.compile(scene, camera); });
  await sleep(1500);
  await shot('depart');

  // 1. marcher
  const s0 = await state();
  await page.keyboard.down('KeyW'); await sleep(1800); await page.keyboard.down('KeyD'); await sleep(700);
  await page.keyboard.up('KeyW'); await page.keyboard.up('KeyD');
  await page.keyboard.press('Space'); await sleep(600);
  const s1 = await state();
  report.marche = Math.hypot(s1.x - s0.x, s1.z - s0.z).toFixed(1) + ' m';
  must(Math.hypot(s1.x - s0.x, s1.z - s0.z) > 1, 'le perso ne marche pas ' + (Math.hypot(s1.x - s0.x, s1.z - s0.z) > 1 ? '' : await diag()));
  await shot('marche');

  // 2. entrer dans la voiture la plus proche (F)
  await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    const cars = g.vehicles.list.filter((v) => !v.driver && !v.destroyed && v.owner !== 'remote' && v.owner !== 'police');
    cars.sort((a, b) => Math.hypot(a.object3d.position.x - p.x, a.object3d.position.z - p.z) - Math.hypot(b.object3d.position.x - p.x, b.object3d.position.z - p.z));
    const v = cars[0], o = v.object3d.position, yaw = v.object3d.rotation.y;
    // côté conducteur (gauche du véhicule, avant +Z)
    g.player.teleport({ x: o.x + Math.cos(yaw) * 2.0, z: o.z - Math.sin(yaw) * 2.0 });
  });
  await sleep(400);
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__game.player.state === 'inVehicle', null, { timeout: 8000 }).catch(() => must(false, 'pas entré dans la voiture'));
  await sleep(500);
  await shot('voiture');

  // 3. rouler
  const v0 = await state();
  await page.keyboard.down('KeyW'); await sleep(2500);
  report.vitesse = await page.evaluate(() => Math.round(window.__game.player.vehicle?.speed ?? 0) + ' km/h');
  await page.keyboard.up('KeyW'); await sleep(300);
  const v1 = await state();
  must(Math.hypot(v1.x - v0.x, v1.z - v0.z) > 3, 'la voiture n\'avance pas');
  await shot('roule');

  // 4. provoquer la police (vol signalé + agression)
  await page.evaluate(() => {
    const g = window.__game, p = g.player.position;
    for (let i = 0; i < 3; i++) g.bus.emit('crime', { kind: 'carjack', severity: 2, witnessed: true, position: { x: p.x, y: p.y, z: p.z } });
  });
  await sleep(2500);
  report.police = await page.evaluate(() => `niveau ${window.__game.police.level}, ${window.__game.police.units?.length ?? 0} unités`);
  must(await page.evaluate(() => window.__game.police.level >= 1), 'la police ne réagit pas');
  await shot('police');

  // 5. carte (M)
  await page.keyboard.press('KeyM'); await sleep(800);
  await shot('carte');
  await page.keyboard.press('KeyM'); await sleep(300);
  await page.evaluate(() => window.__game.police.clear?.());

  // 6. changer de perso
  const before = await page.evaluate(() => window.__game.gameplay.currentCharacter);
  const target = await page.evaluate((b) => { const ids = window.__game.gameplay.characters; return ids.find((c) => c !== b); }, before);
  await page.evaluate((t) => window.__game.gameplay.switchCharacter(t), target);
  await page.waitForFunction((t) => window.__game.gameplay.currentCharacter === t && window.__game.state === 'playing', target, { timeout: 15000 })
    .catch(() => must(false, 'changement de perso non terminé'));
  await sleep(800);
  report.perso = `${before} → ${await page.evaluate(() => window.__game.gameplay.currentCharacter)}`;
  await shot('perso');

  // 7. combat non létal : batte, coup, roue d'armes (ralenti 0,2 puis retour à 1)
  await page.keyboard.press('Digit2'); await sleep(200);
  await page.mouse.click(640, 360); await sleep(600);
  await page.keyboard.down('Tab'); await sleep(700);
  const slow = await page.evaluate(() => window.__game.time.scale);
  await shot('roue');
  await page.keyboard.up('Tab'); await sleep(800);
  const back = await page.evaluate(() => window.__game.time.scale);
  report.combat = `arme ${await page.evaluate(() => window.__game.combat.currentWeapon)}, ralenti ${slow.toFixed(2)} → ${back}`;
  must(slow < 0.5 && back === 1, `ralenti de la roue incorrect (${slow} → ${back})`);

  // 8. carjacking : voler une voiture conduite par un PNJ
  await page.evaluate(() => { window.__ejected = 0; window.__game.bus.on('vehicle:driverEjected', () => { window.__ejected++; }); });
  let jacked = false;
  for (let essai = 0; essai < 4 && !jacked; essai++) {
    const found = await page.evaluate(() => {
      const g = window.__game;
      if (g.player.state === 'inVehicle') g.vehicles.exit(g.player);
      // voiture debout (pas une épave, pas tombée sous le monde), la plus lente : une voiture lancée s'éloigne pendant l'essai
      const cars = g.vehicles.list.filter((v) => v.driver?.npc && !v.wrecked && !v.destroyed && v.owner !== 'police' && v.object3d.position.y > -5);
      cars.sort((a, b) => (a.speed ?? 0) - (b.speed ?? 0));
      const v = cars[0]; if (!v) return false;
      const o = v.object3d.position, yaw = v.object3d.rotation.y;
      g.player.state === 'onFoot' || (g.player.state = 'onFoot');
      g.player.teleport({ x: o.x + Math.cos(yaw) * 2.0, z: o.z - Math.sin(yaw) * 2.0 });
      window.__target = v; return true;
    });
    if (!found) break;
    await sleep(80);
    await page.keyboard.press('KeyF');
    jacked = await page.waitForFunction(() => window.__target.driver === window.__game.player, null, { timeout: 5000 }).then(() => true, () => false);
  }
  must(jacked, 'carjacking : le PNJ n\'a pas été éjecté / la voiture n\'a pas été volée');
  report.carjack = jacked ? `éjecté ×${await page.evaluate(() => window.__ejected)}` : 'échec';
  await shot('carjack');
  await page.evaluate(() => window.__game.police.clear?.());

  // 9. K.O. → réveil à l'hôpital
  const hop = await page.evaluate(() => {
    const g = window.__game;
    window.__respawn = null; g.bus.on('player:respawn', (e) => { window.__respawn = e; });
    g.player.knockOut('smoke'); return g.player.state;
  });
  must(hop === 'ko', 'le K.O. n\'a pas mis le joueur à terre (' + hop + ')');
  await page.waitForFunction(() => window.__respawn, null, { timeout: 10000 }).catch(() => must(false, 'pas de réveil après le K.O.'));
  await sleep(600);
  const wake = await page.evaluate(() => { const g = window.__game; return { where: window.__respawn?.where, state: g.player.state, hp: g.player.health }; });
  report.ko = `${wake.where}, état ${wake.state}, pv ${wake.hp}`;
  must(wake.where === 'hôpital' && wake.state !== 'ko' && wake.hp > 0, 'réveil à l\'hôpital incorrect : ' + JSON.stringify(wake));
  await shot('hopital');

  // mesures : draw calls (vue de rue), canvas non noir, cadence — de jour puis de nuit (phares, lampadaires)
  const measure = () => page.evaluate(async () => {
    const g = window.__game, { renderer, scene, camera } = g.three;
    const t0 = g.time.elapsed, f0 = renderer.info.render.frame;
    await new Promise((r) => setTimeout(r, 2000));
    const fps = (renderer.info.render.frame - f0) / 2;
    renderer.render(scene, camera);
    const calls = renderer.info.render.calls, tris = renderer.info.render.triangles;
    const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(4); const seen = new Set(); let lum = 0, n = 0;
    for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) {
      gl.readPixels(Math.floor(w * i / 10), Math.floor(h * j / 10), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      seen.add(px.join(',')); lum += (px[0] + px[1] + px[2]) / 3; n++;
    }
    return { colors: seen.size, lum: Math.round(lum / n), calls, tris, fps, elapsed: Math.round((g.time.elapsed - t0) * 10) / 10 };
  });
  const MAX = +(process.env.SMOKE_MAX_CALLS || 300);
  const check = (nom, st) => {
    if (st.calls > MAX) errors.push(`trop de draw calls (${nom}) : ${st.calls} > ${MAX}`);
    if (st.elapsed <= 0) errors.push('la boucle ne tourne pas');
  };
  const stats = await measure();
  report.rendu = stats;
  if (stats.lum < 8) errors.push('canvas noir (luminosité moyenne ' + stats.lum + ')');
  if (stats.colors < 2) errors.push('canvas uni (une seule couleur)');
  check('jour', stats);
  await page.evaluate(() => window.__game.world.setTime(23));
  await sleep(1500);
  const nuit = await measure();
  report.nuit = nuit;
  check('nuit', nuit);
  await shot('nuit');
} catch (e) {
  errors.push(`smoke (étape ${step}) : ${e.message}`);
} finally {
  await browser.close();
  server?.kill('SIGTERM');
}
console.log('mesures :', JSON.stringify(report));
if (errors.length) { console.error('ÉCHEC du smoke test :\n- ' + [...new Set(errors)].join('\n- ')); process.exit(1); }
console.log('smoke OK (captures dans scripts/out/)');
