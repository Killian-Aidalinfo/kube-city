#!/usr/bin/env node
// Endurance client : Chrome headless joue N minutes (marche, voiture, panneaux, changement de perso, pannes de pod)
// et relève chaque minute le heap JS (après GC forcé, via CDP), les géométries/textures three.js et le nombre d'objets.
//   LB_PORT=8314 COMPOSE_PROJECT_NAME=kc-soak node scripts/soak-client.mjs --minutes 15 [--url http://localhost:8314/]
import { chromium } from 'playwright-core';
import { execFile } from 'node:child_process';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1]; };
const MIN = +arg("minutes", 15), URL_ = arg("url", `http://localhost:${process.env.LB_PORT || 8080}/`);
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dc = (...a) => execFile('docker', ['compose', ...a], { timeout: 30000 }, () => {});
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--js-flags=--expose-gc'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
await page.goto(URL_, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.__quickStart === 'function' && window.__game, null, { timeout: 60000 });
await page.evaluate(() => window.__quickStart());
await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 30000 });
const rows = [];
async function sample(min) {
  await cdp.send('HeapProfiler.collectGarbage'); await sleep(300);
  const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const dom = await cdp.send('Memory.getDOMCounters').catch(() => ({}));
  const g = await page.evaluate(() => { const G = window.__game, r = G.three.renderer.info; let n = 0; G.three.scene.traverse(() => n++);
    return { geom: r.memory.geometries, tex: r.memory.textures, progs: r.programs?.length, calls: r.render.calls, objs: n, veh: G.vehicles?.list?.length, own: G.vehicles.list.reduce((a, v) => { const k = v.owner + (v.wrecked ? '+w' : '') + (v.driver ? '+d' : ''); a[k] = (a[k] || 0) + 1; return a; }, {}), peds: G.npc?.peds?.length ?? G.npc?.list?.length ?? null, fps: Math.round(G.loop?.fps ?? 0) }; }).catch((e) => ({ err: e.message }));
  const row = { min, heapMo: +(m.JSHeapUsedSize / 1048576).toFixed(1), nodes: dom.nodes, listeners: dom.jsEventListeners, ...g };
  rows.push(row); console.log(JSON.stringify(row));
}
const t0 = Date.now(); let nextSample = 0, cycle = 0, pannes = 0;
await sample(0); nextSample = 1;
while ((Date.now() - t0) < MIN * 60000) {
  cycle++;
  const m = Math.floor((Date.now() - t0) / 60000);
  const act = cycle % 6;
  try {
    if (act === 0) { await page.keyboard.down('KeyW'); await sleep(2500); await page.keyboard.down('KeyD'); await sleep(800); await page.keyboard.up('KeyW'); await page.keyboard.up('KeyD'); }
    else if (act === 1) { await page.evaluate(() => { const g = window.__game, p = g.player.position; if (g.player.state === 'inVehicle') return;
        const cars = g.vehicles.list.filter((v) => !v.driver && !v.destroyed && v.owner !== 'remote' && v.owner !== 'police'); if (!cars.length) return;
        cars.sort((a, b) => Math.hypot(a.object3d.position.x - p.x, a.object3d.position.z - p.z) - Math.hypot(b.object3d.position.x - p.x, b.object3d.position.z - p.z));
        const o = cars[0].object3d.position, yaw = cars[0].object3d.rotation.y; g.player.teleport({ x: o.x + Math.cos(yaw) * 2, z: o.z - Math.sin(yaw) * 2 }); });
      await sleep(300); await page.keyboard.press('KeyF'); await sleep(500); await page.keyboard.down('KeyW'); await sleep(5000); await page.keyboard.up('KeyW'); }
    else if (act === 2) { await page.evaluate(() => { const g = window.__game; if (g.player.state === 'inVehicle') g.vehicles.exit(g.player); }); await sleep(500);
      for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__game.ui.openMap()); await sleep(600); await page.evaluate(() => window.__game.ui.closeMap()); await sleep(300); await page.evaluate(() => window.__game.ui.openPhone()); await sleep(600); await page.evaluate(() => window.__game.ui.closePhone()); await sleep(300); } }
    else if (act === 3) { await page.evaluate(() => { const g = window.__game; if (g.player.state === 'inVehicle') g.vehicles.exit(g.player); const c = g.gameplay.currentCharacter, t = g.gameplay.characters.find((x) => x !== c); g.gameplay.switchCharacter(t); });
      await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 15000 }).catch(() => {}); await sleep(1500); }
    else if (act === 4) { await page.evaluate(() => { const g = window.__game, p = g.player.position; for (let i = 0; i < 3; i++) g.bus.emit('crime', { kind: 'carjack', severity: 2, witnessed: true, position: { x: p.x, y: p.y, z: p.z } }); }); await sleep(6000); await page.evaluate(() => window.__game.police.clear?.()); }
    else if (act === 5 && m >= 2 + pannes * 3 && pannes < 4) { pannes++; dc('restart', `game-${1 + (pannes % 3)}`); await sleep(8000); }
    else await sleep(2000);
  } catch (e) { errors.push('action ' + act + ': ' + e.message.slice(0, 100)); }
  if ((Date.now() - t0) >= nextSample * 60000) { await sample(nextSample); nextSample++; }
}
await sample(MIN);
console.log('ERREURS', errors.length, JSON.stringify([...new Set(errors)].slice(0, 6)), 'pannes', pannes);
await browser.close();
