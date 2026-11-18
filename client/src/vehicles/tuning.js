// Réglages des véhicules (pur : aucune dépendance à three ni Rapier) — spec 7.
// Chaque type correspond à un modèle du Kenney Car Kit (manifest.vehicles.models).
// accel = accélération de départ (m/s²), top = vitesse max (km/h), grip = adhérence latérale (1 = normal).

/** Catégories : réglages communs ; les types les surchargent au besoin. */
export const CATEGORIES = {
  compacte:    { label: 'Compacte',    mass: 980,  accel: 8.5,  top: 150, grip: 1.05, steer: 0.62, drive: 'fwd', seats: 4 },
  berline:     { label: 'Berline',     mass: 1300, accel: 8.0,  top: 175, grip: 1.0,  steer: 0.58, drive: 'rwd', seats: 4 },
  sport:       { label: 'Sportive',    mass: 1150, accel: 12.5, top: 235, grip: 1.15, steer: 0.55, drive: 'rwd', seats: 2 },
  muscle:      { label: 'Muscle',      mass: 1500, accel: 11.5, top: 215, grip: 0.9,  steer: 0.55, drive: 'rwd', seats: 2 },
  suv:         { label: 'SUV',         mass: 1750, accel: 7.5,  top: 165, grip: 1.1,  steer: 0.55, drive: 'awd', seats: 5 },
  camionnette: { label: 'Camionnette', mass: 2100, accel: 6.2,  top: 135, grip: 0.95, steer: 0.55, drive: 'rwd', seats: 3 },
  'pick-up':   { label: 'Pick-up',     mass: 1900, accel: 7.0,  top: 155, grip: 1.0,  steer: 0.56, drive: 'rwd', seats: 3 },
  taxi:        { label: 'Taxi',        mass: 1350, accel: 8.2,  top: 170, grip: 1.0,  steer: 0.58, drive: 'rwd', seats: 4 },
  police:      { label: 'Police',      mass: 1500, accel: 10.5, top: 205, grip: 1.12, steer: 0.58, drive: 'rwd', seats: 4, siren: true },
  ambulance:   { label: 'Ambulance',   mass: 2400, accel: 6.8,  top: 150, grip: 0.95, steer: 0.5,  drive: 'rwd', seats: 3, siren: true },
  pompiers:    { label: 'Pompiers',    mass: 4600, accel: 5.2,  top: 115, grip: 0.9,  steer: 0.45, drive: 'rwd', seats: 3, siren: true },
  bus:         { label: 'Bus',         mass: 9500, accel: 3.3,  top: 85,  grip: 0.85, steer: 0.4,  drive: 'rwd', seats: 2 },
  moto:        { label: 'Moto',        mass: 230,  accel: 9.5,  top: 185, grip: 1.1,  steer: 0.5,  drive: 'rwd', seats: 1, twoWheel: true },
  poids_lourd: { label: 'Benne',       mass: 5200, accel: 4.6,  top: 100, grip: 0.9,  steer: 0.42, drive: 'rwd', seats: 2 },
};

/** Types jouables : id (= modèle) → catégorie + surcharges. */
export const TYPES = {
  'hatchback-sports': { category: 'compacte', label: 'Mini-sportive', accel: 9.5, top: 165 },
  sedan: { category: 'berline', label: 'Berline' },
  'sedan-sports': { category: 'muscle', label: 'Berline sport' },
  race: { category: 'sport', label: 'Bolide' },
  'race-future': { category: 'sport', label: 'Bolide futur', accel: 13.5, top: 260 },
  suv: { category: 'suv', label: 'SUV' },
  'suv-luxury': { category: 'suv', label: 'SUV de luxe', accel: 8.2, top: 185 },
  van: { category: 'camionnette', label: 'Camionnette' },
  delivery: { category: 'camionnette', label: 'Fourgon de livraison', mass: 2300 },
  truck: { category: 'pick-up', label: 'Pick-up' },
  taxi: { category: 'taxi', label: 'Taxi' },
  police: { category: 'police', label: 'Voiture de police' },
  ambulance: { category: 'ambulance', label: 'Ambulance' },
  firetruck: { category: 'pompiers', label: 'Camion de pompiers' },
  'garbage-truck': { category: 'poids_lourd', label: 'Camion-benne' },
  bus: { category: 'bus', label: 'Bus', procedural: true },
  moto: { category: 'moto', label: 'Moto', procedural: true },
};
// alias lisibles (catégories) → premier modèle
export const ALIASES = { compacte: 'hatchback-sports', berline: 'sedan', sport: 'race', muscle: 'sedan-sports', camionnette: 'van', 'pick-up': 'truck', pompiers: 'firetruck', poids_lourd: 'garbage-truck' };

/** Spécification complète d'un type (catégorie + surcharges), ou null si inconnu. */
export function specFor(type) {
  const id = TYPES[type] ? type : ALIASES[type];
  const t = TYPES[id];
  if (!t) return null;
  return { id, model: id, ...CATEGORIES[t.category], ...t };
}

/** Angle de braquage max (rad) : diminue avec la vitesse pour rester stable. */
export function steerLimit(base, speedMs) {
  const k = Math.min(1, speedMs / 38);
  return base * (1 - 0.72 * k * k);
}

/** Force motrice totale (N) : pleine au démarrage, s'éteint vers la vitesse max. */
export function engineForce(spec, throttle, forwardSpeedMs) {
  const topMs = spec.top / 3.6;
  const reverse = throttle < 0;
  const vmax = reverse ? topMs * 0.3 : topMs;
  const dir = reverse ? -1 : 1;
  const along = forwardSpeedMs * dir; // vitesse dans le sens demandé
  if (along >= vmax) return 0;
  const curve = 1 - Math.pow(Math.max(0, along) / vmax, 2.4);
  const a = spec.accel * (reverse ? 0.55 : 1);
  return Math.abs(throttle) * spec.mass * a * curve * dir;
}

/** Dégâts (en % de santé) pour une variation de vitesse `dv` (m/s) subie par un véhicule. */
export function collisionDamage(dv, mass, otherMass = Infinity) {
  if (dv < 3.5) return 0;
  const lightness = otherMass === Infinity ? 1 : Math.min(1.4, otherMass / mass);
  return Math.min(60, (dv - 3.5) * 2.6 * lightness);
}

/** Niveau d'état : 'ok' | 'smoke' (< 30 %) | 'fire' (< 10 %) | 'wreck' (0). */
export function damageLevel(health) {
  if (health <= 0) return 'wreck';
  if (health < 10) return 'fire';
  if (health < 30) return 'smoke';
  return 'ok';
}

/** Régime moteur normalisé 0..1 pour l'audio, selon la vitesse et le rapport (5 rapports). */
export function rpmFor(speedMs, topKmh, throttle) {
  const frac = Math.min(1, (speedMs * 3.6) / topKmh);
  const gears = 5, g = Math.min(gears - 1, Math.floor(frac * gears));
  const inGear = frac * gears - g;
  return Math.min(1, 0.22 + inGear * 0.62 + Math.abs(throttle) * 0.16);
}
