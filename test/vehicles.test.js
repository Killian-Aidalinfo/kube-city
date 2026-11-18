// Tests des véhicules : réglages purs + simulation Rapier sous node (sol plat).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { TYPES, specFor, steerLimit, engineForce, collisionDamage, damageLevel, rpmFor } from '../client/src/vehicles/tuning.js';
import { buildGeometry, createPhysicsVehicle, driveStep, flipUpright } from '../client/src/vehicles/drive.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../client/public/assets/manifest.json', import.meta.url)));

test('chaque type a un modèle du manifest et des réglages cohérents', () => {
  for (const id of Object.keys(TYPES)) {
    const s = specFor(id);
    assert.ok(manifest.vehicles.models[s.model], 'modèle manquant : ' + id);
    assert.ok(s.mass > (s.twoWheel ? 150 : 500) && s.top > 80 && s.accel > 2 && s.seats >= (s.twoWheel ? 1 : 2), id);
  }
  assert.equal(specFor('berline').id, 'sedan');            // alias de catégorie
  assert.equal(specFor('inconnu'), null);
  assert.ok(specFor('police').siren && specFor('ambulance').siren && !specFor('sedan').siren);
  assert.ok(specFor('race-future').top > specFor('sedan').top);
});

test('braquage : diminue avec la vitesse ; moteur : coupé à la vitesse max', () => {
  assert.ok(steerLimit(0.6, 0) > steerLimit(0.6, 20));
  assert.ok(steerLimit(0.6, 60) > 0.1);
  const s = specFor('sedan');
  assert.ok(engineForce(s, 1, 0) > engineForce(s, 1, 30));
  assert.equal(engineForce(s, 1, s.top / 3.6 + 1), 0);
  assert.ok(engineForce(s, -1, 0) < 0 && Math.abs(engineForce(s, -1, 0)) < engineForce(s, 1, 0));
});

test('dégâts : seuil, plafond, état fumée/feu/épave', () => {
  assert.equal(collisionDamage(2, 1300), 0);
  assert.ok(collisionDamage(10, 1300) > 0);
  assert.ok(collisionDamage(100, 1300) <= 60);
  assert.ok(collisionDamage(10, 1300, 300) < collisionDamage(10, 1300, 5000));
  assert.deepEqual([100, 29, 9, 0].map(damageLevel), ['ok', 'smoke', 'fire', 'wreck']);
  assert.ok(rpmFor(0, 150, 0) < rpmFor(20, 150, 1) && rpmFor(60, 150, 1) <= 1);
});

// ---- physique Rapier ----
await RAPIER.init();
function monde(type = 'sedan') {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); world.timestep = 1 / 60;
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.5, 0));
  const spec = specFor(type), geom = buildGeometry(manifest.vehicles.models[spec.model]);
  const pv = createPhysicsVehicle(RAPIER, world, spec, geom, { x: 0, y: 0.3, z: 0 }, 0);
  const run = (n, c) => { for (let i = 0; i < n; i++) { driveStep(pv, c, 1 / 60); world.step(); } };
  return { world, pv, run };
}

test('physique : le véhicule se pose sur ses roues et reste stable', () => {
  const { pv, run } = monde();
  run(120, {});
  const y = pv.body.translation().y;
  assert.ok(y > 0.4 && y < 0.7, 'hauteur au repos ' + y);
  assert.ok(pv.out.up > 0.99);
});

test('physique : accélère vers +Z, braque à droite vers −X, freine', () => {
  const { pv, run } = monde();
  run(90, {});
  run(180, { throttle: 1 });
  assert.ok(pv.body.translation().z > 20 && pv.out.kmh > 60, 'kmh ' + pv.out.kmh);
  const x0 = pv.body.translation().x;
  run(60, { throttle: 0.6, steer: 1 });
  assert.ok(pv.body.translation().x < x0 - 3, 'braquage droite');
  run(120, { brake: 1 });
  assert.ok(pv.out.kmh < 3, 'arrêt ' + pv.out.kmh);
});

test('physique : le frein à main fait déraper (glissement latéral)', () => {
  const lat = (hb) => {
    const { pv, run } = monde(); run(60, {}); run(200, { throttle: 1 });
    let m = 0;
    for (let i = 0; i < 70; i++) { run(1, { throttle: 0.4, steer: 0.8, handbrake: hb }); m = Math.max(m, Math.abs(pv.out.lateral)); }
    return m;
  };
  assert.ok(lat(true) > lat(false) * 1.4, 'dérapage');
});

test('physique : retourné, le véhicule est détecté puis remis sur roues', () => {
  const { pv, run, world } = monde();
  run(60, {});
  pv.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true); // sur le toit
  pv.body.setTranslation({ x: 0, y: 2, z: 0 }, true);
  run(240, {});
  assert.ok(pv.out.up < 0.3 && pv.flipT > 1, 'retourné ' + pv.out.up + ' ' + pv.flipT);
  flipUpright(pv); run(120, {});
  assert.ok(pv.out.up > 0.95, 'remis droit');
  assert.ok(world.bodies.len() >= 1);
});

test('physique : tous les modèles tiennent la route à pleine vitesse sans se retourner', () => {
  for (const id of Object.keys(TYPES)) {
    const { pv, run } = monde(id); run(60, {});
    let minUp = 1;
    for (let i = 0; i < 360; i++) { run(1, { throttle: 1, steer: i > 200 ? 1 : 0 }); minUp = Math.min(minUp, pv.out.up); }
    assert.ok(minUp > 0.6, id + ' minUp ' + minUp);
  }
});
