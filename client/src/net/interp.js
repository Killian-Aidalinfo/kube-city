// Interpolation des autres joueurs : tampon d'échantillons horodatés, lecture avec 100 ms de retard,
// extrapolation courte au-delà du dernier échantillon, téléportation si l'écart dépasse 10 m. Fonctions pures.
export const DELAY = 0.1;          // s : retard d'affichage
export const MAX_EXTRAP = 0.25;    // s : extrapolation maximale
export const TELEPORT = 10;        // m : au-delà, pas d'interpolation
const KEEP = 24;                   // échantillons conservés

const lerp = (a, b, k) => a + (b - a) * k;
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

/** Ajoute un échantillon { p:[x,y,z], r?, q?, vel? } reçu à l'instant t (secondes). */
export function pushSample(buf, t, s) {
  const last = buf[buf.length - 1];
  if (last && Math.hypot(s.p[0] - last.p[0], s.p[1] - last.p[1], s.p[2] - last.p[2]) > TELEPORT) buf.length = 0; // téléportation
  buf.push({ ...s, t });
  if (buf.length > KEEP) buf.shift();
}

function slerp(a, b, k) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = d < 0 ? -1 : 1;
  d = Math.abs(d);
  const out = [0, 0, 0, 1];
  if (d > 0.9995) { for (let i = 0; i < 4; i++) out[i] = lerp(a[i], s * b[i], k); }
  else {
    const th = Math.acos(d), sin = Math.sin(th), w1 = Math.sin((1 - k) * th) / sin, w2 = Math.sin(k * th) / sin;
    for (let i = 0; i < 4; i++) out[i] = w1 * a[i] + w2 * s * b[i];
  }
  const n = Math.hypot(...out) || 1;
  return out.map((x) => x / n);
}

/** État interpolé à l'instant `t` (déjà décalé du retard par l'appelant) ; null si le tampon est vide. */
export function sampleAt(buf, t) {
  if (!buf.length) return null;
  const first = buf[0], last = buf[buf.length - 1];
  if (t <= first.t) return { ...first };
  if (t >= last.t) {
    // extrapolation courte avec la vitesse connue, puis on se fige
    const dt = Math.min(t - last.t, MAX_EXTRAP);
    const v = last.vel;
    return { ...last, p: v ? [last.p[0] + v[0] * dt, last.p[1] + v[1] * dt, last.p[2] + v[2] * dt] : last.p };
  }
  let i = buf.length - 1;
  while (i > 0 && buf[i - 1].t > t) i--;
  const a = buf[i - 1], b = buf[i];
  const k = (t - a.t) / (b.t - a.t || 1);
  return {
    ...b,
    p: [lerp(a.p[0], b.p[0], k), lerp(a.p[1], b.p[1], k), lerp(a.p[2], b.p[2], k)],
    r: a.r != null && b.r != null ? lerpAngle(a.r, b.r, k) : b.r,
    q: a.q && b.q ? slerp(a.q, b.q, k) : b.q,
    w: b.w,
  };
}
