// Mesure fps en rendu logiciel (SwiftShader) en qualité Basse. Usage : node scripts/perf-low.mjs [url] [low|medium]
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server = null, url = process.argv[2];
if (!url) {
  const port = 8307;
  server = spawn('node', ['src/server.js'], { cwd: root, env: { ...process.env, PORT: String(port), REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6380' }, stdio: 'ignore' });
  url = `http://localhost:${port}/`;
  for (let i = 0; i < 40; i++) { try { if ((await fetch(url + 'healthz')).ok) break; } catch {} await sleep(250); }
}
const q = process.argv[3] || 'low';
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const LOW = { shadows: false, shadowMapSize: 1024, viewDistance: 250, pedDensity: 0.3, maxPixelRatio: 0.75, lointain: 'light', ...JSON.parse(process.env.LOW || '{}') };
  await page.addInitScript(([q, low]) => localStorage.setItem('kubecity.settings.v1', JSON.stringify({ quality: q, ...(q === 'low' ? low : {}) })), [q, LOW]);
  await page.goto(url);
  await page.waitForFunction(() => typeof window.__quickStart === 'function' && window.__game, null, { timeout: 90000 });
  await page.evaluate(() => window.__quickStart());
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 60000 });
  await sleep(4000);
  const r = await page.evaluate(async () => {
    const g = window.__game, { renderer } = g.three, f0 = renderer.info.render.frame, t0 = performance.now();
    await new Promise((r) => setTimeout(r, 8000));
    return { fps: (renderer.info.render.frame - f0) / ((performance.now() - t0) / 1000), calls: renderer.info.render.calls, tris: renderer.info.render.triangles, settings: g.settings.all() };
  });
  console.log(JSON.stringify(r));
  console.log(JSON.stringify(await page.evaluate(() => { const { renderer, scene, camera } = window.__game.three; const gl = renderer.getContext(); const t = []; for (let i = 0; i < 6; i++) { const a = performance.now(); renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); t.push(Math.round(performance.now() - a)); } return t; })));
  if (process.env.EXP) console.log(JSON.stringify(await page.evaluate((exp) => { const { renderer, scene, camera } = window.__game.three; const gl = renderer.getContext();
    const tm = () => { const t = []; for (let i = 0; i < 5; i++) { const a = performance.now(); renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); t.push(performance.now() - a); } return Math.round(t.slice(2).reduce((x, y) => x + y) / 3); };
    const out = { base: tm() };
    const hide = (f) => { const l = []; scene.traverse((o) => { if (o.isMesh && f(o) && o.visible) { o.visible = false; l.push(o); } }); const v = tm(); l.forEach((o) => { o.visible = true; }); return v; };
    out.noSkinned = hide((o) => o.isSkinnedMesh); out.noTerrain = hide((o) => o.geometry.attributes.position.count === 50176);
    out.noBig = hide((o) => o.geometry.attributes.position.count > 20000 && o.geometry.attributes.position.count !== 50176);
    out.nothing = hide(() => true);
    const THREE_M = scene.children.find((c) => c.isMesh)?.material?.constructor; 
    renderer.setPixelRatio(0.25); renderer.setSize(1280, 720, false); out.px025 = tm(); renderer.setPixelRatio(0.75); renderer.setSize(1280, 720, false);
    renderer.toneMapping = 0; out.noTone = tm(); renderer.toneMapping = 4;
    scene.fog = null; out.noFog = tm();
    const sh = scene.children.filter((c) => c.isLight).length; out.lights = sh; return out; }, 1)));
  if (process.env.TOP) console.log(JSON.stringify(await page.evaluate(() => {
    const { scene, camera } = window.__game.three, out = [];
    camera.updateMatrixWorld();
    scene.traverse((o) => { if (!o.isMesh || !o.visible) return; let p = o, vis = true; while (p) { if (!p.visible) vis = false; p = p.parent; } if (!vis) return;
      const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); out.push([Math.round(n), o.name || o.type + ':' + (o.parent?.name || ''), g.attributes.position.count]); });
    out.sort((a, b) => b[0] - a[0]); return out.slice(0, 12);
  })));
} finally { await browser.close(); server?.kill('SIGTERM'); }
