// Logique pure du joueur (sans three ni Rapier) : lissages, endurance, chute, choix d'animation.
// Séparée de index.js pour pouvoir être testée avec node --test.

export const PLAYER = {
  radius: 0.35, height: 1.8,          // capsule du contrôleur
  walk: 1.9, run: 4.8, sprint: 9.2, swim: 2.6, // m/s
  accelGround: 38, accelAir: 9, decel: 46,
  jump: 6.6, gravity: 22, terminalFall: 45,
  fallSafe: 6,                         // m : au-delà, dégâts de chute
  staminaMax: 100, sprintDrain: 7.5, regen: 28, regenDelay: 0.6, swimDrain: 5, // sprint ≈ 13 s
  doubleTap: 0.3,                      // s : double appui sur Avancer = sprint
};

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
/** Lissage exponentiel indépendant du framerate. */
export const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
/** Plus petit écart signé entre deux angles (rad), dans [-π, π]. */
export function angleDiff(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export const dampAngle = (cur, target, rate, dt) => cur + angleDiff(cur, target) * (1 - Math.exp(-rate * dt));

/** Rapproche `cur` de `target` de `maxDelta` au plus. */
export function approach(cur, target, maxDelta) {
  return cur < target ? Math.min(target, cur + maxDelta) : Math.max(target, cur - maxDelta);
}

/**
 * Endurance : le sprint la vide, elle remonte après un court délai ; à zéro, le sprint est coupé
 * jusqu'à ce qu'elle remonte au-dessus de 20.
 * @param {{stamina:number, delay:number, exhausted:boolean}} s état muté et renvoyé
 */
export function updateStamina(s, dt, { sprinting = false, swimming = false } = {}) {
  const P = PLAYER;
  if (swimming) { s.stamina = Math.max(0, s.stamina - P.swimDrain * dt); s.delay = P.regenDelay; }
  else if (sprinting && !s.exhausted) { s.stamina = Math.max(0, s.stamina - P.sprintDrain * dt); s.delay = P.regenDelay; }
  else if (s.delay > 0) s.delay -= dt;
  else s.stamina = Math.min(P.staminaMax, s.stamina + P.regen * dt);
  if (s.stamina <= 0) s.exhausted = true;
  else if (s.exhausted && s.stamina > 20) s.exhausted = false;
  return s;
}

/** Dégâts de chute selon la hauteur (m) : 0 jusqu'à 6 m, puis croissants. */
export function fallDamage(drop) {
  if (drop <= PLAYER.fallSafe) return 0;
  return Math.round(10 + (drop - PLAYER.fallSafe) * 9);
}

/** Vitesse cible à pied selon l'intention (norme du stick 0..1), le sprint et l'endurance. */
export function targetSpeed({ magnitude, sprint, exhausted, swimming }) {
  if (magnitude < 0.05) return 0;
  if (swimming) return PLAYER.swim * Math.min(1, magnitude);
  if (magnitude < 0.55) return PLAYER.walk * (magnitude / 0.55);
  if (sprint && !exhausted) return PLAYER.sprint;
  return PLAYER.run;
}

/** Clé d'animation de déplacement selon la vitesse horizontale (m/s). */
export function locomotionKey(speed) {
  if (speed < 0.35) return 'idle';
  if (speed < 3.2) return 'walk';
  if (speed < 6.4) return 'run';
  return 'sprint';
}
/** Vitesse de lecture d'une animation de déplacement pour éviter le patinage. */
export function locomotionTimeScale(key, speed) {
  const ref = { walk: 1.75, run: 4.6, sprint: 8.8 }[key];
  return ref ? clamp(speed / ref, 0.6, 1.5) : 1;
}

/** Intensité visuelle du sprint (0..1) selon la vitesse horizontale : FOV, caméra basse, secousse. */
export function sprintFactor(speed) {
  return clamp((speed - PLAYER.run - 0.4) / (PLAYER.sprint - PLAYER.run - 0.4), 0, 1);
}

/** Position de la caméra en orbite : yaw = direction du regard (rad), pitch > 0 = regarde vers le bas. */
export function orbitDirection(yaw, pitch) {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c, y: -Math.sin(pitch), z: Math.cos(yaw) * c };
}

/** Distance caméra après collision : on se colle un peu avant l'obstacle (jamais sous `min`). */
export function cameraHitDistance(hitToi, desired, margin = 0.25, min = 0.5) {
  if (hitToi == null || hitToi >= desired) return desired;
  return Math.max(min, hitToi - margin);
}
