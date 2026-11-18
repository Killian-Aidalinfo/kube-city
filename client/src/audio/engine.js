// Modèle de moteur synthétisé : calcule régime, fréquence et filtre selon la vitesse, le rapport engagé et la catégorie.
// Module pur (aucune dépendance Web Audio) pour pouvoir être testé sous Node.

/**
 * cyl : nombre de cylindres ; idle/max : régime (tr/min) ; vmax : vitesse max (km/h) ;
 * wave : forme d'onde principale ; growl : part de grave (0..1) ; bright : brillance du filtre.
 */
export const CATEGORIES = {
  compacte:    { cyl: 4, idle: 900,  max: 6400, vmax: 150, wave: 'sawtooth', growl: 0.35, bright: 1.1 },
  berline:     { cyl: 4, idle: 800,  max: 5800, vmax: 170, wave: 'sawtooth', growl: 0.45, bright: 0.9 },
  sport:       { cyl: 6, idle: 950,  max: 8000, vmax: 240, wave: 'sawtooth', growl: 0.5,  bright: 1.5 },
  muscle:      { cyl: 8, idle: 700,  max: 5600, vmax: 210, wave: 'square',   growl: 0.9,  bright: 0.8 },
  suv:         { cyl: 6, idle: 750,  max: 5400, vmax: 170, wave: 'sawtooth', growl: 0.6,  bright: 0.8 },
  pickup:      { cyl: 6, idle: 700,  max: 5200, vmax: 160, wave: 'square',   growl: 0.7,  bright: 0.75 },
  camionnette: { cyl: 4, idle: 700,  max: 4600, vmax: 130, wave: 'square',   growl: 0.8,  bright: 0.6 },
  taxi:        { cyl: 4, idle: 800,  max: 5600, vmax: 160, wave: 'sawtooth', growl: 0.4,  bright: 0.9 },
  bus:         { cyl: 6, idle: 600,  max: 3800, vmax: 100, wave: 'square',   growl: 1.0,  bright: 0.5 },
  police:      { cyl: 6, idle: 850,  max: 6600, vmax: 200, wave: 'sawtooth', growl: 0.55, bright: 1.2 },
  ambulance:   { cyl: 4, idle: 750,  max: 5000, vmax: 140, wave: 'square',   growl: 0.7,  bright: 0.7 },
  moto:        { pitch: 3, cyl: 2, idle: 1300, max: 9500, vmax: 190, wave: 'sawtooth', growl: 0.2,  bright: 1.8 },
};

const PATTERNS = [
  [/moto|bike|scooter/i, 'moto'], [/police|cop|swat|interceptor/i, 'police'], [/ambul|medic/i, 'ambulance'],
  [/bus/i, 'bus'], [/taxi|cab/i, 'taxi'], [/pick|truck|camion(?!nette)|delivery/i, 'pickup'],
  [/van|camionnette|fourgon/i, 'camionnette'], [/suv|offroad|4x4|jeep/i, 'suv'],
  [/sport|race|super|coupe|rally/i, 'sport'], [/muscle|hotrod|v8/i, 'muscle'],
  [/compact|hatch|mini|small/i, 'compacte'],
];

/** Déduit la catégorie sonore d'après le nom du type de véhicule (Car Kit de Kenney : sedan, suv, truck…). */
export function categoryOf(type = '') {
  const t = String(type);
  for (const [re, cat] of PATTERNS) if (re.test(t)) return cat;
  return 'berline';
}

// Fraction de la vitesse max à laquelle chaque rapport se termine
const GEAR_TOPS = [0.16, 0.32, 0.5, 0.72, 1.0];

/**
 * @param {string} cat catégorie (clé de CATEGORIES)
 * @param {number} speed vitesse en km/h (valeur absolue utilisée)
 * @param {number} throttle accélérateur 0..1
 * @returns {{ gear: number, rpm: number, freq: number, cutoff: number, gain: number, sub: number }}
 */
export function engineParams(cat, speed, throttle = 0) {
  const c = CATEGORIES[cat] || CATEGORIES.berline;
  const v = Math.abs(speed) / c.vmax;
  const th = Math.max(0, Math.min(1, throttle));
  let gear = GEAR_TOPS.findIndex((t) => v <= t);
  if (gear < 0) gear = GEAR_TOPS.length - 1;
  const lo = gear === 0 ? 0 : GEAR_TOPS[gear - 1] * 0.62;
  const frac = Math.max(0, Math.min(1, (v - lo) / (GEAR_TOPS[gear] - lo)));
  const rpm = c.idle + (c.max - c.idle) * (0.12 + 0.88 * frac) * (0.55 + 0.45 * Math.max(th, 0.35 + frac * 0.4)) ;
  // fréquence fondamentale d'un 4 temps : cyl/2 explosions par tour
  const freq = (rpm / 60) * (c.cyl / 2) * (c.pitch || 1);
  const load = 0.35 + 0.65 * th;
  return {
    gear: gear + 1, rpm, freq,
    cutoff: (350 + rpm * 0.45 * c.bright) * (0.6 + 0.6 * load),
    gain: 0.16 + 0.16 * load,
    sub: c.growl,
  };
}

/** Intensité du crissement de pneus 0..1 d'après vitesse, braquage et frein à main. */
export function skidAmount({ speed = 0, steer = 0, handbrake = false, slip }) {
  if (typeof slip === 'number') return Math.max(0, Math.min(1, slip));
  const s = Math.abs(speed);
  if (s < 25) return 0;
  let a = 0;
  if (handbrake) a = 0.85;
  a = Math.max(a, Math.max(0, Math.abs(steer) - 0.65) * (s / 120) * 2.2);
  return Math.max(0, Math.min(1, a));
}
