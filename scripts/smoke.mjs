// Smoke test : ouvre le jeu dans Chrome headless, simule quelques touches, capture, échoue sur erreur console ou canvas noir.
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
let failed = false;
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('exception: ' + e.message));
  page.on('requestfailed', (r) => errors.push('requête échouée: ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.state === 'playing', null, { timeout: 30000 });
  await page.screenshot({ path: path.join(out, 'smoke-1-start.png') });

  // marche ~3 s (Z puis D), saut, ouverture de la carte (M) ; les modules réels réagiront à ces actions
  await page.keyboard.down('KeyW'); await sleep(1500); await page.keyboard.down('KeyD'); await sleep(1500);
  await page.keyboard.up('KeyW'); await page.keyboard.up('KeyD');
  await page.keyboard.press('Space'); await page.keyboard.press('KeyF'); await sleep(500);
  await page.keyboard.press('KeyM'); await sleep(500);
  await page.screenshot({ path: path.join(out, 'smoke-2-end.png') });

  // canvas noir ? on rend puis on lit les pixels dans la même tâche (le buffer est valide à cet instant)
  const stats = await page.evaluate(() => {
    const g = window.__game, { renderer, scene, camera } = g.three;
    renderer.render(scene, camera);
    const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(4); const seen = new Set(); let lum = 0, n = 0;
    for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) {
      gl.readPixels(Math.floor(w * i / 10), Math.floor(h * j / 10), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      seen.add(px.join(',')); lum += (px[0] + px[1] + px[2]) / 3; n++;
    }
    return { colors: seen.size, lum: lum / n, frames: Math.round(g.time.elapsed * 10) / 10 };
  });
  console.log('canvas :', JSON.stringify(stats));
  if (stats.lum < 8) { errors.push('canvas noir (luminosité moyenne ' + stats.lum.toFixed(1) + ')'); }
  if (stats.colors < 2) { errors.push('canvas uni (une seule couleur)'); }
  if (stats.frames < 1) { errors.push('la boucle ne tourne pas'); }
} catch (e) {
  errors.push('smoke : ' + e.message);
} finally {
  await browser.close();
  server?.kill('SIGTERM');
}
if (errors.length) { console.error('ÉCHEC du smoke test :\n- ' + [...new Set(errors)].join('\n- ')); failed = true; }
else console.log('smoke OK (captures dans scripts/out/)');
process.exit(failed ? 1 : 0);
