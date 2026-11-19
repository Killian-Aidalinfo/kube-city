// Parcours « débutant » : écran titre → perso → marche → voiture → GPS mission 1 → téléphone/carte/classement/cluster → arrestation.
// Pas de __quickStart : clics et touches réels. Usage : node scripts/playtest/debutant.mjs [url] ; captures dans scripts/out/deb-*.png
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const url = process.argv[2] || 'http://localhost:8312/';
const only = process.env.STEPS ? process.env.STEPS.split(',') : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('console', (m) => m.type() === 'error' && errs.push(m.text())); page.on('pageerror', (e) => errs.push(e.message));
const shot = (n) => page.screenshot({ path: path.join(root, 'scripts/out', `deb-${n}.png`) });
const txt = () => page.evaluate(() => [...document.querySelectorAll('#kc-ui *, .kc-tip, .kc-hud *')].filter((e) => e.children.length === 0 && e.offsetParent && e.textContent.trim()).map((e) => e.textContent.trim()).join(' | ').slice(0, 700));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('.kc-title', { timeout: 60000 }); const tTitle = Date.now() - t0;
await sleep(800); await shot('1-titre');
await page.keyboard.press('Enter'); await page.waitForSelector('.kc-char img[src^="data"]', { timeout: 30000 }).catch(() => {}); await sleep(500);
const tSel = Date.now() - t0; await shot('2-select');
await page.fill('#kc-name', 'Etudiant');
const tPlay0 = Date.now(); await page.click('.kc-char[data-id=ines]');
await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 60000 }); const tLoad = Date.now() - tPlay0;
await sleep(300); await shot('3-premier-pas');
console.log(JSON.stringify({ titreMs: tTitle, selectMs: tSel, chargementMs: tLoad, totalJouableMs: Date.now() - t0 }));
console.log('pseudo serveur', await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 1200)); const g = window.__game; return g.net.name + ' | reco ' + document.querySelector('.kc-ha .re')?.textContent; }));
console.log('HUD:', await txt());
const info = () => page.evaluate(() => { const g = window.__game, p = g.player.position, m = g.gameplay.markers.filter((k) => k.kind === 'mission').map((k) => `${k.label} ${Math.round(Math.hypot(k.x - p.x, k.z - p.z))}m`); const c = g.vehicles.list.filter((v) => !v.driver && !v.destroyed && v.owner !== 'remote' && v.owner !== 'police').map((v) => Math.round(Math.hypot(v.object3d.position.x - p.x, v.object3d.position.z - p.z))).sort((a, b) => a - b)[0]; return { pos: [Math.round(p.x), Math.round(p.z)], missions: m, voitureProche: c, wp: g.gameplay.waypoint || null }; });
console.log('INFO', JSON.stringify(await info()));
await page.mouse.click(640, 360); await sleep(300);
await page.keyboard.down('KeyW'); await sleep(2500); await page.keyboard.up('KeyW');
console.log('TXT apres marche:', await txt()); await shot('4-marche');
// voiture : se place à côté de la plus proche (comme après avoir marché), côté conducteur
await page.evaluate(() => { const g = window.__game, p = g.player.position; const cars = g.vehicles.list.filter((v) => !v.driver && !v.destroyed && v.owner !== 'remote' && v.owner !== 'police'); cars.sort((a, b) => Math.hypot(a.object3d.position.x - p.x, a.object3d.position.z - p.z) - Math.hypot(b.object3d.position.x - p.x, b.object3d.position.z - p.z)); const o = cars[0].object3d.position, yaw = cars[0].object3d.rotation.y; g.player.teleport({ x: o.x + Math.cos(yaw) * 2.0, z: o.z - Math.sin(yaw) * 2.0 }); });
await sleep(1500); console.log('TXT pres voiture:', await txt()); await shot('5-pres-voiture');
await page.keyboard.press('KeyF'); await sleep(1500);
console.log('inVehicle', await page.evaluate(() => window.__game.player.state)); await sleep(500); console.log('TXT voiture:', await txt()); await shot('6-voiture');
await page.keyboard.down('KeyW'); await sleep(3000); await shot('7-roule'); await page.keyboard.up('KeyW');
console.log('TXT roule:', await txt());
// mission 1 : sortir, aller au marqueur jaune du garage (téléporté à 12 m), parler
await page.keyboard.press('KeyF'); await sleep(1500);
await page.evaluate(() => { const g = window.__game, m = g.gameplay.markers.find((k) => k.kind === 'mission'); g.player.teleport({ x: m.x + 12, z: m.z }); });
await sleep(1500); console.log('TXT marqueur:', await txt()); await shot('8-marqueur');
await page.evaluate(() => { const g = window.__game, m = g.gameplay.markers.find((k) => k.kind === 'mission'); g.player.teleport({ x: m.x + 1.5, z: m.z }); });
await sleep(800); await shot('8b-parler'); await page.keyboard.press('KeyF'); await sleep(2500);
console.log('TXT dialogue:', await txt()); await shot('9-dialogue');
await sleep(9000); console.log('TXT apres dialogue:', await txt()); await shot('10-objectif');
console.log('active', await page.evaluate(() => { const a = window.__game.gameplay.active; return a && { t: a.title, text: a.text, tgt: a.target }; }), 'wp', await page.evaluate(() => window.__game.ui.waypoint));
// voiture de sport de la mission : rejoindre à pied (téléport à 3 m), F, rouler quelques secondes vers le GPS
await page.evaluate(() => { const g = window.__game, t = g.gameplay.active.target; g.player.teleport({ x: t.x - 2, z: t.z - 2 }); });
await sleep(1200); await page.keyboard.press('KeyF'); await sleep(2500);
console.log('apres F voiture mission:', await page.evaluate(() => window.__game.player.state + ' | ' + window.__game.gameplay.active.text)); console.log('TXT mission en voiture:', await txt()); await shot('11-sport');
await page.keyboard.down('KeyW'); await sleep(3000); await shot('12-gps'); await page.keyboard.up('KeyW');
console.log('wp', JSON.stringify(await page.evaluate(() => window.__game.ui.waypoint)), 'text', await page.evaluate(() => window.__game.gameplay.active.text));
// arrivée : téléport au port, voiture comprise
await page.evaluate(() => { const g = window.__game, t = g.gameplay.active.target, v = g.player.vehicle; g.player.teleport?.({ x: t.x, z: t.z }); v?.chassis?.setTranslation?.({ x: t.x, y: 1, z: t.z }, true); });
await sleep(4000); console.log('TXT fin:', await txt()); await shot('13-livraison'); await sleep(7000); await shot('14-fin');
console.log('missions faites', await page.evaluate(() => JSON.stringify(window.__game.gameplay.profile.missions)), 'argent', await page.evaluate(() => window.__game.gameplay.profile.money ?? ''));
// panneaux : téléphone, carte, classement, cluster
await page.keyboard.press('KeyF'); await sleep(1500);
await page.keyboard.press('KeyP'); await sleep(800); await shot('15-telephone'); console.log('TXT tel:', await txt());
await page.keyboard.press('Escape'); await sleep(500);
await page.keyboard.press('KeyM'); await sleep(900); await shot('16-carte'); await page.keyboard.press('KeyM'); await sleep(500);
await page.keyboard.press('KeyL'); await sleep(900); await shot('17-classement'); await page.keyboard.press('KeyL'); await sleep(400);
await page.keyboard.press('KeyK'); await sleep(900); await shot('18-cluster'); await page.keyboard.press('KeyK'); await sleep(400);
console.log('etat', await page.evaluate(() => window.__game.state));
// K.O.
await page.evaluate(() => window.__game.player.applyDamage(500, 'test')); await sleep(1500); await shot('19-ko'); console.log('TXT ko:', await txt());
await sleep(5000); await shot('20-reveil'); console.log('TXT reveil:', await txt(), await page.evaluate(() => window.__game.player.state));
// arrestation
await page.evaluate(() => { const g = window.__game, p = g.player.position; for (let i = 0; i < 4; i++) g.bus.emit('crime', { kind: 'carjack', severity: 2, witnessed: true, position: { x: p.x, y: p.y, z: p.z } }); });
await sleep(3000); await shot('21-recherche'); console.log('police', await page.evaluate(() => window.__game.police.level));
await page.evaluate(() => window.__game.bus.emit('wanted:busted', {})); await sleep(1500); await shot('22-arrete'); console.log('TXT arrete:', await txt());
console.log('ERRS', errs.slice(0, 5));
await browser.close();
