// Tests de la logique pure du gameplay : persos, sauvegarde, missions, course, kubes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS, CHARACTER_IDS, gainStat, checkAchievements } from '../client/src/gameplay/characters.js';
import { defaultProfile, mergeProfile, loadProfile, saveProfile } from '../client/src/gameplay/save.js';
import { MISSIONS, availableMissions } from '../client/src/gameplay/missions.js';
import { createRunner, STEP_TYPES } from '../client/src/gameplay/runner.js';
import { createRace, kubePositions, pathLength, pointAlong, taxiTip, createAirTracker, raceReward } from '../client/src/gameplay/activities.js';

function fakeEnv(over = {}) {
  const me = { x: 0, z: 0 }, log = { say: [], notify: [] };
  const env = {
    me, log, veh: false, wantedLevel: 0, ko: 0, photos: 0, char: 'jade',
    pos: () => me, inVehicle: () => env.veh, wanted: () => env.wantedLevel, setWanted: (n) => { env.wantedLevel = n; },
    place: (r) => (typeof r === 'string' ? { x: r.length * 10, z: 0 } : { x: r.dx ?? 0, z: r.dz ?? 0 }),
    say: (s, t) => log.say.push([s, t]), notify: (t) => log.notify.push(t),
    spawnVehicle: (spec) => ({ pos: () => spec.at }), switchTo: (id) => { env.char = id; }, currentChar: () => env.char,
    koCount: () => env.ko, photoCount: () => env.photos, photoNear: () => true, route: () => null, vehicleDamage: () => 0,
    ...over,
  };
  return env;
}

test('3 persos avec statistiques, capacités et progression plafonnée', () => {
  assert.deepEqual(CHARACTER_IDS, ['ines', 'malik', 'jade']);
  for (const c of Object.values(CHARACTERS)) { assert.ok(c.ability.name && c.specialty && c.defaultOutfit.top); }
  const s = { endurance: 9.99, conduite: 1, combat: 1 };
  assert.equal(gainStat(s, 'endurance', 5), 10);
  assert.equal(gainStat(s, 'inconnu', 1), 0);
});

test('missions : au moins 3 par perso + finale, objectifs connus, prérequis valides', () => {
  const ids = new Set(MISSIONS.map((m) => m.id));
  assert.equal(ids.size, MISSIONS.length);
  for (const c of CHARACTER_IDS) assert.ok(MISSIONS.filter((m) => m.char === c).length >= 3, c);
  assert.ok(ids.has('finale'));
  for (const m of MISSIONS) {
    assert.ok(m.steps.length > 0 && m.title && m.reward > 0);
    for (const r of [].concat(m.requires || [])) assert.ok(ids.has(r), `${m.id} requiert ${r}`);
    for (const s of m.steps) { assert.ok(STEP_TYPES[s.type], `${m.id} : ${s.type}`); assert.ok(s.text, `${m.id} : texte manquant`); }
  }
  // la finale alterne bien les 3 persos
  const sw = MISSIONS.find((m) => m.id === 'finale').steps.filter((s) => s.type === 'switch').map((s) => s.to);
  assert.deepEqual([...new Set(sw)].sort(), ['ines', 'jade', 'malik']);
});

test('missions disponibles selon le perso et la progression', () => {
  let a = availableMissions({}, 'ines').map((m) => m.id);
  assert.deepEqual(a, ['ines_1']);
  a = availableMissions({ ines_1: { done: true } }, 'ines').map((m) => m.id);
  assert.deepEqual(a, ['ines_2']);
  const all = Object.fromEntries(MISSIONS.map((m) => [m.id, { done: true }]));
  delete all.finale;
  assert.deepEqual(availableMissions(all, 'malik').map((m) => m.id), ['finale']);
});

test('exécuteur : aller à, véhicule requis, chrono et reprise', () => {
  const env = fakeEnv();
  const def = { id: 't', title: 't', steps: [{ type: 'goto', text: 'a', to: { x: 50, z: 0 }, vehicle: true, radius: 5, timeLimit: 10 }, { type: 'wait', text: 'b', seconds: 1 }] };
  const r = createRunner(def, env);
  env.me.x = 50;
  assert.equal(r.update(0.1), 'running'); // pas en véhicule
  env.veh = true;
  r.update(0.1);
  assert.equal(r.index, 1);
  assert.equal(r.update(1.1), 'passed');
  // échec par le chrono puis reprise
  const r2 = createRunner(def, fakeEnv());
  assert.equal(r2.update(11), 'failed');
  r2.restartStep();
  assert.equal(r2.status, 'running');
});

test('exécuteur : K.O., photo, semer la police, changement de perso, dialogue', () => {
  const env = fakeEnv();
  const def = { id: 't', title: 't', steps: [
    { type: 'ko', text: 'ko', count: 2 }, { type: 'photo', text: 'photo' },
    { type: 'evade', text: 'semer', level: 3 }, { type: 'switch', text: 's', to: 'malik' },
    { type: 'say', text: 'd', lines: [{ speaker: 'A', text: 'x', dur: 1 }] },
  ] };
  const r = createRunner(def, env);
  env.ko = 1; r.update(0.1); assert.equal(r.index, 0);
  assert.match(r.text, /1\/2/);
  env.ko = 2; r.update(0.1); assert.equal(r.index, 1);
  env.photos = 1; r.update(0.1); assert.equal(r.index, 2);
  assert.equal(env.wantedLevel, 3);
  r.update(0.1); assert.equal(r.index, 2); // toujours recherché
  env.wantedLevel = 0; r.update(0.1); assert.equal(r.index, 3);
  r.update(0.1); r.update(0.1); assert.equal(r.index, 4); assert.equal(env.char, 'malik');
  for (let i = 0; i < 30 && r.status === 'running'; i++) r.update(0.1);
  assert.equal(r.status, 'passed');
  assert.equal(env.log.say.length, 1);
});

test('exécuteur : suivre une cible', () => {
  const env = fakeEnv({ place: (r) => (typeof r === 'string' ? { x: r === 'a' ? 0 : 100, z: 0 } : r) });
  const r = createRunner({ id: 'f', title: 'f', steps: [{ type: 'follow', text: 'suivre', from: 'a', to: 'b', speed: 10 }] }, env);
  for (let i = 0; i < 200; i++) { env.me.x = r.target.x; r.update(0.1); if (r.status !== 'running') break; }
  assert.equal(r.status, 'passed');
  // joueur immobile : la cible attend puis la filature échoue
  const env2 = fakeEnv({ place: env.place });
  const r2 = createRunner({ id: 'f', title: 'f', steps: [{ type: 'follow', text: 's', from: 'a', to: 'b', speed: 10, maxGap: 20, patience: 3 }] }, env2);
  for (let i = 0; i < 400 && r2.status === 'running'; i++) r2.update(0.1);
  assert.equal(r2.status, 'failed');
});

test('course : classement, points de passage et arrivée', () => {
  const cps = [{ x: 100, z: 0 }, { x: 200, z: 0 }];
  const race = createRace(cps, [{ name: 'A', speed: 5 }], { x: 0, z: 0 });
  assert.equal(race.total, 200);
  let res = null;
  for (let i = 0; i < 100 && res !== 'finish'; i++) { const p = { x: Math.min(200, i * 8), z: 0 }; res = race.update(0.5, p); }
  assert.equal(res, 'finish');
  assert.equal(race.place, 1);
  assert.ok(raceReward(1) > raceReward(2) && raceReward(2) > raceReward(5));
});

test('utilitaires : polyligne, taxi, cascade, kubes déterministes', () => {
  const pts = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }];
  assert.equal(pathLength(pts), 20);
  assert.deepEqual(pointAlong(pts, 15), { x: 10, z: 5 });
  assert.ok(taxiTip(100, 10, 100, 0) > taxiTip(100, 90, 100, 0));
  assert.ok(taxiTip(100, 10, 100, 0) > taxiTip(100, 10, 100, 40));
  const air = createAirTracker();
  for (let i = 0; i < 10; i++) air.update(0.1, true, 80);
  assert.ok(air.update(0.1, false, 80).bonus > 40);
  assert.equal(createAirTracker().update(0.1, false, 80), null);
  const k = kubePositions();
  assert.equal(k.length, 50);
  assert.deepEqual(k, kubePositions());
});

test('sauvegarde : fusion robuste, succès, repli local et serveur', async () => {
  const p = mergeProfile({ current: 'jade', chars: { jade: { money: 1234.9, stats: { combat: 99 }, outfit: { top: '#123456', hair: 'rouge' } } }, kubes: [1, 1, 2, 77, 'x'], missions: { ines_1: { done: true } } });
  assert.equal(p.current, 'jade'); assert.equal(p.chars.jade.money, 1234);
  assert.equal(p.chars.jade.stats.combat, 10); assert.equal(p.chars.jade.outfit.top, '#123456');
  assert.equal(p.chars.jade.outfit.hair, CHARACTERS.jade.defaultOutfit.hair);
  assert.deepEqual(p.kubes, [1, 2]);
  assert.equal(mergeProfile('n\'importe quoi').current, 'ines');
  const got = checkAchievements(p); assert.ok(got.some((a) => a.id === 'first_mission'));
  const mem = new Map(); const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  let remote = null;
  const net = { saveProfile: async (pr) => { remote = pr; }, loadProfile: async () => remote };
  await saveProfile(net, p, storage);
  assert.equal(remote.chars.jade.money, 1234);
  assert.equal((await loadProfile(net, storage)).chars.jade.money, 1234);
  // serveur en panne : le localStorage prend le relais
  const down = { loadProfile: async () => { throw new Error('pod arrêté'); }, saveProfile: async () => { throw new Error('x'); } };
  assert.equal((await loadProfile(down, storage)).chars.jade.money, 1234);
  assert.equal(await saveProfile(down, p, storage), false);
  assert.equal(defaultProfile().chars.ines.money, 500);
});

test('course de mission : la première place est exigée quand mustWin', () => {
  const env = { pos: () => ({ x: 0, z: 0 }), inVehicle: () => true, notify() {}, place: (r) => r };
  const step = { type: 'race', text: 'Gagnez', mustWin: true, checkpoints: [{ x: 500, z: 0 }], rivals: [{ name: 'A', speed: 1000 }] };
  const r = createRunner({ id: 't', title: 't', steps: [step] }, env);
  env.pos = () => ({ x: 500, z: 0 });
  for (let i = 0; i < 5; i++) r.update(1);
  assert.equal(r.status, 'failed');
  assert.match(r.failReason, /première place/);
});

test('missions secondaires : construites, types connus, textes présents, terminables', async () => {
  const { SIDE_MISSIONS, buildSideMission } = await import('../client/src/gameplay/sidemissions.js');
  assert.equal(SIDE_MISSIONS.length, 3);
  let n = 0;
  const ctx = { me: { x: 0, z: 0 }, place: () => ({ x: 0, z: 0 }), pick: (a, lo) => ({ x: a.x + lo + (n++) * 10, z: a.z + 5 }), dist: (a, b) => Math.hypot(a.x - b.x, a.z - b.z), time: (m) => 25 + m / 12 };
  for (const { id } of SIDE_MISSIONS) {
    const def = buildSideMission(id, ctx);
    for (const s of def.steps) { assert.ok(STEP_TYPES[s.type], `${id} : ${s.type}`); assert.ok(s.text, `${id} : texte manquant`); }
    assert.ok(def.onPass().reward > 0);
    // joueur automate : se téléporte sur la cible (en voiture) jusqu'à la fin
    let pos = { x: 0, z: 0 };
    const env = { pos: () => pos, inVehicle: () => true, wanted: () => 0, setWanted() {}, place: () => ({ x: 0, z: 0 }), say() {}, notify() {}, spawnVehicle: () => ({ pos: () => pos }), route: () => null };
    const r = createRunner(def, env);
    for (let i = 0; i < 4000 && r.status === 'running'; i++) { if (r.target) pos = { ...r.target }; r.update(0.25); }
    assert.equal(r.status, 'passed', id);
  }
});

test('reroute : l\'adresse change quand on s\'approche, le singe fuit', () => {
  const env = { pos: () => ({ x: 0, z: 0 }), inVehicle: () => true, say() {}, notify() {}, spawnVehicle: () => ({}) };
  const r = createRunner({ id: 'x', steps: [{ type: 'reroute', text: 't', stops: [{ x: 10, z: 0 }, { x: 500, z: 0 }], switchDist: 60 }] }, env);
  assert.equal(r.target.x, 10);
  r.update(0.1);
  assert.equal(r.target.x, 500);
  const c = createRunner({ id: 'y', steps: [{ type: 'chase', text: 't', from: { x: 0, z: 0 }, to: { x: 100, z: 0 }, speed: 10, radius: 5 }] }, { ...env, pos: () => ({ x: 500, z: 500 }) });
  c.update(2); assert.ok(c.target.x > 15 && c.status === 'running');
});

test('chase : rattrapé après 2 s à moins de 6 m, ou en percutant', () => {
  const mk = (me, spd = 0) => createRunner({ id: 'c', steps: [{ type: 'chase', text: 't', from: { x: 0, z: 0 }, to: { x: 100, z: 0 }, speed: 10, radius: 6, hold: 2, spawn: { type: 'police' } }] },
    { pos: () => me, inVehicle: () => true, speed: () => spd, say() {}, notify() {}, spawnVehicle: () => ({ vehicle: {} }), driveVehicle: () => 50, vehiclePos: () => ({ x: 0, z: 0 }), releaseVehicle() {} });
  const a = mk({ x: 4, z: 0 }); a.update(1); assert.equal(a.status, 'running'); a.update(1.2); assert.equal(a.status, 'passed');
  const b = mk({ x: 20, z: 0 }); for (let i = 0; i < 50; i++) b.update(0.1); assert.equal(b.status, 'running');
  const c = mk({ x: 2, z: 0 }, 12); c.update(0.1); assert.equal(c.status, 'passed');
});
