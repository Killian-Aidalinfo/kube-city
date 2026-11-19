// Playtest social : 2 navigateurs sur 2 pods différents. Valide emote, course (compte à rebours commun, classement final pour tous),
// chasse aux kubes dorés avec MORT DU POD LEADER en pleine chasse, classement de session.
// Prérequis : COMPOSE_PROJECT_NAME=kc-social LB_PORT=8306 HUNT_DURATION_MS=30000 RACE_LOBBY_MS=12000 docker compose up -d --build
// Usage : LB_PORT=8306 node scripts/playtest/social.mjs [url]     Sortie : JSON + code 1 si un critère échoue.
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const URL_ = process.argv[2] || `http://localhost:${process.env.LB_PORT || 8080}/`;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dc = (args) => execSync(`docker compose ${args}`, { cwd: root, stdio: 'pipe', env: process.env }).toString();
const GL = ['--use-angle=' + (process.platform === 'darwin' ? 'metal' : 'default'), '--ignore-gpu-blocklist', '--enable-gpu', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
const fails = [], R = {};
const check = (ok, msg) => { if (!ok) fails.push(msg); };
let browser;

async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`${name} exception : ${e.message}`));
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__quickStart === 'function' && window.__game, null, { timeout: 60000 });
  await page.evaluate(() => window.__quickStart());
  await page.waitForFunction(() => window.__game.state === 'playing' && window.__game.net.connected && window.__game.social, null, { timeout: 30000 });
  // enregistreur de messages serveur
  await page.evaluate(() => {
    const g = window.__game; window.__msgs = []; window.__chat = []; window.__emotes = [];
    g.bus.on('net:message', (m) => window.__msgs.push({ ...m, at: Date.now() }));
    g.bus.on('net:chat', (c) => window.__chat.push(c.text));
    g.bus.on('net:emote', (e) => window.__emotes.push(e));
  });
  return page;
}
const pod = (P) => P.evaluate(() => window.__game.net.status.pod);
const msgs = (P, t) => P.evaluate((t) => window.__msgs.filter((m) => m.t === t), t);
const waitFor = async (fn, timeout, step = 300) => { const t = Date.now(); while (Date.now() - t < timeout) { if (await fn()) return true; await sleep(step); } return false; };
const tp = (P, x, z) => P.evaluate(([x, z]) => window.__game.player.teleport({ x, z }), [x, z]);
const money = (P) => P.evaluate(() => window.__game.gameplay.money);
const leaderPod = async () => (await (await fetch(URL_ + 'api/info')).json()).leader;

try {
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: GL });
  const A = await player('A');
  let B = await player('B');
  for (let i = 0; i < 8 && (await pod(A)) === (await pod(B)); i++) { await B.context().close(); B = await player('B'); } // pods différents : tout passe par Redis
  R.pods = { A: await pod(A), B: await pod(B) };
  check(R.pods.A !== R.pods.B, 'A et B sur le même pod');
  const ids = { A: await A.evaluate(() => window.__game.net.id), B: await B.evaluate(() => window.__game.net.id) };
  const m0 = { A: await money(A), B: await money(B) };

  // ---------- 1. emote : A salue, B voit la bulle au-dessus de A ----------
  const p0 = await A.evaluate(() => { const p = window.__game.player.position; return { x: p.x, z: p.z }; });
  await tp(B, p0.x + 3, p0.z + 3); await sleep(1500);
  await A.keyboard.press('Digit7'); // « Bravo »
  const emoteSeen = await waitFor(async () => (await B.evaluate(() => window.__emotes.some((e) => e.e === 'bravo')))
    && (await B.evaluate(() => { let n = 0; window.__game.three.scene.traverse((o) => { if (o.isSprite && o.renderOrder === 1000) n++; }); return n; })) > 0, 6000);
  check(emoteSeen, 'emote : B ne voit pas la bulle de A');
  check(await A.evaluate(() => window.__emotes.some((e) => e.e === 'bravo' && e.id === window.__game.net.id)), 'emote : A ne reçoit pas son propre écho');
  R.emote = emoteSeen;

  // ---------- 2. course : A lance, B rejoint, départ commun, classement final visible par tous ----------
  const dest = await A.evaluate(() => {
    const p = window.__game.player.position, so = window.__game.social;
    return so.places.map((q) => ({ ...q, d: Math.hypot(q.x - p.x, q.z - p.z) })).filter((q) => q.d > 120 && q.d < 450).sort((a, b) => a.d - b.d)[0];
  });
  check(!!dest, 'course : aucun lieu à 120-450 m');
  await A.evaluate((k) => window.__game.social.createRace(k), dest.key);
  const bSees = await waitFor(() => B.evaluate(() => window.__game.social.raceList().length > 0), 6000);
  check(bSees, 'course : B ne voit pas la course proposée');
  const raceId = await B.evaluate(() => window.__game.social.raceList()[0]?.id);
  await B.evaluate((id) => window.__game.social.joinRace(id), raceId);
  check(await waitFor(async () => (await A.evaluate(() => window.__game.social.raceList()[0]?.entrants.length)) === 2, 6000), 'course : A ne voit pas B inscrit');
  // compte à rebours commun : mêmes secondes restantes (écart < 1,5 s) à l'instant T
  const left = await Promise.all([A, B].map((P) => P.evaluate(() => { const r = window.__game.social.myRace; return r ? (r.startAt - window.__game.social.serverNow()) / 1000 : null; })));
  R.countdownLeft = left;
  check(left[0] != null && left[1] != null && Math.abs(left[0] - left[1]) < 1.5, `course : compte à rebours différent (${left})`);
  const goAt = await A.evaluate(() => window.__game.social.myRace.startAt - window.__game.social.serverNow());
  await sleep(Math.max(0, goAt) + 800);
  const overlay = await Promise.all([A, B].map((P) => P.evaluate(() => document.querySelector('.kc-soc-count')?.textContent || '')));
  check(overlay.every((t) => /PARTEZ|Course vers/.test(t)), `course : bandeau de départ absent (${overlay})`);
  const end = dest; // la ligne d'arrivée est le dernier point du parcours serveur
  const fin = await A.evaluate(() => window.__game.social.myRace.checkpoints.at(-1));
  await tp(A, fin.x, fin.z); await sleep(2500); await tp(B, fin.x, fin.z); // A franchit la ligne en premier, B 2,5 s après
  const gotEnd = await waitFor(async () => (await msgs(A, 'race_end')).length > 0 && (await msgs(B, 'race_end')).length > 0, 90000, 500);
  check(gotEnd, 'course : classement final non reçu par les deux joueurs');
  const endA = (await msgs(A, 'race_end'))[0], endB = (await msgs(B, 'race_end'))[0];
  R.race = { dest: dest.label, rows: endA?.rows?.map((r) => `${r.place}. ${r.name} ${r.ms}ms +${r.prize}`) };
  check(endA?.rows?.length === 2 && endA.rows[0].id === ids.A && endA.rows[1].id === ids.B, 'course : ordre du classement inattendu');
  check(JSON.stringify(endA?.rows) === JSON.stringify(endB?.rows), 'course : les deux joueurs ne voient pas le même classement');
  check(await A.evaluate(() => document.querySelector('.kc-soc-res')?.style.display !== 'none') && await B.evaluate(() => /classement final/.test(document.querySelector('.kc-soc-res')?.textContent || '')), 'course : panneau de classement non affiché');
  await sleep(1500);
  check((await money(A)) >= m0.A + 300 && (await money(B)) >= m0.B + 200, `course : primes non créditées (A ${m0.A}->${await money(A)}, B ${m0.B}->${await money(B)})`);

  // ---------- 3. chasse aux kubes dorés, avec mort du leader en pleine chasse ----------
  dc('exec -T redis redis-cli set pn:hunt:next 1');
  const huntSeen = await waitFor(async () => (await Promise.all([A, B].map((P) => P.evaluate(() => window.__game.social.hunt?.kubes?.length)))).every((n) => n === 5), 12000);
  check(huntSeen, 'chasse : 5 kubes dorés non reçus par les deux joueurs');
  const hunt = await A.evaluate(() => window.__game.social.hunt);
  const ldr = await leaderPod();
  R.hunt = { id: hunt?.id, leaderKilled: ldr };
  const mh = { A: await money(A), B: await money(B) };
  await tp(A, hunt.kubes[0].x, hunt.kubes[0].z); // A prend le kube 0 AVANT la mort du leader
  const a0 = await waitFor(async () => (await msgs(A, 'hunt_claim')).some((m) => m.ok), 6000);
  check(a0, 'chasse : A n\'a pas pu ramasser le kube 0');
  dc(`kill ${ldr}`); // le pod leader meurt en pleine chasse
  const t0 = Date.now();
  await tp(B, hunt.kubes[1].x, hunt.kubes[1].z); // B ramasse un autre kube, servi par un pod survivant
  const b1 = await waitFor(async () => (await msgs(B, 'hunt_claim')).some((m) => m.ok), 20000);
  check(b1, 'chasse : B n\'a pas pu ramasser le kube 1 après la mort du leader');
  await tp(B, hunt.kubes[0].x, hunt.kubes[0].z); // déjà pris par A : le client n'essaie plus ; on force la demande pour vérifier le refus serveur
  await sleep(800); // la position doit atteindre le serveur avant la demande
  await B.evaluate(([id, i]) => window.__game.net.send('hunt_claim', { huntId: id, i }), [hunt.id, 0]);
  await waitFor(async () => (await msgs(B, 'hunt_claim')).some((m) => m.taken), 6000);
  check((await msgs(B, 'hunt_claim')).some((m) => m.taken), 'chasse : le kube déjà pris n\'est pas refusé');
  await tp(A, hunt.kubes[2].x, hunt.kubes[2].z); // A en prend un deuxième : il gagnera 2 à 1
  await sleep(2500);
  const newLeader = await waitFor(async () => { const l = await leaderPod().catch(() => null); return l && l !== ldr; }, 15000);
  check(newLeader, 'chasse : aucun nouveau leader élu');
  const over = await waitFor(async () => (await msgs(A, 'hunt_end')).length > 0 && (await msgs(B, 'hunt_end')).length > 0, 60000, 500);
  check(over, 'chasse : fin de chasse non annoncée (le nouveau leader n\'a pas repris la main)');
  const he = (await msgs(A, 'hunt_end'))[0];
  R.hunt.end = { afterKillMs: Date.now() - t0, winner: he?.winner?.name, rows: he?.rows?.map((r) => `${r.name}:${r.count}`) };
  check(he?.winner?.id === ids.A && he.rows.find((r) => r.id === ids.B)?.count === 1, 'chasse : vainqueur inattendu (A devrait gagner 2 à 1)');
  await sleep(1500);
  check((await money(A)) >= mh.A + 200 + 500, `chasse : argent de A ${mh.A} -> ${await money(A)} (attendu +100 +100 +500)`);
  check((await money(B)) >= mh.B + 100, `chasse : argent de B ${mh.B} -> ${await money(B)}`);

  // ---------- 4. classement de la session (touche L) et Radio Kube ----------
  await A.evaluate(() => window.__game.gameplay.addMoney(200, 'test')); await sleep(6000); // flush des gains vers le serveur
  await A.keyboard.press('KeyL'); await sleep(1500);
  const rows = await A.evaluate(() => window.__game.social.board);
  const shown = await A.evaluate(() => /Classement de la session/.test(document.querySelector('.kc-soc-board')?.textContent || '') && document.querySelector('.kc-soc-board').style.display !== 'none');
  check(shown, 'classement : panneau L non affiché');
  const ra = rows.find((r) => r.id === ids.A), rb = rows.find((r) => r.id === ids.B);
  R.board = rows.map((r) => `${r.name}: ${Math.round(r.money)}€ ${r.races}c ${r.kubes}k`);
  check(ra && ra.money > 0 && ra.races === 1 && ra.kubes >= 2, 'classement : ligne de A incohérente');
  check(rb && rb.races === 1 && rb.kubes >= 1, 'classement : ligne de B incohérente');
  const chat = await B.evaluate(() => window.__chat);
  R.radio = chat.filter((t) => /course|Chasse|dépasse|tête|kubes/.test(t)).slice(-6);
  check(chat.some((t) => /lance une course/.test(t)) && chat.some((t) => /Chasse terminée/.test(t)), 'Radio Kube : annonces course/chasse manquantes');
  check(chat.some((t) => /dépasse \d+ € gagnés|prend la tête/.test(t)), 'Radio Kube : aucun exploit annoncé');
} catch (e) {
  fails.push(`exception du script : ${e.stack || e.message}`);
} finally {
  try { dc('start game-1 game-2 game-3'); } catch { /* déjà démarrés */ }
  await browser?.close();
}
console.log(JSON.stringify({ ok: !fails.length, fails, ...R }, null, 2));
process.exit(fails.length ? 1 : 0);
