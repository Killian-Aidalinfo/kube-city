// Logique pure de la police : chaleur → étoiles, recherche et perte de contact.

/** Chaleur de base par type de crime (multipliée par la gravité). */
export const CRIME_HEAT = { carjack: 10, hitPed: 9, assault: 5, speedingNearCop: 3, shootCop: 55, vandalism: 3 };
/** Chaleur minimale pour 1..5 étoiles. */
export const STAR_THRESHOLDS = [8, 24, 50, 90, 150];
/** Nombre de voitures actives par niveau (0..5). */
export const UNIT_TARGET = [0, 1, 3, 4, 5, 6];
/** Secondes hors de vue nécessaires pour perdre la recherche, par niveau. */
export const SEARCH_TIME = [0, 14, 20, 28, 36, 45];

export function heatFromCrime(kind, severity = 1) {
  const s = Math.max(0.2, Math.min(3, Number(severity) || 1));
  return (CRIME_HEAT[kind] ?? 4) * s;
}
export function levelFromHeat(heat) {
  let l = 0;
  for (let i = 0; i < STAR_THRESHOLDS.length; i++) if (heat >= STAR_THRESHOLDS[i]) l = i + 1;
  return l;
}
export function heatForLevel(level) { return level <= 0 ? 0 : STAR_THRESHOLDS[Math.min(5, level) - 1]; }

export function newSearch() { return { mode: 'none', timer: 0, total: 0, unseen: 0, zone: null, lastKnown: null }; }

/**
 * Avance la recherche d'un pas. `seen` : un policier voit le joueur ; `pos` : {x,z} du joueur.
 * Renvoie 'hunting' (poursuite), 'searching' (zone affichée, étoiles clignotantes) ou 'lost' (étoiles perdues).
 * Sortir du cercle sans être vu accélère le compte à rebours (×2).
 */
export function stepSearch(s, { dt, seen, pos, level }) {
  if (level <= 0) { Object.assign(s, newSearch()); return 'none'; }
  if (seen) {
    s.lastKnown = { x: pos.x, z: pos.z };
    s.total = s.timer = SEARCH_TIME[level];
    s.unseen = 0; s.zone = null; s.mode = 'hunting';
    return 'hunting';
  }
  s.unseen += dt;
  if (s.unseen < 4 || !s.lastKnown) return s.mode = 'hunting';
  if (!s.zone) s.zone = { center: { ...s.lastKnown }, radius: 70 + 35 * level };
  const inside = Math.hypot(pos.x - s.zone.center.x, pos.z - s.zone.center.z) < s.zone.radius;
  s.timer -= dt * (inside ? 1 : 2);
  s.mode = 'searching';
  return s.timer <= 0 ? 'lost' : 'searching';
}

/** Faut-il retenir ce crime ? Seuls les crimes vus (témoin, signalement ou policier proche) comptent. */
export function isWitnessed(crime, copDistance) {
  return !!crime.witnessed || copDistance < 45;
}
