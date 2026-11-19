// Mesure de mixage : lance le jeu, déclenche chaque source sonore et relève crête / RMS en sortie (AnalyserNode après compresseur).
// Échoue sur saturation (crête > 0,98) ou silence d'une source censée être audible. Usage : node scripts/playtest/audio.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = process.env.PLAYTEST_PORT || 8309;
const server = spawn('node', ['src/server.js'], { cwd: root, env: { ...process.env, PORT: String(port), REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6380' }, stdio: 'ignore' });
const url = `http://localhost:${port}/`;
for (let i = 0; i < 40; i++) { try { if ((await fetch(url + 'healthz')).ok) break; } catch { /* pas prêt */ } await sleep(250); }
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=' + (process.platform === 'darwin' ? 'metal' : 'default'), '--ignore-gpu-blocklist'] });
const rows = [], errors = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 600 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__quickStart === 'function' && window.__game, null, { timeout: 60000 });
  await page.evaluate(() => window.__quickStart('ines'));
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 30000 });
  await page.evaluate(() => { const g = window.__game; g.audio.unlock(); g.audio.setRadio(-1); g.world.weather.auto = false; g.time.dayTime = 12; });
  await sleep(1500);
  // fenêtre de mesure : crête max et RMS moyen pendant `ms`
  const measure = (name, ms, { min = 0.0005, max = 0.98 } = {}) => page.evaluate(async ({ name, ms }) => {
    const a = window.__game.audio; let pk = 0, sum = 0, n = 0; const t0 = performance.now();
    while (performance.now() - t0 < ms) { const l = a.level(); pk = Math.max(pk, l.peak); sum += l.rms; n++; await new Promise((r) => setTimeout(r, 40)); }
    return { name, peak: pk, rms: sum / n, state: a.ctx.state };
  }, { name, ms }).then((r) => { r.min = min; r.max = max; rows.push(r); return r; });
  const setup = (fn, arg) => page.evaluate(fn, arg);
  await measure('silence (jour, à pied, radio coupée)', 1200, { min: 0 });
  await setup(() => { window.__game.time.dayTime = 2; }); await sleep(5000);
  await measure('ambiance nuit (grillons + trafic)', 1500);
  await setup(() => { window.__game.time.dayTime = 12; window.__game.world.weather.set('pluie'); }); await sleep(7000);
  await measure('pluie', 1500);
  await setup(() => { window.__game.world.weather.set('clair'); });
  // véhicules : monte dedans, plein gaz
  for (const type of ['sport', 'bus', 'moto', 'van']) {
    await setup((type) => {
      const g = window.__game, p = g.player;
      if (p.vehicle) { g.vehicles.exit(p); }
    }, type);
    await sleep(800);
    await setup((type) => {
      const g = window.__game, p = g.player.position;
      const v = g.vehicles.spawn(type, { x: p.x + 6, y: p.y + 1, z: p.z }, 0, { owner: 'player' });
      window.__v = v;
    }, type);
    await sleep(1200);
    await setup(() => { const v = window.__v, o = v.object3d.position, yaw = v.object3d.rotation.y; window.__game.player.teleport({ x: o.x + Math.cos(yaw) * 2.2, z: o.z - Math.sin(yaw) * 2.2 }); });
    await sleep(400);
    await page.keyboard.press('KeyF');
    await page.waitForFunction(() => window.__game.player.state === 'inVehicle', null, { timeout: 8000 }).catch(() => errors.push(`pas entré dans ${type}`));
    await page.evaluate(() => window.__game.audio.setRadio(-1)); // la radio démarre à l'entrée : on la mesure à part
    await sleep(500);
    await page.keyboard.down('KeyW'); await sleep(3500);
    const sp = await page.evaluate(() => Math.round(window.__game.player.vehicle?.speed ?? -1));
    const r = await measure(`moteur ${type} plein gaz (${sp} km/h)`, 1200);
    if (type === 'sport') {
      await page.keyboard.down('Space'); await page.keyboard.down('KeyA');
      await measure('dérapage (frein à main + braquage)', 1200);
      await page.keyboard.up('Space'); await page.keyboard.up('KeyA');
      await setup(() => { window.__game.player.vehicle.siren = true; }); await sleep(600);
      await measure('moteur + sirène + pneus', 1200);
      await setup(() => { window.__game.player.vehicle.siren = false; });
    }
    if (type === 'sport') { await page.evaluate(() => window.__game.audio.setRadio(0)); await measure('moteur + radio (station 0)', 1500); await page.evaluate(() => window.__game.audio.setRadio(-1)); }
    await page.keyboard.up('KeyW');
  }
  await setup(() => { const g = window.__game; g.audio.play('crash', { intensity: 1 }); });
  await measure('collision forte (intensité 1)', 700);
  await setup(() => { window.__game.audio.play('jingle', { kind: 'success' }); });
  await measure('jingle de mission réussie', 1400);
  await setup(() => { const g = window.__game; g.audio.play('crash', { intensity: 1 }); g.audio.play('jingle', { kind: 'success' }); g.world.weather.set('pluie'); });
  await measure('pire cas : choc + jingle + moteur + pluie', 700);
} catch (e) { errors.push(String(e.stack || e)); } finally { await browser.close(); server.kill(); }
for (const r of rows) {
  const ok = r.peak <= r.max && (r.min === 0 || r.peak >= r.min);
  if (!ok) errors.push(`${r.name} : crête ${r.peak.toFixed(3)} hors de [${r.min}, ${r.max}]`);
  console.log(`${ok ? 'OK ' : 'KO '} ${r.name.padEnd(48)} crête ${r.peak.toFixed(3)} · rms ${r.rms.toFixed(4)} (${(20 * Math.log10(r.rms || 1e-6)).toFixed(0)} dBFS)`);
}
if (errors.length) { console.error('\nERREURS :\n- ' + errors.join('\n- ')); process.exit(1); }
console.log('\nMesure audio OK');
