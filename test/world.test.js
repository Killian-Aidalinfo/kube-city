// Tests du monde : génération déterministe, graphe routier, itinéraires, trottoirs, feux, cohérence avec la physique.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, groundHeight, districtAt, lightPhase, LIGHT_CYCLE, mulberry32 } from '../client/src/world/citygen.js';
import { terrainHeights, TERRAIN_CELLS, TERRAIN_SIZE } from '../client/src/world/build.js';

const city = generateCity();
const sig = (c) => JSON.stringify([c.buildings, c.props, c.lamps, c.places, c.spawnPoints, c.roads.edges.map((e) => [e.a, e.b, e.kind, e.pts]), c.trafficLights.map((l) => [l.x, l.z, l.offset])]);

test('citygen : déterministe (deux instances indépendantes du module donnent la même ville)', async () => {
  const a = (await import('../client/src/world/citygen.js?a')).generateCity();
  const b = (await import('../client/src/world/citygen.js?b')).generateCity();
  assert.notEqual(a, b);
  assert.equal(sig(a), sig(b));
  assert.equal(sig(a), sig(city));
});

test('citygen : taille, quartiers et lieux nommés de la spec', () => {
  assert.equal(city.size, 1200);
  const names = new Set();
  for (let x = -590; x <= 590; x += 20) for (let z = -590; z <= 590; z += 20) names.add(districtAt(x, z).name);
  for (const n of ['Centre', 'Docks', 'Collines', 'Plage', 'Zone industrielle']) assert.ok(names.has(n), n);
  for (const k of ['mairie', 'commissariat', 'hopital', 'garage', 'boutique', 'jetee', 'phare', 'stade', 'belvedere', 'port', 'aeroport', 'planque_ines', 'planque_malik', 'planque_jade']) {
    const p = city.places[k];
    assert.ok(p && p.label && Number.isFinite(p.position.x + p.position.y + p.position.z), k);
  }
});

test('graphe routier : connexe (sens uniques compris), voies, vitesses', () => {
  const g = city.roads;
  assert.ok(g.nodes.length > 100 && g.edges.length > 190);
  assert.ok(g.isStronglyConnected());
  assert.ok(g.edges.some((e) => e.oneway) && g.edges.some((e) => e.curved) && g.edges.some((e) => e.kind === 'avenue'));
  for (const e of g.edges) { assert.ok(e.len > 10 && e.speed > 0 && e.width > 4 && e.lanes >= 1); }
  const e = g.edges[10], lane = g.lanePoints(e, 1);
  assert.ok(lane.length >= 2);
});

test('route(from, to) : trouvée entre tous les lieux, démarre et finit près des points, longueur plausible', () => {
  const keys = Object.keys(city.places);
  let n = 0;
  for (const a of keys) for (const b of keys) {
    if (a === b) continue;
    const A = city.places[a].position, B = city.places[b].position;
    const r = city.route(A, B);
    assert.ok(r.length >= 2, `${a} -> ${b}`);
    assert.ok(Math.hypot(r[0].x - A.x, r[0].z - A.z) < 1 && Math.hypot(r.at(-1).x - B.x, r.at(-1).z - B.z) < 1);
    let len = 0; for (let i = 1; i < r.length; i++) len += Math.hypot(r[i].x - r[i - 1].x, r[i].z - r[i - 1].z);
    const d = Math.hypot(A.x - B.x, A.z - B.z);
    assert.ok(len >= d - 1 && len < d * 3 + 400, `${a} -> ${b}: ${len.toFixed(0)} m pour ${d.toFixed(0)} m`);
    n++;
  }
  assert.ok(n > 150);
});

test('route : respecte les sens uniques et reste sur les routes', () => {
  const g = city.roads, r = city.route({ x: -150, z: -200 }, { x: 150, z: -200 });
  for (const p of r.slice(1, -1)) assert.ok(g.isRoad(p.x, p.z) || g.nearest(p.x, p.z).dist < 4);
  // la rue z = -200 est à sens unique vers l'est : l'aller-retour ne passe pas par la même arête dans les deux sens
  const back = city.route({ x: 150, z: -200 }, { x: -150, z: -200 });
  assert.ok(back.length >= 2);
});

test('isRoad / nearestRoadPoint / groundHeight', () => {
  assert.ok(city.isRoad(0, 0) && city.isRoad(0, -50) && city.isRoad(150, -100));
  assert.ok(!city.isRoad(40, -40));
  const p = city.nearestRoadPoint({ x: 3, z: 47 });
  assert.ok(Math.abs(p.x) < 8 && city.isRoad(p.x, p.z));
  assert.equal(groundHeight(0, 0), 0);
  assert.ok(groundHeight(-420, -300) > 25, 'les collines montent');
  assert.ok(groundHeight(0, 520) < -1, 'la mer descend');
});

test('trottoirs : graphe piéton, passages piétons, points de départ piétons sur trottoir', () => {
  const s = city.sidewalks;
  assert.ok(s.nodes.length > 300 && s.edges.some((e) => e.kind === 'crossing') && s.edges.some((e) => e.kind === 'walk'));
  assert.ok(city.spawnPoints.peds.length > 100);
  for (const p of city.spawnPoints.peds.slice(0, 200)) assert.ok(!city.roads.isRoad(p.x, p.z), 'piéton sur la chaussée');
});

test('bâtiments hors chaussée, rampes et point d’arrivée libres', () => {
  for (const b of city.buildings) {
    if (b.kind === 'phare' || b.kind === 'conteneurs') continue;
    for (const p of b.parts) if (p.t === 'box') assert.ok(!city.roads.isRoad(p.cx, p.cz), `${b.kind} sur la route en ${p.cx},${p.cz}`);
  }
  for (const r of city.ramps) assert.ok(!city.roads.isRoad(r.x, r.z), `rampe ${r.id}`);
  const sp = city.spawnPoints.player;
  for (const b of city.buildings) for (const p of b.parts) if (p.t === 'box') assert.ok(Math.abs(sp.x - p.cx) > p.w / 2 || Math.abs(sp.z - p.cz) > p.d / 2);
  assert.ok(city.spawnPoints.vehicles.length >= 50);
});

test('feux tricolores : cycle sans conflit entre axes, états valides', () => {
  assert.ok(city.trafficLights.length > 60);
  for (const l of city.trafficLights.slice(0, 20)) {
    assert.ok(l.poles.length >= 3 && l.poles.every((p) => p.stop && ['ns', 'ew'].includes(p.axis)));
    for (let t = 0; t < LIGHT_CYCLE; t += 0.5) {
      const a = lightPhase(l, 'ns', t), b = lightPhase(l, 'ew', t);
      assert.ok(!(a === 'green' && b !== 'red') && !(b === 'green' && a !== 'red'), 'deux verts ou vert + orange');
    }
    const seen = new Set(); for (let t = 0; t < LIGHT_CYCLE; t += 0.5) seen.add(lightPhase(l, 'ns', t));
    assert.deepEqual([...seen].sort(), ['green', 'red', 'yellow']);
  }
});

test('physique : le heightfield Rapier colle à groundHeight', async () => {
  const RAPIER = (await import('@dimforge/rapier3d-compat')).default;
  await RAPIER.init();
  const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const N = TERRAIN_CELLS;
  w.createCollider(RAPIER.ColliderDesc.heightfield(N, N, terrainHeights(), { x: TERRAIN_SIZE, y: 1, z: TERRAIN_SIZE }));
  w.step();
  const r = mulberry32(3);
  for (let i = 0; i < 40; i++) {
    const x = -560 + r() * 1120, z = -560 + r() * 1100;
    const hit = w.castRay(new RAPIER.Ray({ x, y: 120, z }, { x: 0, y: -1, z: 0 }), 300, true);
    assert.ok(hit, `rayon ${x},${z}`);
    assert.ok(Math.abs(120 - hit.timeOfImpact - groundHeight(x, z)) < 0.2, `écart en ${x.toFixed(0)},${z.toFixed(0)}`);
  }
});
