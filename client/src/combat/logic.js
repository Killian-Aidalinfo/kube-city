// Logique pure du combat (testable sans navigateur) : armes, combo, dégâts, régénération, balistique, roue.

/** Armes non létales. `cooldown` en secondes ; `range` en mètres. */
export const WEAPONS = {
  poings: { id: 'poings', label: 'Poings', cooldown: 0.32, range: 1.7, damage: 10, icon: '👊' },
  batte: { id: 'batte', label: 'Batte en mousse', cooldown: 0.65, range: 2.2, damage: 20, icon: '🏏' },
  taser: { id: 'taser', label: 'Taser', cooldown: 2.2, range: 11, damage: 0, icon: '⚡' },
  paintball: { id: 'paintball', label: 'Lanceur de paintball', cooldown: 0.22, range: 70, damage: 0, icon: '🎨', ammo: 60 },
};
export const WEAPON_ORDER = ['poings', 'batte', 'taser', 'paintball'];
export const PAINT_COLORS = ['#ff3399', '#33ccff', '#ffd633', '#66ff66', '#b266ff', '#ff7a33'];
export const MAX_HEALTH = 100;
export const REGEN_CAP = 50;       // la santé se régénère jusqu'à 50 %
export const REGEN_DELAY = 5;      // s sans dégât avant la régénération
export const COMBO_WINDOW = 0.75;

/** Enchaînement des poings : direct, crochet, puis coup de pied (plus fort). */
export const COMBO = [
  { kind: 'punch', clip: 'Punch_Jab', mult: 1, push: 0.3 },
  { kind: 'punch', clip: 'Punch_Cross', mult: 1.2, push: 0.4 },
  { kind: 'kick', clip: 'Punch_Cross', mult: 1.8, push: 1.2 },
];

/** Étape suivante du combo : renvoie { step, state }. `state` = { index, last }. */
export function comboNext(state, now) {
  const index = now - state.last <= COMBO_WINDOW ? (state.index + 1) % COMBO.length : 0;
  return { step: COMBO[index], state: { index, last: now } };
}

/** Répartit un dégât entre armure (70 % absorbés tant qu'il en reste) et santé. */
export function splitDamage(health, armor, amount) {
  const toArmor = Math.min(armor, amount * 0.7);
  const toHealth = amount - toArmor;
  return { armor: armor - toArmor, health: Math.max(0, health - toHealth), taken: toHealth };
}

/** Régénération : +3 PV/s jusqu'à REGEN_CAP, après REGEN_DELAY sans dégât. */
export function regen(health, dt, sinceDamage) {
  if (sinceDamage < REGEN_DELAY || health >= REGEN_CAP || health <= 0) return health;
  return Math.min(REGEN_CAP, health + 3 * dt);
}

/** Un pas de balistique (gravité réduite pour un arc de paintball lisible). */
export function stepBallistic(p, v, dt, g = 5.5) {
  v.y -= g * dt;
  p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
  return p;
}

/** Secteur de la roue (0 = haut, puis sens horaire) selon un vecteur (x, y écran) ; -1 dans la zone morte. */
export function wheelSector(x, y, n = 4, dead = 0.35) {
  if (Math.hypot(x, y) < dead) return -1;
  const a = (Math.atan2(x, -y) + Math.PI * 2) % (Math.PI * 2);
  return Math.round(a / ((Math.PI * 2) / n)) % n;
}

/** Distance d'un point au segment [a, b] (3D). */
export function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, l2 = dx * dx + dy * dy + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / l2));
  return { d: Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y, a.z + dz * t - p.z), t };
}

/** La cible est-elle dans le cône d'attaque ? (origine o, direction plane d unitaire) */
export function inCone(o, d, p, range, cosHalf = 0.35) {
  const dx = p.x - o.x, dz = p.z - o.z, dist = Math.hypot(dx, dz);
  if (dist > range) return false;
  if (dist < 0.6) return true;
  return (dx * d.x + dz * d.z) / dist >= cosHalf;
}
