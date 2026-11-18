// Logique pure du module PNJ (testable sans navigateur) : densités, suivi de véhicule, feux.

export const QUALITY_PEDS = { low: 20, medium: 45, high: 80 };
export const QUALITY_CARS = { low: 6, medium: 14, high: 24 };

/** Facteur de densité piétonne selon le nom du quartier. */
export function districtFactor(name = '') {
  const n = String(name).toLowerCase();
  if (n.includes('centre')) return 1;
  if (n.includes('plage')) return 0.9;
  if (n.includes('dock')) return 0.5;
  if (n.includes('colline')) return 0.4;
  if (n.includes('indus') || n.includes('aéro') || n.includes('aero')) return 0.25;
  return 0.6;
}

/** Facteur horaire (0..1) : rues vides la nuit, pleines en journée. */
export function hourFactor(h) {
  if (h < 5) return 0.2;
  if (h < 7) return 0.45;
  if (h < 9) return 0.8;
  if (h < 19) return 1;
  if (h < 22) return 0.8;
  return 0.4;
}

/** Nombre cible de piétons actifs. */
export function pedTarget({ quality = 'medium', density = 1, district = '', hour = 12 } = {}) {
  const max = Math.round((QUALITY_PEDS[quality] ?? QUALITY_PEDS.medium) * Math.max(0, Math.min(1, density)));
  return Math.round(max * Math.max(0.15, districtFactor(district)) * hourFactor(hour));
}

/** Nombre cible de voitures de circulation. */
export function carTarget({ quality = 'medium', density = 1, hour = 12 } = {}) {
  const max = Math.round((QUALITY_CARS[quality] ?? QUALITY_CARS.medium) * Math.max(0, Math.min(1, density)));
  return Math.max(max > 0 ? 2 : 0, Math.round(max * (0.4 + 0.6 * hourFactor(hour))));
}

/** Vitesse conseillée (m/s) derrière un leader : 0 si trop près, sinon rattrape en douceur. */
export function followSpeed(gap, leaderSpeed, desired) {
  if (gap < 3) return 0;
  return Math.min(desired, Math.max(0, leaderSpeed) + (gap - 3) * 0.8);
}

/** Vitesse max (m/s) pour s'arrêter en `dist` mètres avec une décélération `decel`. */
export function stopSpeed(dist, decel = 3) {
  return Math.sqrt(2 * decel * Math.max(0, dist));
}

/**
 * État d'un feu pour un véhicule qui roule vers (dx, dz) : 'green' | 'yellow' | 'red'.
 * Tolérant sur la forme du feu exposée par le monde (stateFor, canGo, state chaîne ou { ns, ew }).
 */
export function lightState(light, dx, dz) {
  if (!light) return 'green';
  if (typeof light.stateFor === 'function') return light.stateFor(dx, dz);
  if (typeof light.canGo === 'function') return light.canGo(dx, dz) ? 'green' : 'red';
  const nsAxis = Math.abs(dz) >= Math.abs(dx);
  // forme du monde : tl.state('ns'|'ew') → 'green'|'yellow'|'red'
  if (typeof light.state === 'function') return light.state(nsAxis ? 'ns' : 'ew') ?? 'green';
  const s = light.state;
  if (s && typeof s === 'object') return (nsAxis ? s.ns ?? s.z : s.ew ?? s.x) ?? 'green';
  if (typeof s === 'string') {
    const axis = String(light.axis ?? 'ns').toLowerCase();
    const mine = (axis === 'ns' || axis === 'z') === nsAxis;
    if (mine) return s;
    return s === 'green' ? 'red' : s === 'red' ? 'green' : 'red';
  }
  return 'green';
}

/** Position {x,z} d'un feu quelle que soit sa forme. */
export function lightPos(light) {
  const p = light?.position ?? light;
  return { x: p?.x ?? 0, z: p?.z ?? 0 };
}

/** Lacet (rad) d'un vecteur de direction ; l'avant d'un modèle est +Z. */
export const yawOf = (dx, dz) => Math.atan2(dx, dz);

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
