// Tests du module PNJ : densités, feux, suivi de voie, graphe, et une simulation complète sans navigateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { pedTarget, carTarget, followSpeed, stopSpeed, lightState, makeRng } from '../client/src/npc/logic.js';
import { normalizeGraph, nextArc } from '../client/src/npc/graph.js';
import { LanePath, steerTo, speedCommand, PolyPath } from '../client/src/npc/driver.js';
import { Bus } from '../client/src/core/bus.js';
import { install as installNpc } from '../client/src/npc/index.js';
import { install as installPolice } from '../client/src/police/index.js';
import { install as installCombat } from '../client/src/combat/index.js';

test('densité piétonne : nuit et quartier calme moins peuplés', () => {
  const jour = pedTarget({ quality: 'medium', district: 'Centre', hour: 14 });
  assert.ok(jour > pedTarget({ quality: 'medium', district: 'Centre', hour: 3 }));
  assert.ok(jour > pedTarget({ quality: 'medium', district: 'Zone industrielle', hour: 14 }));
  assert.ok(pedTarget({ quality: 'high', district: 'Centre', hour: 14 }) > jour);
  assert.equal(pedTarget({ density: 0, district: 'Centre', hour: 14 }), 0);
  assert.ok(carTarget({ quality: 'low' }) < carTarget({ quality: 'high' }));
});

test('suivi de véhicule et arrêt aux feux', () => {
  assert.equal(followSpeed(2, 5, 14), 0);
  assert.ok(followSpeed(40, 5, 14) <= 14);
  assert.ok(stopSpeed(20) > stopSpeed(5));
  const feu = { state: 'green', axis: 'ns' };
  assert.equal(lightState(feu, 0, 1), 'green');
  assert.equal(lightState(feu, 1, 0), 'red');
  assert.equal(lightState({ state: { ns: 'red', ew: 'green' } }, 0, 1), 'red');
  assert.equal(lightState({ canGo: () => false }, 1, 0), 'red');
  assert.equal(lightState(null, 1, 0), 'green');
});

test('graphe : formes tolérantes, sens uniques, pas de demi-tour', () => {
  const g = normalizeGraph({ nodes: [{ x: 0, z: 0 }, { position: { x: 100, z: 0 } }, [100, 0, 100]], edges: [{ a: 0, b: 1 }, { from: 1, to: 2, oneWay: true }] });
  assert.equal(g.arcs.length, 3);
  const a01 = g.arcs.find((a) => a.a === 0 && a.b === 1);
  assert.equal(nextArc(g, a01, makeRng(1)).b, 2);
});

test('direction et vitesse', () => {
  assert.ok(steerTo(0, 1, -1, 1) > 0, 'cible à droite (−X quand on regarde +Z)');
  assert.ok(steerTo(0, 1, 1, 1) < 0);
  assert.ok(Math.abs(steerTo(0, 1, 0, 5)) < 1e-9);
  assert.equal(speedCommand(0, 10).brake, 0);
  assert.ok(speedCommand(20, 5).brake > 0);
});

test('LanePath avance de voie en voie et PolyPath suit la polyligne', () => {
  const g = normalizeGraph({ nodes: [{ x: 0, z: 0 }, { x: 0, z: 50 }, { x: 50, z: 50 }], edges: [[0, 1], [1, 2]] });
  const lp = new LanePath(g, g.arcs.find((a) => a.a === 0 && a.b === 1), makeRng(3), 2);
  lp.update({ x: -2, z: 49 });
  assert.equal(lp.arc.b, 2, 'passe à la voie suivante au carrefour');
  assert.ok(lp.target(10));
  const pp = new PolyPath([{ x: 0, z: 0 }, { x: 0, z: 20 }, { x: 20, z: 20 }]);
  pp.update({ x: 0, z: 19.5 });
  assert.equal(pp.i, 1);
});

/** Faux contexte de jeu : suffit pour exécuter PNJ + police + combat sans navigateur ni Rapier. */
function fakeGame() {
  const bus = new Bus(), subs = [];
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 3, -5);
  const player = { object3d: new THREE.Object3D(), position: new THREE.Vector3(0, 0, 0), velocity: new THREE.Vector3(), state: 'onFoot', health: 100, armor: 0, vehicle: null, applyDamage() {}, teleport(p) { this.position.set(p.x, p.y, p.z); } };
  const vehicles = { list: [], spawn(type, p, yaw) {
    const v = { type, owner: 'npc', speed: 0, object3d: new THREE.Object3D(), siren: false, controls: null, setControls(c) { this.controls = c; } };
    v.object3d.position.set(p.x, p.y, p.z); this.list.push(v); return v; } };
  const roads = { nodes: [], edges: [] };
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) roads.nodes.push({ x: i * 80 - 160, z: j * 80 - 160 });
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) { if (i < 4) roads.edges.push({ a: i * 5 + j, b: (i + 1) * 5 + j }); if (j < 4) roads.edges.push({ a: i * 5 + j, b: i * 5 + j + 1 }); }
  const game = {
    bus, state: 'playing', time: { dt: 0.016, elapsed: 0, now: 0, dayTime: 12, scale: 1 },
    settings: { get: (k) => ({ quality: 'medium', pedDensity: 1 })[k] },
    input: { isDown: () => false, pressed: () => false, axis: () => 0, pointerLocked: false },
    assets: { manifest: null, loadGLTF: async () => { throw new Error('absent'); } },
    three: { scene: new THREE.Scene(), camera },
    physics: { world: { castRayAndGetNormal: () => null }, RAPIER: { Ray: class { constructor(o, d) { this.o = o; this.d = d; } } } },
    world: { roads, sidewalks: roads, trafficLights: [], groundHeight: () => 0, isRoad: () => false, district: () => ({ name: 'Centre' }), route: (a, b) => [a, b] },
    player, vehicles,
    onUpdate(fn, order = 0) { subs.push({ fn, order }); subs.sort((a, b) => a.order - b.order); },
    step(dt) { game.time.elapsed += dt; for (const s of subs) s.fn(dt); },
  };
  return game;
}

test('simulation : PNJ, police et combat tournent sans erreur et réagissent aux crimes', async () => {
  const game = fakeGame();
  installNpc(game); installPolice(game); installCombat(game);
  const events = [];
  game.bus.on('wanted:changed', (e) => events.push(e));
  await new Promise((r) => setTimeout(r, 20)); // chargement du kit (échoue → repli procédural)
  for (let i = 0; i < 600; i++) game.step(0.05);
  assert.ok(game.npc.peds.length > 0, 'des piétons sont créés');
  assert.ok(game.npc.peds.some((p) => p.active));
  assert.ok(game.vehicles.list.length >= 2, 'circulation et patrouilles');
  // crime vu par la police ambiante ou un témoin : monte en niveau
  game.police.report('shootCop', 1);
  assert.ok(game.police.level >= 3);
  assert.equal(events.at(-1).level, game.police.level);
  for (let i = 0; i < 200; i++) game.step(0.05);
  assert.ok(game.police.units.length > 0, 'unités déployées');
  assert.ok(game.police.units.every((u) => u.veh.controls), 'les voitures de police sont pilotées');
  game.police.clear();
  assert.equal(game.police.level, 0);
  // dégâts : l'armure absorbe, K.O. à 0
  const kos = []; game.bus.on('player:ko', (e) => kos.push(e));
  game.combat.giveArmor(50);
  game.combat.damagePlayer(30, 'test');
  assert.ok(game.player.armor < 50 && game.player.health > 70);
  game.player.applyDamage(500, 'chute');
  assert.equal(kos.length, 1);
});

test('feux : forme du monde tl.state(axis) lue par les conducteurs PNJ', async () => {
  const { lightState } = await import('../client/src/npc/logic.js');
  const tl = { x: 0, z: 0, state: (axis) => (axis === 'ns' ? 'red' : 'green') };
  assert.equal(lightState(tl, 0, 1), 'red');   // roule selon z → axe ns
  assert.equal(lightState(tl, 1, 0), 'green'); // roule selon x → axe ew
});
