// Détecteur de chutes sous le monde (headless) : marche, conduite rapide et téléportations pendant N secondes.
// Surveille tous les corps Rapier (voitures de circulation, garées, joueur…) et les piétons : toute entité
// sous le sol (ou hors du heightfield) est journalisée avec sa position, la tuile et l'état du collider.
// Usage : node scripts/playtest/chutes.mjs [secondes=300] [url]   (sans url : lance le serveur local, Redis requis)
// Sortie : code 1 s'il y a au moins une chute.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';

const DUREE = +(process.argv[2] || 300);
let url = process.argv[3];
const root = new URL('../..', import.meta.url).pathname;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server = null;
if (!url) {
  const port = 18600 + Math.floor(Math.random() * 400);
  server = spawn('node', ['src/server.js'], { cwd: root, env: { ...process.env, PORT: String(port), REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6380' }, stdio: 'ignore' });
  url = `http://localhost:${port}/`;
  for (let i = 0; i < 40; i++) { try { if ((await fetch(url + 'healthz')).ok) break; } catch { /* pas prêt */ } await sleep(250); }
}
const GL = ['--use-angle=' + (process.env.SMOKE_GL || (process.platform === 'darwin' ? 'metal' : 'default')), '--ignore-gpu-blocklist', '--enable-gpu'];
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: GL });
let falls = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__quickStart === 'function' && window.__game, null, { timeout: 60000 });
  await page.evaluate(() => window.__quickStart());
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 30000 });
  await sleep(1500);

  // sonde dans la page : toutes les 100 ms, corps Rapier + piétons sous le sol
  await page.evaluate(() => {
    const g = window.__game, W = g.world, pw = g.physics.world, HF = 700;
    window.__falls = []; window.__spawnUnder = []; window.__fps = [];
    const open = new Map(); // handle → épisode en cours
    const tile = (x, z) => `${Math.floor((x + 600) / 100)},${Math.floor((z + 600) / 100)}`;
    const nameOf = (h) => {
      const b = pw.getRigidBody(h);
      if (g.player?.body?.handle === h) return { kind: 'joueur' };
      const v = g.vehicles.list.find((q) => q.chassis?.handle === h);
      if (v) return { kind: 'voiture', type: v.type, owner: v.owner, ambient: !!v.npcDriver, driver: v.driver ? (v.driver === g.player ? 'joueur' : 'pnj') : null, speed: Math.round(v.speed ?? 0), age: +(v._age ?? 0).toFixed(1), epave: !!v.wrecked, retourne: +(v.pv?.flipT ?? 0).toFixed(1), vy: +(b.linvel().y ?? 0).toFixed(1) };
      return { kind: 'autre' };
    };
    const check = (kind, key, x, y, z, extra) => {
      const gh = W.groundHeight(x, z), inHF = Math.abs(x) < HF && Math.abs(z) < HF;
      const under = y < gh - 3 || !inHF;
      if (!under) { open.delete(key); return; }
      if (open.has(key)) return;
      open.set(key, true);
      window.__falls.push({ t: +g.time.elapsed.toFixed(1), kind, ...extra, x: +x.toFixed(1), y: +y.toFixed(1), z: +z.toFixed(1), sol: +gh.toFixed(1), tuile: tile(x, z), colliderCharge: inHF, dessousDuSol: y < gh - 3 });
    };
    setInterval(() => {
      pw.bodies.forEach((b) => {
        if (!b.isDynamic()) return;
        const p = b.translation(); check('corps', b.handle, p.x, p.y, p.z, nameOf(b.handle));
      });
      for (const ped of g.npc?.peds ?? []) if (ped.active) check('pieton', ped, ped.position.x, ped.position.y, ped.position.z, { id: ped.id });
    }, 100);
    g.bus.on('vehicle:spawned', ({ vehicle }) => {
      const p = vehicle.chassis.translation(), gh = W.groundHeight(p.x, p.z);
      if (p.y < gh) window.__spawnUnder.push({ type: vehicle.type, x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1), sol: +gh.toFixed(1) });
    });
  });

  const rnd = (a, b) => a + Math.random() * (b - a);
  // points d'intérêt : collines (ouest), centre, docks, plage, bords de carte
  const SPOTS = [[-450, -300], [-380, -120], [-500, 50], [0, 0], [150, -200], [300, 100], [350, 250], [0, 380], [-200, 450], [560, -560], [-560, 560], [590, 0]];
  const t0 = Date.now(); let cycle = 0;
  while ((Date.now() - t0) / 1000 < DUREE) {
    cycle++;
    const [sx, sz] = SPOTS[cycle % SPOTS.length];
    // téléportation sur la carte, puis marche
    await page.evaluate(([x, z]) => {
      const g = window.__game;
      if (g.player.state === 'inVehicle') g.vehicles.exit(g.player);
      g.player.teleport({ x, z });
    }, [sx + rnd(-30, 30), sz + rnd(-30, 30)]);
    await sleep(800);
    await page.keyboard.down('KeyW'); await sleep(2500); await page.keyboard.down('KeyD'); await sleep(800);
    await page.keyboard.up('KeyW'); await page.keyboard.up('KeyD');
    // conduite rapide : une voiture de course posée à côté, on y monte et on accélère à fond avec des virages
    const ok = await page.evaluate(() => {
      const g = window.__game, p = g.player.position;
      if (g.player.state !== 'onFoot') return false;
      const v = g.vehicles.spawn('race', { x: p.x + 3, z: p.z }, 0, { owner: 'player' });
      g.player.teleport({ x: p.x + Math.cos(0) * 2.0, z: p.z });
      window.__v = v; return true;
    });
    if (ok) {
      await sleep(500); await page.keyboard.press('KeyF');
      await page.waitForFunction(() => window.__game.player.state === 'inVehicle', null, { timeout: 6000 }).catch(() => {});
      await page.keyboard.down('KeyW');
      for (let i = 0; i < 12; i++) { await page.keyboard.down(i % 2 ? 'KeyA' : 'KeyD'); await sleep(350); await page.keyboard.up(i % 2 ? 'KeyA' : 'KeyD'); await sleep(650); }
      // téléportation du véhicule en roulant
      await page.evaluate(([x, z]) => { const g = window.__game, v = g.player.vehicle; if (v) g.vehicles.teleport(v, { x, z }, Math.random() * 6); }, [rnd(-550, 550), rnd(-550, 450)]);
      await sleep(3000);
      await page.keyboard.up('KeyW');
      await page.evaluate(() => { const g = window.__game; if (g.player.state === 'inVehicle') g.vehicles.exit(g.player); });
      await sleep(400);
    }
    const fps = await page.evaluate(async () => { const r = window.__game.three.renderer, f = r.info.render.frame; await new Promise((x) => setTimeout(x, 1000)); return r.info.render.frame - f; });
    process.stdout.write(`\r${Math.round((Date.now() - t0) / 1000)} s, cycle ${cycle}, ${fps} i/s, chutes ${await page.evaluate(() => window.__falls.length)}   `);
  }
  falls = await page.evaluate(() => window.__falls);
  const sp = await page.evaluate(() => window.__spawnUnder);
  console.log(`\n${DUREE} s : ${falls.length} chute(s), ${(falls.length / (DUREE / 60)).toFixed(2)}/min ; apparitions sous le sol : ${sp.length}`);
  for (const f of falls) console.log(JSON.stringify(f));
  for (const s of sp.slice(0, 20)) console.log('apparition sous le sol', JSON.stringify(s));
} finally {
  await browser.close();
  server?.kill('SIGTERM');
}
process.exit(falls.length ? 1 : 0);
