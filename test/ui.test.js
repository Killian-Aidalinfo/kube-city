// Tests des calculs purs de l'interface : projection de la minimap, graphe routier, formats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldToMap, clampToCircle, extractSegments, routeLength, formatMoney, formatClock, formatDistance, normDir, frac, TIPS } from '../client/src/ui/mapmath.js';

test('minimap : « devant » la caméra est en haut, la droite est à droite', () => {
  const f = normDir(0, -1); // la caméra regarde vers -Z
  const ahead = worldToMap(0, -10, 0, 0, f.fx, f.fz, 2);
  assert.ok(Math.abs(ahead.x) < 1e-9 && ahead.y === -20);
  const right = worldToMap(10, 0, 0, 0, f.fx, f.fz, 2);
  assert.ok(right.x === 20 && Math.abs(right.y) < 1e-9);
  // caméra tournée vers +X : un point en +X est devant (en haut)
  const g = normDir(1, 0);
  assert.equal(worldToMap(10, 0, 0, 0, g.fx, g.fz, 1).y, -10);
  assert.deepEqual(normDir(0, 0), { fx: 0, fz: -1 });
});

test('blips hors du disque ramenés sur le bord', () => {
  const k = clampToCircle(300, 400, 50);
  assert.equal(k.clamped, true);
  assert.ok(Math.abs(Math.hypot(k.x, k.y) - 50) < 1e-9);
  assert.equal(clampToCircle(3, 4, 50).clamped, false);
});

test('extraction des routes : formes de graphes variées', () => {
  const a = extractSegments({ nodes: [{ x: 0, z: 0 }, { x: 10, z: 0 }], edges: [{ a: 0, b: 1 }] });
  assert.deepEqual(a, [[0, 0, 10, 0]]);
  const b = extractSegments({ nodes: new Map([['n1', { id: 'n1', position: { x: 1, z: 2 } }], ['n2', { id: 'n2', position: { x: 3, z: 4 } }]]), edges: [{ from: 'n1', to: 'n2' }] });
  assert.deepEqual(b, [[1, 2, 3, 4]]);
  const c = extractSegments({ nodes: [], edges: [{ points: [{ x: 0, z: 0 }, { x: 1, z: 1 }, { x: 2, z: 1 }] }] });
  assert.equal(c.length, 2);
  assert.deepEqual(extractSegments(null), []);
  assert.deepEqual(extractSegments({ nodes: [], edges: [{ a: 5, b: 6 }] }), []);
});

test('formats en français', () => {
  assert.equal(formatMoney(1234567), '1 234 567 €');
  assert.equal(formatClock(7.5), '07:30');
  assert.equal(formatClock(23.99), '23:59');
  assert.equal(formatDistance(85), '85 m');
  assert.equal(formatDistance(1250), '1,3 km');
  assert.equal(routeLength([{ x: 0, z: 0 }, { x: 3, z: 4 }]), 5);
  assert.equal(frac(150, 100), 1); assert.equal(frac(-5, 100), 0);
  assert.ok(TIPS.length >= 8 && TIPS.every((t) => t.length > 20));
});

test('astuces : identifiants uniques, textes en français, déclencheurs cohérents', async () => {
  const { TIP_LIST } = await import('../client/src/ui/onboarding.js');
  const ids = TIP_LIST.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const t of TIP_LIST) { assert.ok(t.text.length > 10); assert.ok(t.after != null || t.when, t.id); }
  assert.ok(TIP_LIST.find((t) => t.id === 'car').text.includes('F'));
});
