// Playtest headless : lance chaque mission (3 persos + casse final), les activités et une boutique, et les termine
// en téléportant le joueur d'objectif en objectif. Échoue sur toute erreur console ou mission non terminée.
// Usage : node scripts/playtest/missions.mjs [url]   (sans argument : lance le serveur local sur le port 8301, Redis requis)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = path.join(root, 'scripts', 'out');
mkdirSync(out, { recursive: true });
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server = null;
let url = process.argv[2];
if (!url) {
  const port = process.env.PLAYTEST_PORT || 8301;
  server = spawn('node', ['src/server.js'], { cwd: root, env: { ...process.env, PORT: String(port), REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6380' }, stdio: 'ignore' });
  url = `http://localhost:${port}/`;
  for (let i = 0; i < 40; i++) { try { if ((await fetch(url + 'healthz')).ok) break; } catch { /* pas prêt */ } await sleep(250); }
}

const errors = [];
const results = [];
const GL = process.env.SMOKE_GL === 'swiftshader'
  ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  : ['--use-angle=' + (process.platform === 'darwin' ? 'metal' : 'default'), '--ignore-gpu-blocklist', '--enable-gpu'];
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: GL });
let current = 'init';
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console (${current}) : ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`exception (${current}) : ${e.message}`));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__quickStart === 'function' && window.__game, null, { timeout: 60000 });
  await page.evaluate(() => window.__quickStart('ines'));
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 30000 });
  await sleep(1000);

  // Pilote injecté dans la page : un pas de « joueur automate » selon le type d'objectif courant.
  await page.evaluate(() => {
    const g = window.__game, gp = g.gameplay, pl = () => g.player;
    window.__log = { subs: [], notifs: [], passed: [], failed: [] };
    g.bus.on('subtitle', (s) => window.__log.subs.push(`${s.speaker}: ${s.text}`));
    g.bus.on('notify', (n) => window.__log.notifs.push(n.text));
    g.bus.on('mission:passed', (m) => window.__log.passed.push(m));
    g.bus.on('mission:failed', (m) => window.__log.failed.push(m));
    const seenWanted = {};
    window.__step = () => {
      const a = gp.active;
      if (g.state !== 'playing') return 'wait';
      if (!a) return 'idle';
      const t = a.target, p = pl();
      const veh = p.vehicle;
      const put = (pos) => {
        const y = (g.world?.groundHeight?.(pos.x, pos.z) ?? 0) + 1.2;
        if (veh) g.vehicles.teleport(veh, { x: pos.x, y, z: pos.z });
        else p.teleport({ x: pos.x, y: y - 0.9, z: pos.z });
      };
      switch (a.type) {
        case 'enterVehicle': {
          if (!t) return 'wait';
          if (p.state === 'inVehicle' || veh) return 'wait';
          const v = g.vehicles.nearestEnterable({ x: t.x, y: t.y ?? 0, z: t.z }, 12);
          if (!v) return 'wait';
          p.teleport({ x: t.x + 3, y: (g.world?.groundHeight?.(t.x, t.z) ?? 0) + 0.3, z: t.z });
          g.vehicles.enter(p, v.vehicle, 0);
          return 'enter';
        }
        case 'goto': case 'follow': case 'race': case 'chase': case 'reroute': case 'ko': case 'photo': {
          if (a.type === 'ko') { for (let i = 0; i < 3; i++) g.bus.emit('npc:ko', {}); return 'ko'; }
          if (!t) return 'wait';
          if (a.type === 'photo') { put({ x: t.x + 5, z: t.z }); g.bus.emit('ui:photo', {}); return 'photo'; }
          put(t);
          return 'tp';
        }
        case 'evade': {
          const k = a.id + a.text;
          if (!seenWanted[k]) { seenWanted[k] = performance.now(); return 'wait'; }
          if (g.police.level > 0 && performance.now() - seenWanted[k] > 1500) g.police.clear();
          return 'evade';
        }
        default: return 'wait';
      }
    };
  });

  const state = () => page.evaluate(() => ({ money: window.__game.gameplay.money, ch: window.__game.gameplay.currentCharacter, active: window.__game.gameplay.active, log: window.__log }));
  const run = async (kind, id, timeout = 120000) => {
    current = `${kind} ${id}`;
    const before = await state();
    await page.evaluate(({ kind, id }) => { window.__log.passed.length = 0; window.__log.failed.length = 0; window.__log.subs.length = 0; return kind === 'mission' ? window.__game.gameplay.startMission(id) : window.__game.gameplay.startActivity(id); }, { kind, id });
    const t0 = Date.now();
    let s, trace = [];
    for (;;) {
      await sleep(250);
      await page.evaluate(() => window.__step());
      s = await state();
      if (s.active && trace[trace.length - 1] !== s.active.text) trace.push(s.active.text);
      if (s.log.passed.length) break;
      if (!s.active) break;
      if (Date.now() - t0 > timeout) break;
    }
    const passed = s.log.passed[0];
    const ok = !!passed && s.money >= before.money;
    const banner = await page.evaluate(() => document.querySelector('.kc-banner h2')?.textContent || '');
    if (passed && !/Mission réussie/.test(banner)) errors.push(`${current} : écran « Mission réussie » absent (${banner})`);
    if (s.log.failed.length) errors.push(`${current} : échec en cours de route : ${s.log.failed.map((f) => f.text).join(' / ')}`);
    results.push({ name: current, ok, reward: passed?.reward ?? 0, gain: s.money - before.money, steps: trace.length, subs: s.log.subs.length, ms: Date.now() - t0 });
    if (!ok) { errors.push(`${current} : non terminée (étape : ${s.active?.text || 'aucune'})`); await page.screenshot({ path: path.join(out, `playtest-${id}.png`) }); await page.evaluate(() => window.__game.gameplay.abandon()); }
    await sleep(2800); // laisse la bannière disparaître
  };
  const switchTo = async (id) => {
    await page.evaluate((id) => window.__game.gameplay.switchCharacter(id), id);
    await page.waitForFunction((id) => window.__game.gameplay.currentCharacter === id && window.__game.state === 'playing', id, { timeout: 20000 });
    await sleep(500);
  };
  const enterMission = async (id, ch) => { if ((await state()).ch !== ch) await switchTo(ch); await run('mission', id); };

  for (const [ch, ids] of [['ines', ['ines_1', 'ines_2', 'ines_3']], ['malik', ['malik_1', 'malik_2', 'malik_3']], ['jade', ['jade_1', 'jade_2', 'jade_3']]]) {
    for (const id of ids) await enterMission(id, ch);
  }
  await switchTo('jade');
  await run('mission', 'finale', 240000);

  // activités : taxi, livraison, course (en voiture)
  await switchTo('ines');
  for (const k of ['taxi', 'delivery', 'race', 'rolling', 'chaos', 'dns']) {
    current = `préparation ${k}`;
    await page.evaluate(() => {
      const g = window.__game, p = g.player;
      if (!p.vehicle) { const pos = p.position; const v = g.vehicles.spawn('sport', { x: pos.x + 5, y: pos.y + 1, z: pos.z }, 0, { owner: 'player' }); p.teleport({ x: pos.x + 8, y: pos.y, z: pos.z }); g.vehicles.enter(p, v, 0); }
    });
    await sleep(2500);
    await run('activity', k);
  }

  // kube (ramassage par proximité)
  current = 'kube';
  const m0 = (await state()).money;
  const kube = await page.evaluate(async () => {
    const g = window.__game, gp = g.gameplay, p = g.player;
    if (p.vehicle) g.vehicles.exit(p);
    await new Promise((r) => setTimeout(r, 1500));
    const k = gp.kubePositions[0];
    const before = gp.kubes.found;
    p.teleport({ x: k.x, y: (g.world?.groundHeight?.(k.x, k.z) ?? 0) + 1.5, z: k.z });
    await new Promise((r) => setTimeout(r, 800));
    return { found: gp.kubes.found - before };
  });
  results.push({ name: 'kube', ok: kube.found === 1, gain: (await state()).money - m0 });
  if (kube.found !== 1) errors.push('kube : ramassage KO');

  // cascade : le détecteur est testé en logique pure (test/), ici on vérifie que le compteur existe
  const jumps = await page.evaluate(() => window.__game.gameplay.profile.stats.jumps);
  results.push({ name: 'cascade (compteur seulement, saut physique non simulé)', ok: Number.isFinite(jumps) });

  // boutique : ouverture, achat, argent débité
  current = 'boutique';
  const shop = await page.evaluate(async () => {
    const g = window.__game, gp = g.gameplay;
    gp.addMoney(500, 'test');
    const m = gp.money;
    gp.openShop('clothes');
    await new Promise((r) => setTimeout(r, 500));
    const shown = !!document.querySelector('.kc-shop');
    const r = gp.buy('clothes', 'top:#2f6fb3');
    return { shown, ok: r.ok, spent: m - gp.money };
  });
  const shopOk = shop.shown && shop.ok && shop.spent === 40;
  results.push({ name: 'boutique', ok: shopOk, gain: -shop.spent });
  if (!shopOk) errors.push(`boutique : ${JSON.stringify(shop)}`);
  await page.screenshot({ path: path.join(out, 'playtest-boutique.png') });
} catch (e) {
  errors.push(`playtest : ${e.stack || e}`);
} finally {
  await browser.close();
  server?.kill();
}
for (const r of results) console.log(`${r.ok ? 'OK ' : 'KO '} ${r.name}${r.reward !== undefined ? ` · récompense ${r.reward} € · gain réel ${r.gain} € · ${r.steps} objectifs · ${r.subs} sous-titres · ${(r.ms / 1000).toFixed(0)} s` : ''}`);
if (errors.length) { console.error('\nERREURS :\n- ' + errors.join('\n- ')); process.exit(1); }
console.log('\nPlaytest OK');
