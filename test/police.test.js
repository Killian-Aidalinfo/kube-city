// Tests de la logique pure de la police : chaleur, étoiles, recherche, témoins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heatFromCrime, levelFromHeat, heatForLevel, newSearch, stepSearch, isWitnessed, SEARCH_TIME } from '../client/src/police/logic.js';

test('chaleur → étoiles monotone', () => {
  assert.equal(levelFromHeat(0), 0);
  assert.equal(levelFromHeat(heatFromCrime('carjack')), 1);
  assert.ok(levelFromHeat(heatFromCrime('shootCop')) >= 3);
  for (let l = 1; l <= 5; l++) assert.equal(levelFromHeat(heatForLevel(l)), l);
  assert.ok(heatFromCrime('assault', 99) <= heatFromCrime('assault', 3));
});

test('témoins : un crime non vu n’est pas signalé', () => {
  assert.equal(isWitnessed({ kind: 'assault' }, 200), false);
  assert.equal(isWitnessed({ kind: 'assault' }, 20), true);
  assert.equal(isWitnessed({ kind: 'assault', witnessed: true }, 500), true);
});

test('recherche : vu → poursuite, perdu → zone puis perte des étoiles', () => {
  const s = newSearch(), pos = { x: 0, z: 0 };
  assert.equal(stepSearch(s, { dt: 0.1, seen: true, pos, level: 2 }), 'hunting');
  assert.equal(s.timer, SEARCH_TIME[2]);
  let r = 'hunting';
  for (let i = 0; i < 50; i++) r = stepSearch(s, { dt: 0.1, seen: false, pos, level: 2 });
  assert.equal(r, 'searching');
  assert.ok(s.zone && s.zone.radius > 0);
  // sortir du cercle accélère
  const inside = s.timer;
  stepSearch(s, { dt: 1, seen: false, pos: { x: 9999, z: 0 }, level: 2 });
  assert.ok(inside - s.timer > 1.5);
  let lost = false;
  for (let i = 0; i < 100 && !lost; i++) lost = stepSearch(s, { dt: 1, seen: false, pos, level: 2 }) === 'lost';
  assert.ok(lost);
  // revu : la zone disparaît
  stepSearch(s, { dt: 0.1, seen: true, pos, level: 2 });
  assert.equal(s.zone, null);
});
