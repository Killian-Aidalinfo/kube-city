// Tests de la logique pure du combat : combo, dégâts, régénération, balistique, roue, cône d'attaque.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comboNext, COMBO, splitDamage, regen, stepBallistic, wheelSector, inCone, distToSegment, WEAPONS, REGEN_CAP } from '../client/src/combat/logic.js';

test('combo : enchaîne dans la fenêtre, repart à zéro sinon', () => {
  let r = comboNext({ index: -1, last: -99 }, 0);
  assert.equal(r.state.index, 0);
  r = comboNext(r.state, 0.4); assert.equal(r.state.index, 1);
  r = comboNext(r.state, 0.8); assert.equal(COMBO[r.state.index].kind, 'kick');
  r = comboNext(r.state, 5); assert.equal(r.state.index, 0);
});

test('armure absorbe 70 %, la santé ne passe pas sous 0', () => {
  const r = splitDamage(100, 50, 20);
  assert.equal(r.armor, 36); assert.equal(r.health, 94);
  assert.equal(splitDamage(10, 0, 50).health, 0);
});

test('régénération : après un délai, jusqu’à 50 % seulement', () => {
  assert.equal(regen(30, 1, 1), 30);
  assert.ok(regen(30, 1, 10) > 30);
  assert.equal(regen(49.9, 5, 10), REGEN_CAP);
  assert.equal(regen(80, 1, 10), 80);
  assert.equal(regen(0, 1, 10), 0);
});

test('balistique : le projectile retombe', () => {
  const p = { x: 0, y: 1.5, z: 0 }, v = { x: 0, y: 0, z: 40 };
  for (let i = 0; i < 60; i++) stepBallistic(p, v, 1 / 60);
  assert.ok(p.z > 30 && p.y < 1.5);
});

test('roue d’armes : secteurs et zone morte', () => {
  assert.equal(wheelSector(0.1, 0.1), -1);
  assert.equal(wheelSector(0, -1), 0);
  assert.equal(wheelSector(1, 0), 1);
  assert.equal(wheelSector(0, 1), 2);
  assert.equal(wheelSector(-1, 0), 3);
});

test('cône d’attaque et distance segment', () => {
  assert.ok(inCone({ x: 0, z: 0 }, { x: 0, z: 1 }, { x: 0, z: 1.2 }, 1.7));
  assert.ok(!inCone({ x: 0, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1.2 }, 1.7));
  assert.ok(distToSegment({ x: 1, y: 0, z: 5 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }).d === 1);
  assert.ok(Object.values(WEAPONS).every((w) => w.damage >= 0), 'armes non létales');
});
