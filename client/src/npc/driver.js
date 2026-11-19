// Pilotage de véhicule : suivi de voie sur le graphe ou de polyligne, commandes de direction et de vitesse.
// Convention : steer > 0 = tourner à DROITE (inverser STEER_SIGN si le module véhicules attend l'inverse).
import { nextArc } from './graph.js';

export const STEER_SIGN = 1;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Avant (+Z local) d'un objet 3D, projeté sur le plan XZ. */
export function headingOf(obj, out = { x: 0, z: 1 }) {
  const q = obj.quaternion;
  out.x = 2 * (q.x * q.z + q.w * q.y);
  out.z = 1 - 2 * (q.x * q.x + q.y * q.y);
  const l = Math.hypot(out.x, out.z) || 1;
  out.x /= l; out.z /= l;
  return out;
}

/** Direction [-1, 1] pour viser (tx, tz) depuis l'avant (fx, fz). */
export function steerTo(fx, fz, tx, tz) {
  const l = Math.hypot(tx, tz) || 1;
  tx /= l; tz /= l;
  const sin = fx * tz - fz * tx;       // > 0 : cible à droite
  const cos = fx * tx + fz * tz;
  const ang = Math.atan2(sin, cos);
  return clamp(ang / 0.55, -1, 1) * STEER_SIGN;
}

/** Accélérateur et frein pour atteindre `desired` (m/s) depuis `speed` (m/s). */
export function speedCommand(speed, desired) {
  const d = desired - speed;
  if (d >= -0.5) return { throttle: clamp(d / 6, 0, 1), brake: 0 };
  return { throttle: 0, brake: clamp(-d / 8, 0, 1) };
}

/** Suit les voies du graphe avec un décalage latéral à droite. */
export class LanePath {
  constructor(graph, arc, rng, offset = 2) {
    this.graph = graph; this.arc = arc; this.rng = rng; this.offset = offset; this.avoid = 0;
    this.next = nextArc(graph, arc, rng); this.s = 0;
  }
  point(arc, t, extra = 0) {
    const o = this.offset + extra, n = this.graph.nodes[arc.a];
    return { x: n.x + arc.dx * t - arc.dz * o, z: n.z + arc.dz * t + arc.dx * o };
  }
  /** Met à jour la progression ; renvoie la distance restante sur l'arc. */
  update(pos) {
    const A = this.graph.nodes[this.arc.a];
    this.s = (pos.x - A.x) * this.arc.dx + (pos.z - A.z) * this.arc.dz;
    if (this.s > this.arc.len - 2 && this.next) {
      this.arc = this.next; this.next = nextArc(this.graph, this.arc, this.rng);
      const B = this.graph.nodes[this.arc.a];
      this.s = (pos.x - B.x) * this.arc.dx + (pos.z - B.z) * this.arc.dz;
    }
    return this.arc.len - this.s;
  }
  /** Point visé à `look` mètres devant. */
  target(look) {
    const t = Math.max(0, this.s) + look;
    if (t <= this.arc.len || !this.next) return this.point(this.arc, Math.min(t, this.arc.len), this.avoid);
    return this.point(this.next, Math.min(t - this.arc.len, this.next.len), this.avoid);
  }
  /** Angle approximatif du virage à venir (rad) pour ralentir. */
  curve() {
    if (!this.next) return 0;
    return Math.acos(clamp(this.arc.dx * this.next.dx + this.arc.dz * this.next.dz, -1, 1));
  }
}

/** Suit une polyligne de points {x,z} (itinéraire de police, GPS). */
export class PolyPath {
  constructor(points) { this.pts = points; this.i = 0; }
  update(pos) {
    while (this.i < this.pts.length - 1) {
      const a = this.pts[this.i], b = this.pts[this.i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
      const t = ((pos.x - a.x) * dx + (pos.z - a.z) * dz) / l2;
      if (t > 0.92 || Math.hypot(b.x - pos.x, b.z - pos.z) < 6) this.i++; else break;
    }
    const end = this.pts[this.pts.length - 1];
    return Math.hypot(end.x - pos.x, end.z - pos.z);
  }
  target(look, pos) {
    let i = this.i, acc = 0, p = this.pts[Math.min(i + 1, this.pts.length - 1)];
    let from = pos;
    for (; i < this.pts.length - 1; i++) {
      p = this.pts[i + 1];
      const l = Math.hypot(p.x - from.x, p.z - from.z);
      if (acc + l >= look) { const k = (look - acc) / (l || 1); return { x: from.x + (p.x - from.x) * k, z: from.z + (p.z - from.z) * k }; }
      acc += l; from = p;
    }
    return p;
  }
}

/** Téléporte un véhicule (recyclage de pool) : API véhicule si présente, sinon corps Rapier + objet 3D. Sans y : posé sur le sol réel (collines comprises). */
export function relocate(veh, p, yaw, y) {
  const g = veh.game?.world?.groundHeight?.(p.x, p.z);
  const py = y ?? p.y ?? (typeof g === 'number' ? g : 0) + 0.5;
  const api = veh.game?.vehicles?.teleport;
  if (typeof api === 'function' && veh.chassis) { api.call(veh.game.vehicles, veh, { x: p.x, y: py, z: p.z }, yaw); return; }
  const h = yaw / 2, q = { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
  const b = veh.chassis;
  if (b?.setTranslation) {
    b.setTranslation({ x: p.x, y: py, z: p.z }, true); b.setRotation(q, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  if (veh.object3d) { veh.object3d.position.set(p.x, py, p.z); veh.object3d.quaternion.set(q.x, q.y, q.z, q.w); }
}
