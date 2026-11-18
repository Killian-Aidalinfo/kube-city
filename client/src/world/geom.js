// Constructeur de géométries fusionnées (positions, normales, couleurs, UV) : une seule BufferGeometry par chunk.
import * as THREE from 'three';

const _c = new THREE.Color();
export const rgb = (hex) => { _c.set(hex); return [_c.r, _c.g, _c.b]; };
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// Atlas de façades : 8 x 8 cases de 3,2 m x 3,6 m ; la case (0,0) est un mur plein (UV « vide »)
export const WIN_W = 3.2, WIN_H = 3.6, TILE_W = WIN_W * 8, TILE_H = WIN_H * 8;
const BLANK = [0.03, 0.03];

export class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.uv = []; this.idx = []; this.n = 0; }
  _v(p, nrm, c, uv) { this.pos.push(p[0], p[1], p[2]); this.nor.push(nrm[0], nrm[1], nrm[2]); this.col.push(c[0], c[1], c[2]); this.uv.push(uv[0], uv[1]); return this.n++; }
  /** Quad p0..p3 ; `want` = normale souhaitée (inverse l'ordre si besoin), sinon ordre direct. */
  quad(p, c, uv = [BLANK, BLANK, BLANK, BLANK], want = null) {
    let order = [0, 1, 2, 3];
    const nm = norm3(cross3(sub3(p[1], p[0]), sub3(p[2], p[0])));
    let n = nm;
    if (want && dot3(nm, want) < 0) { order = [0, 3, 2, 1]; n = [-nm[0], -nm[1], -nm[2]]; }
    const cs = Array.isArray(c[0]) ? c : [c, c, c, c];
    const ids = order.map((k) => this._v(p[k], n, cs[k], uv[k]));
    this.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
  }
  tri(p, c, want = null, uv = BLANK) {
    let nm = norm3(cross3(sub3(p[1], p[0]), sub3(p[2], p[0]))), q = p;
    if (want && dot3(nm, want) < 0) { q = [p[0], p[2], p[1]]; nm = [-nm[0], -nm[1], -nm[2]]; }
    const cs = Array.isArray(c[0]) ? c : [c, c, c];
    const a = this._v(q[0], nm, cs[0], uv), b = this._v(q[1], nm, cs[1], uv), d = this._v(q[2], nm, cs[2], uv);
    this.idx.push(a, b, d);
  }
  get empty() { return this.n === 0; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(new THREE.BufferAttribute(this.n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Boîte (éventuellement tournée de rot rad autour de Y) avec façades à fenêtres et toit plat / à pignon / pyramidal. */
export function addBox(gb, part) {
  const { cx, cz, w, d, y0, y1, rot = 0, win, roof = 'flat' } = part;
  const base = rgb(part.color), top = shade(base, 0.82), cs = Math.cos(rot), sn = Math.sin(rot);
  const W = (lx, lz) => [cx + lx * cs + lz * sn, cz - lx * sn + lz * cs];
  const L = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([a, b]) => W(a, b));
  const ctr = [cx, (y0 + y1) / 2, cz];
  for (let k = 0; k < 4; k++) {
    const A = L[k], B = L[(k + 1) % 4], len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const mid = [(A[0] + B[0]) / 2, (y0 + y1) / 2, (A[1] + B[1]) / 2];
    const want = [mid[0] - ctr[0], 0, mid[2] - ctr[2]];
    let uvs;
    if (win) {
      const u0 = (A[0] * 0.7 + A[1] * 0.3 + k * 3.7) / TILE_W, u1 = u0 + len / TILE_W, v0 = 0.015, v1 = (y1 - y0) / TILE_H + v0;
      uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    }
    gb.quad([[A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]]], [shade(base, 0.62), shade(base, 0.62), base, base], uvs, want);
  }
  const ty = y1;
  if (roof === 'flat') gb.quad(L.map((q) => [q[0], ty, q[1]]), top, undefined, [0, 1, 0]);
  else if (roof === 'pyr') {
    const rc = part.roofColor ?? 0x8c4a3a, rcol = rgb(rc), apex = [cx, ty + (part.roofH ?? 3), cz];
    for (let k = 0; k < 4; k++) {
      const A = L[k], B = L[(k + 1) % 4];
      gb.tri([[A[0], ty, A[1]], [B[0], ty, B[1]], apex], shade(rcol, k % 2 ? 0.85 : 1), [(A[0] + B[0]) / 2 - cx, 0.6, (A[1] + B[1]) / 2 - cz]);
    }
  } else if (roof === 'gable') {
    const rcol = rgb(part.roofColor ?? 0x8c4a3a), h = part.roofH ?? 3;
    const alongX = w >= d; // faîtage selon le grand côté
    const R = alongX ? [W(-w / 2, 0), W(w / 2, 0)] : [W(0, -d / 2), W(0, d / 2)];
    const rid = R.map((q) => [q[0], ty + h, q[1]]);
    const sides = alongX ? [[L[0], L[1], rid[1], rid[0]], [L[3], L[2], rid[1], rid[0]]] : [[L[0], L[3], rid[1], rid[0]], [L[1], L[2], rid[1], rid[0]]];
    // pans (deux quads), pignons (deux triangles)
    const q = (a, b, c2, d2, col) => gb.quad([[a[0], ty, a[1]], [b[0], ty, b[1]], c2, d2], col, undefined, [0, 1, 0]);
    q(sides[0][0], sides[0][1], sides[0][2], sides[0][3], rcol); q(sides[1][0], sides[1][1], sides[1][2], sides[1][3], shade(rcol, 0.9));
    if (alongX) { gb.tri([[L[0][0], ty, L[0][1]], [L[3][0], ty, L[3][1]], rid[0]], base, [-cs, 0, sn]); gb.tri([[L[1][0], ty, L[1][1]], [L[2][0], ty, L[2][1]], rid[1]], base, [cs, 0, -sn]); }
    else { gb.tri([[L[0][0], ty, L[0][1]], [L[1][0], ty, L[1][1]], rid[0]], base, [-sn, 0, -cs]); gb.tri([[L[3][0], ty, L[3][1]], [L[2][0], ty, L[2][1]], rid[1]], base, [sn, 0, cs]); }
  }
}

/** Cylindre (réservoir, cheminée, tronc) avec calotte. */
export function addCyl(gb, part, seg = 10) {
  const { cx, cz, r, y0, y1 } = part, base = rgb(part.color);
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
    gb.quad([[cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r], [cx + Math.cos(a1) * r, y1, cz + Math.sin(a1) * r], [cx + Math.cos(a0) * r, y1, cz + Math.sin(a0) * r]],
      [shade(base, 0.7), shade(base, 0.7), base, base], undefined, [Math.cos(am), 0, Math.sin(am)]);
  }
  const top = rgb(part.roofColor ?? part.color);
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
    gb.tri([[cx, y1, cz], [cx + Math.cos(a0) * r, y1, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, y1, cz + Math.sin(a1) * r]], shade(top, 0.9), [0, 1, 0]);
  }
}

/** Cône (houppier de sapin / parasol). */
export function addCone(gb, cx, cz, r, y0, y1, color, seg = 7) {
  const c = rgb(color);
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
    gb.tri([[cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r], [cx, y1, cz]],
      [shade(c, 0.7), shade(c, 0.7), c], [Math.cos(am), 0.5, Math.sin(am)]);
  }
}

/** Arbre feuillu (tronc + deux houppiers) ou palmier (tronc incliné + palmes). */
export function addTree(gb, t) {
  const s = t.s ?? 1, x = t.x, z = t.z, y = t.y;
  if (t.kind === 'palm') {
    const lean = 0.9 * s, a = t.rot, tx = Math.cos(a) * lean, tz = Math.sin(a) * lean, H = 6.5 * s;
    const trunk = rgb(0x8a6a48);
    for (let k = 0; k < 3; k++) {
      const f0 = k / 3, f1 = (k + 1) / 3, r0 = 0.28 * s * (1 - f0 * 0.4), r1 = 0.28 * s * (1 - f1 * 0.4);
      const p0 = [x + tx * f0 * f0, y + H * f0, z + tz * f0 * f0], p1 = [x + tx * f1 * f1, y + H * f1, z + tz * f1 * f1];
      for (let q = 0; q < 4; q++) {
        const b0 = (q / 4) * Math.PI * 2, b1 = ((q + 1) / 4) * Math.PI * 2;
        gb.quad([[p0[0] + Math.cos(b0) * r0, p0[1], p0[2] + Math.sin(b0) * r0], [p0[0] + Math.cos(b1) * r0, p0[1], p0[2] + Math.sin(b1) * r0], [p1[0] + Math.cos(b1) * r1, p1[1], p1[2] + Math.sin(b1) * r1], [p1[0] + Math.cos(b0) * r1, p1[1], p1[2] + Math.sin(b0) * r1]],
          shade(trunk, k % 2 ? 0.85 : 1), undefined, [Math.cos((b0 + b1) / 2), 0, Math.sin((b0 + b1) / 2)]);
      }
    }
    const top = [x + tx, y + H, z + tz], leaf = rgb(0x3f9a4a);
    for (let k = 0; k < 7; k++) {
      const b = (k / 7) * Math.PI * 2 + t.rot, ox = Math.cos(b), oz = Math.sin(b), px = -oz * 0.45, pz = ox * 0.45;
      const tip = [top[0] + ox * 3.2 * s, top[1] - 1.5 * s, top[2] + oz * 3.2 * s], mid = [top[0] + ox * 1.5 * s, top[1] + 0.5 * s, top[2] + oz * 1.5 * s];
      const A = [mid[0] + px, mid[1], mid[2] + pz], B = [mid[0] - px, mid[1], mid[2] - pz], c = shade(leaf, k % 2 ? 0.8 : 1);
      gb.tri([top, A, tip], c, [0, 1, 0]); gb.tri([top, tip, B], c, [0, 1, 0]);
      gb.tri([top, A, tip], shade(c, 0.6), [0, -1, 0]); gb.tri([top, tip, B], shade(c, 0.6), [0, -1, 0]);
    }
    return;
  }
  addCyl(gb, { cx: x, cz: z, r: 0.22 * s, y0: y, y1: y + 2.4 * s, color: 0x6b4a2e }, 5);
  const g1 = [0x3f8a45, 0x4d9a4a, 0x5ba04a, 0x38794a][Math.floor(Math.abs(x * 31 + z * 17) % 4)];
  addCone(gb, x, z, 1.9 * s, y + 1.8 * s, y + 4.6 * s, g1, 7);
  addCone(gb, x, z, 1.4 * s, y + 3.6 * s, y + 6.4 * s, g1 + 0x0a0a06, 7);
}

/** Lampadaire : mât, bras vers la route, tête. */
export function addLamp(gb, l) {
  addCyl(gb, { cx: l.x, cz: l.z, r: 0.09, y0: l.y, y1: l.y + 6.8, color: 0x3b3f48 }, 5);
  const hx = l.x + l.dx * 1.3, hz = l.z + l.dz * 1.3;
  addBox(gb, { cx: (l.x + hx) / 2, cz: (l.z + hz) / 2, w: 1.4, d: 0.12, y0: l.y + 6.7, y1: l.y + 6.85, rot: Math.atan2(l.dz, l.dx) * -1, color: 0x3b3f48, roof: 'none' });
  addBox(gb, { cx: hx, cz: hz, w: 0.7, d: 0.32, y0: l.y + 6.6, y1: l.y + 6.72, rot: Math.atan2(l.dz, l.dx) * -1, color: 0xdfe3ea, roof: 'none' });
}

/** Feu tricolore : mât + boîtier tourné vers `facing`. */
export function addSignal(gb, p) {
  addCyl(gb, { cx: p.x, cz: p.z, r: 0.08, y0: p.y, y1: p.y + 4.2, color: 0x2d3139 }, 5);
  addBox(gb, { cx: p.x, cz: p.z, w: 0.14, d: 0.14, y0: p.y, y1: p.y + 0.1, color: 0x2d3139, roof: 'none' });
  addBox(gb, { cx: p.x + p.facing.x * 0.2, cz: p.z + p.facing.z * 0.2, w: 0.3, d: 0.5, y0: p.y + 3.0, y1: p.y + 4.2, rot: -Math.atan2(p.facing.z, p.facing.x), color: 0x1d2026, roof: 'flat' });
}

/** Projecteur de stade / parasol / poteau simples. */
export function addProp(gb, p) {
  if (p.kind === 'floodlight') {
    addCyl(gb, { cx: p.x, cz: p.z, r: 0.45, y0: p.y, y1: p.y + 30, color: 0x59606b }, 6);
    addBox(gb, { cx: p.x, cz: p.z, w: 4, d: 1.4, y0: p.y + 30, y1: p.y + 32, color: 0xf2f2f2, roof: 'flat' });
  } else if (p.kind === 'parasol') {
    addCyl(gb, { cx: p.x, cz: p.z, r: 0.06, y0: p.y, y1: p.y + 2.3, color: 0xdddddd }, 4);
    addCone(gb, p.x, p.z, 1.5, p.y + 2.0, p.y + 2.7, p.color ?? 0xff4fa3, 8);
  }
}
