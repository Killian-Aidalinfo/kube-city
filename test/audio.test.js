// Tests de la logique pure de l'audio : modèle de moteur et composition des stations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineParams, categoryOf, CATEGORIES, skidAmount } from '../client/src/audio/engine.js';
import { STATIONS, buildBar, midiToHz, mulberry32 } from '../client/src/audio/radio.js';

test('categoryOf reconnaît les types de véhicules', () => {
  assert.equal(categoryOf('police'), 'police');
  assert.equal(categoryOf('taxi'), 'taxi');
  assert.equal(categoryOf('sedan-sports'), 'sport');
  assert.equal(categoryOf('delivery'), 'pickup');
  assert.equal(categoryOf('inconnu'), 'berline');
  for (const c of Object.keys(CATEGORIES)) assert.ok(engineParams(c, 50, 1).freq > 20);
});

test('le régime monte avec la vitesse dans un rapport et retombe au changement de rapport', () => {
  const a = engineParams('berline', 10, 1), b = engineParams('berline', 25, 1);
  assert.equal(a.gear, 1);
  assert.ok(b.rpm > a.rpm || b.gear > a.gear);
  const idle = engineParams('berline', 0, 0);
  assert.ok(idle.rpm < a.rpm);
  assert.ok(engineParams('muscle', 40, 1).freq < engineParams('moto', 40, 1).freq, 'une moto est plus aigüe qu\'un V8');
  // jamais au-delà du régime max
  for (let v = 0; v < 400; v += 7) assert.ok(engineParams('sport', v, 1).rpm <= CATEGORIES.sport.max + 1);
});

test('crissement de pneus', () => {
  assert.equal(skidAmount({ speed: 10, handbrake: true }), 0);
  assert.ok(skidAmount({ speed: 80, handbrake: true }) > 0.5);
  assert.equal(skidAmount({ slip: 3 }), 1);
});

test('5 stations, mesures déterministes et notes valides', () => {
  assert.equal(STATIONS.length, 5);
  assert.equal(new Set(STATIONS.map((s) => s.name)).size, 5);
  for (const st of STATIONS) {
    const bar = buildBar(st, 3, 42);
    assert.ok(bar.length > 4, st.name);
    assert.deepEqual(bar, buildBar(st, 3, 42));
    for (const e of bar) {
      assert.ok(e.t >= 0 && e.t < 16);
      if (e.midi !== undefined) assert.ok(e.midi >= 20 && e.midi <= 110, `${st.name} ${e.kind} ${e.midi}`);
    }
  }
  assert.ok(Math.abs(midiToHz(69) - 440) < 1e-9);
  const r = mulberry32(5); assert.notEqual(r(), r());
});
