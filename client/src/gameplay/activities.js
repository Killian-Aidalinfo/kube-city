// Logique pure des activités : course (classement des rivaux), taxi, livraison, cascades, kubes. Aucune dépendance au DOM.
import { mulberry32 } from '../audio/radio.js';

export const dist2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Longueur d'une polyligne. */
export function pathLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist2d(pts[i - 1], pts[i]);
  return l;
}

/** Point situé à la distance d le long d'une polyligne (borné aux extrémités). */
export function pointAlong(pts, d) {
  if (!pts.length) return null;
  let rest = Math.max(0, d);
  for (let i = 1; i < pts.length; i++) {
    const seg = dist2d(pts[i - 1], pts[i]);
    if (rest <= seg || i === pts.length - 1) {
      const k = seg > 0 ? Math.min(1, rest / seg) : 0;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k, z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * k };
    }
    rest -= seg;
  }
  return { ...pts[pts.length - 1] };
}

/**
 * Course de rue : le joueur franchit des points de passage ; les rivaux sont simulés par une vitesse moyenne.
 * @param {{x:number,z:number}[]} checkpoints
 * @param {{name:string, speed:number}[]} rivals vitesse moyenne en m/s
 */
export function createRace(checkpoints, rivals, startPos) {
  const pts = [startPos, ...checkpoints];
  const total = pathLength(pts);
  const state = {
    checkpoints, total, index: 0, time: 0, finished: false, place: 0,
    rivals: rivals.map((r, i) => ({ ...r, phase: i * 1.7, finishedAt: 0 })),
    /** Distance parcourue par un rival à l'instant t (légères variations de rythme). */
    rivalDistance(r, t) { return Math.min(total, r.speed * t * (1 + 0.06 * Math.sin(t / 6 + r.phase))); },
    /** Distance parcourue par le joueur d'après son avancement. */
    playerDistance(pos) {
      const done = pathLength(pts.slice(0, state.index + 1));
      const leg = dist2d(pts[state.index], pts[state.index + 1] || pts[state.index]);
      const left = Math.min(leg, dist2d(pos, pts[state.index + 1] || pts[state.index]));
      return done + leg - left;
    },
    /** Classement actuel du joueur (1 = premier). */
    rank(pos) {
      const me = state.finished ? total : state.playerDistance(pos);
      let r = 1;
      for (const rv of state.rivals) {
        const d = rv.finishedAt ? total : state.rivalDistance(rv, state.time);
        if (d > me + 1e-6) r++;
      }
      return r;
    },
    /** Avance d'une image ; renvoie 'checkpoint' quand un point est franchi, 'finish' à l'arrivée. */
    update(dt, pos, radius = 14) {
      if (state.finished) return null;
      state.time += dt;
      for (const rv of state.rivals) if (!rv.finishedAt && state.rivalDistance(rv, state.time) >= total) rv.finishedAt = state.time;
      if (dist2d(pos, checkpoints[state.index]) <= radius) {
        state.index++;
        if (state.index >= checkpoints.length) {
          state.finished = true;
          state.place = 1 + state.rivals.filter((r) => r.finishedAt).length;
          return 'finish';
        }
        return 'checkpoint';
      }
      return null;
    },
  };
  return state;
}

/** Gain d'une course selon la place (1 à 4+). */
export function raceReward(place, base = 600) { return Math.round(base * ({ 1: 1, 2: 0.55, 3: 0.3 }[place] ?? 0.1)); }

/** Pourboire du taxi : meilleur si le trajet est rapide et sans casse. */
export function taxiTip(fare, timeUsed, timeAllowed, damageTaken) {
  const speed = Math.max(0, Math.min(1, 1 - timeUsed / timeAllowed));
  const care = Math.max(0, 1 - damageTaken / 40);
  return Math.round(fare * 0.8 * speed * care);
}

/** Prix de la course de taxi d'après la distance. */
export const taxiFare = (meters) => Math.max(30, Math.round(20 + meters * 0.08));

/** Temps alloué à une livraison : distance / vitesse moyenne + marge. */
export const deliveryTime = (meters) => Math.round(25 + meters / 12);

/** Récompense de livraison, proportionnelle à la distance et au temps restant. */
export const deliveryReward = (meters, timeLeft, limit) => Math.round(60 + meters * 0.12 + 80 * Math.max(0, timeLeft / limit));

/**
 * Détecteur de cascade : il faut ≥ 0,8 s en l'air à ≥ 30 km/h. Renvoie { air, bonus } à l'atterrissage.
 */
export function createAirTracker() {
  let air = 0;
  return {
    update(dt, airborne, speed) {
      if (airborne && Math.abs(speed) >= 30) { air += dt; return null; }
      if (!airborne && air > 0) {
        const t = air; air = 0;
        if (t >= 0.8) return { air: t, bonus: Math.round(40 + t * 60) };
      }
      if (!airborne) air = 0;
      return null;
    },
    get air() { return air; },
  };
}

/** 50 positions de kubes déterministes, espacées d'au moins 40 m. */
export function kubePositions(count = 50, size = 1200, seed = 5050) {
  const rng = mulberry32(seed);
  const out = [];
  const half = size / 2 - 40;
  let guard = 0;
  while (out.length < count && guard++ < 20000) {
    const p = { x: (rng() * 2 - 1) * half, z: (rng() * 2 - 1) * half };
    if (out.every((q) => dist2d(p, q) >= 40)) out.push(p);
  }
  return out;
}
