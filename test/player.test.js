// Tests de la logique pure du joueur (client/src/player/logic.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAYER, angleDiff, damp, dampAngle, approach, updateStamina, fallDamage, targetSpeed,
  locomotionKey, locomotionTimeScale, orbitDirection, cameraHitDistance,
} from '../client/src/player/logic.js';

test('angleDiff : plus court chemin, borné à ±π', () => {
  assert.ok(Math.abs(angleDiff(0, Math.PI * 1.5) + Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(angleDiff(3, -3) - (2 * Math.PI - 6)) < 1e-9);
  assert.equal(angleDiff(1, 1), 0);
});

test('damp / dampAngle : convergent sans dépasser, indépendants du pas', () => {
  let a = 0; for (let i = 0; i < 60; i++) a = damp(a, 10, 8, 1 / 60);
  let b = 0; for (let i = 0; i < 30; i++) b = damp(b, 10, 8, 1 / 30);
  assert.ok(a < 10 && a > 9.9);
  assert.ok(Math.abs(a - b) < 1e-9);
  const t = dampAngle(3.0, -3.0, 10, 0.05); // passe par π, pas par 0
  assert.ok(t > 3.0);
  assert.equal(approach(0, 5, 2), 2);
  assert.equal(approach(5, 0, 9), 0);
});

test('endurance : le sprint la vide, elle remonte après un délai, épuisement jusqu’à 20', () => {
  const s = { stamina: 100, delay: 0, exhausted: false };
  let n = 0;
  while (!s.exhausted && n++ < 1000) updateStamina(s, 1 / 60, { sprinting: true });
  assert.ok(n > 300 && n < 400, 'durée de sprint ' + n / 60); // ~5,5 s
  assert.equal(s.stamina, 0); assert.ok(s.exhausted);
  // au repos : d'abord le délai, puis la récupération ; le sprint reste coupé sous 20
  for (let i = 0; i < 30; i++) updateStamina(s, 1 / 60, {});
  assert.equal(s.stamina, 0);
  for (let i = 0; i < 60; i++) updateStamina(s, 1 / 60, {});
  assert.ok(s.stamina > 5 && s.exhausted);
  for (let i = 0; i < 600; i++) updateStamina(s, 1 / 60, {});
  assert.ok(!s.exhausted && s.stamina <= PLAYER.staminaMax);
  updateStamina(s, 1, { swimming: true });
  assert.ok(s.stamina < PLAYER.staminaMax);
});

test('dégâts de chute : aucun jusqu’à 6 m, croissants au-delà', () => {
  assert.equal(fallDamage(0), 0);
  assert.equal(fallDamage(6), 0);
  assert.ok(fallDamage(7) > 0);
  assert.ok(fallDamage(12) > fallDamage(8));
});

test('vitesse cible : marche, course, sprint, épuisement, nage', () => {
  assert.equal(targetSpeed({ magnitude: 0 }), 0);
  assert.ok(targetSpeed({ magnitude: 0.3 }) < PLAYER.walk + 1e-9);
  assert.equal(targetSpeed({ magnitude: 1 }), PLAYER.run);
  assert.equal(targetSpeed({ magnitude: 1, sprint: true }), PLAYER.sprint);
  assert.equal(targetSpeed({ magnitude: 1, sprint: true, exhausted: true }), PLAYER.run);
  assert.equal(targetSpeed({ magnitude: 1, swimming: true }), PLAYER.swim);
});

test('animation de déplacement selon la vitesse', () => {
  assert.equal(locomotionKey(0), 'idle');
  assert.equal(locomotionKey(1.5), 'walk');
  assert.equal(locomotionKey(4.8), 'run');
  assert.equal(locomotionKey(8), 'sprint');
  assert.ok(locomotionTimeScale('run', 4.6) === 1);
  assert.ok(locomotionTimeScale('run', 100) <= 1.5);
});

test('caméra : direction en orbite et collision', () => {
  const d = orbitDirection(0, 0);
  assert.ok(Math.abs(d.z - 1) < 1e-9 && Math.abs(d.x) < 1e-9);
  const dd = orbitDirection(0.7, 0.4);
  assert.ok(Math.abs(Math.hypot(dd.x, dd.y, dd.z) - 1) < 1e-9);
  assert.ok(dd.y < 0); // pitch > 0 : on regarde vers le bas
  assert.equal(cameraHitDistance(null, 4), 4);
  assert.equal(cameraHitDistance(10, 4), 4);
  assert.ok(Math.abs(cameraHitDistance(2, 4) - 1.75) < 1e-9);
  assert.equal(cameraHitDistance(0.1, 4), 0.5);
});
