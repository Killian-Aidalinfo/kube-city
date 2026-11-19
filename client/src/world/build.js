// Construction des maillages du monde : terrain, routes/trottoirs/marquages et bâtiments, fusionnés par chunk de 100 m.
import * as THREE from 'three';
import { GeoBuilder, addBox, addCyl, addTree, addLamp, addSignal, addProp, rgb } from './geom.js';
import { CHUNK, HALF, SW, CURB, XS, ZS, groundHeight, districtAt, shoreZ, WATER_LEVEL, mulberry32 } from './citygen.js';

const ROAD_Y = 0.03, MARK_Y = 0.05;
const ASPHALT = rgb(0x3a3c43), PAVE = rgb(0xb6b3ab), CURBC = rgb(0x8d8a84), WHITE = rgb(0xe9e9e4), YELLOW = rgb(0xe6b92c), ASPH2 = rgb(0x2f3138);

export const TERRAIN_CELLS = 223;       // 223 x 223 cases (~6,3 m), nombre premier : aucun sommet sur les rues rondes
export const TERRAIN_SIZE = 1400;

// ---- terrain
function terrainColor(x, z, h) {
  const n = 0.94 + 0.12 * (Math.sin(x * 0.11 + z * 0.07) * Math.sin(z * 0.13 - x * 0.05) * 0.5 + 0.5);
  const d = districtAt(x, z).key, outside = Math.abs(x) > 520 || z < -520;
  let c;
  const s = z - shoreZ(x);
  if (s > -55 && z > 300) c = s > 0 ? rgb(0xc9b27a) : s > -50 ? rgb(0xe6d3a0) : rgb(0xb8b5ac);   // sable puis fond marin
  else if (outside) c = rgb(0x6aa05a);
  else if (d === 'collines') c = h > 24 ? rgb(0x7fae5c) : rgb(0x5f9a4a);
  else if (d === 'centre') c = rgb(0x9b9ba2);
  else c = rgb(0x8d9096);
  if (s > 0) { const k = Math.min(1, s / 40); c = [c[0] * (1 - 0.55 * k), c[1] * (1 - 0.45 * k), c[2] * (1 - 0.3 * k)]; }
  return [c[0] * n, c[1] * n, c[2] * n];
}

export function buildTerrain(mat) {
  const N = TERRAIN_CELLS, step = TERRAIN_SIZE / N, pos = new Float32Array((N + 1) ** 2 * 3), col = new Float32Array((N + 1) ** 2 * 3), uv = new Float32Array((N + 1) ** 2 * 2);
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const k = j * (N + 1) + i, x = -TERRAIN_SIZE / 2 + i * step, z = -TERRAIN_SIZE / 2 + j * step, h = groundHeight(x, z), c = terrainColor(x, z, h);
    pos.set([x, h, z], k * 3); col.set(c, k * 3); uv.set([x / 14, z / 14], k * 2);
  }
  // 4 x 4 tuiles partageant les mêmes sommets : le frustum élimine celles qui ne sont pas à l'écran
  const attrs = { position: new THREE.BufferAttribute(pos, 3), color: new THREE.BufferAttribute(col, 3), uv: new THREE.BufferAttribute(uv, 2) };
  // normales calculées une fois sur la grille entière (pas de couture entre tuiles)
  const whole = new THREE.BufferGeometry();
  whole.setAttribute('position', attrs.position);
  const widx = new Uint32Array(N * N * 6);
  let q = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    widx.set([a, c, b, b, c, d], q); q += 6;
  }
  whole.setIndex(new THREE.BufferAttribute(widx, 1));
  whole.computeVertexNormals();
  attrs.normal = whole.getAttribute('normal');
  const T = 4, root = new THREE.Group(); root.name = 'terrain';
  for (let tj = 0; tj < T; tj++) for (let ti = 0; ti < T; ti++) {
    const i0 = Math.floor(ti * N / T), i1 = Math.floor((ti + 1) * N / T), j0 = Math.floor(tj * N / T), j1 = Math.floor((tj + 1) * N / T);
    const idx = new Uint32Array((i1 - i0) * (j1 - j0) * 6); let k = 0;
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      idx.set([a, c, b, b, c, d], k); k += 6;
    }
    const g = new THREE.BufferGeometry();
    for (const [n, at] of Object.entries(attrs)) g.setAttribute(n, at);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const x0 = -TERRAIN_SIZE / 2 + i0 * step, x1 = -TERRAIN_SIZE / 2 + i1 * step, z0 = -TERRAIN_SIZE / 2 + j0 * step, z1 = -TERRAIN_SIZE / 2 + j1 * step;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, 20, (z0 + z1) / 2), Math.hypot(x1 - x0, z1 - z0) / 2 + 60);
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true; m.matrixAutoUpdate = false;
    root.add(m);
  }
  return root;
}

/**
 * Jupe de terrain : anneau autour du maillage (même sol analytique, mêmes couleurs) qui prolonge le monde jusqu'à
 * la brume, pour que le bord ne s'arrête pas net sur la plaine. UN maillage, aucune collision (le mur invisible reste).
 */
export function buildSkirt(mat) {
  const E = TERRAIN_SIZE / 2, fine = [];
  for (let v = -E + 25; v < E - 1; v += 25) fine.push(v);
  const axis = [-1900, -1400, -1000, -820, -740, -E, ...fine, E, 740, 820, 1000, 1400, 1900], n = axis.length;
  const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, x = axis[i], z = axis[j], h = groundHeight(x, z);
    pos.set([x, h, z], k * 3); col.set(terrainColor(x, z, h), k * 3); uv.set([x / 14, z / 14], k * 2);
  }
  // seules les cases hors du terrain sont gardées
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const cx = (axis[i] + axis[i + 1]) / 2, cz = (axis[j] + axis[j + 1]) / 2;
    if (Math.abs(cx) < E && Math.abs(cz) < E) continue;
    const a = j * n + i;
    idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.name = 'jupe'; m.matrixAutoUpdate = false;
  return m;
}

/** Hauteurs pour le heightfield Rapier (même grille que le maillage) : tableau colonne-majeur (z en lignes). */
export function terrainHeights() {
  const N = TERRAIN_CELLS, step = TERRAIN_SIZE / N, h = new Float32Array((N + 1) ** 2);
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) h[i * (N + 1) + j] = groundHeight(-TERRAIN_SIZE / 2 + i * step, -TERRAIN_SIZE / 2 + j * step);
  return h; // index = colonne x (i) * (N+1) + ligne z (j)
}

// ---- chunks
const cKey = (x, z) => `${Math.floor((x + HALF) / CHUNK)},${Math.floor((z + HALF) / CHUNK)}`;

class Chunks {
  constructor() { this.map = new Map(); }
  get(x, z) {
    const k = cKey(x, z);
    let c = this.map.get(k);
    if (!c) {
      const [cx, cz] = k.split(',').map(Number);
      c = { key: k, cx, cz, road: new GeoBuilder(), bld: new GeoBuilder(), center: { x: -HALF + (cx + 0.5) * CHUNK, z: -HALF + (cz + 0.5) * CHUNK } };
      this.map.set(k, c);
    }
    return c;
  }
}

const up = [0, 1, 0];
/** Ruban le long d'une polyligne : bords gauche/droit à offsets (o0, o1) de l'axe, hauteur yo au-dessus du sol. */
function ribbon(city, chunks, pts, o0, o1, yo, color, opts = {}) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz); if (l < 0.01) continue; dx /= l; dz /= l;
    const nx = -dz, nz = dx;
    const P = (p, o, y = yo) => [p.x + nx * o, groundHeight(p.x + nx * o, p.z + nz * o) + y, p.z + nz * o];
    const ch = chunks.get((a.x + b.x) / 2, (a.z + b.z) / 2);
    const uvf = (p) => [p[0] / 9, p[2] / 9];
    const q = [P(a, o0), P(b, o0), P(b, o1), P(a, o1)];
    ch.road.quad(q, color, q.map(uvf), up);
    if (opts.curb) { // face verticale côté chaussée
      const inner = opts.curb > 0 ? o0 : o1, qq = [[a.x + nx * inner, groundHeight(a.x + nx * inner, a.z + nz * inner) + ROAD_Y, a.z + nz * inner], [b.x + nx * inner, groundHeight(b.x + nx * inner, b.z + nz * inner) + ROAD_Y, b.z + nz * inner], [b.x + nx * inner, groundHeight(b.x + nx * inner, b.z + nz * inner) + CURB, b.z + nz * inner], [a.x + nx * inner, groundHeight(a.x + nx * inner, a.z + nz * inner) + CURB, a.z + nz * inner]];
      ch.road.quad(qq, CURBC, qq.map(uvf), [-nx * opts.curb, 0, -nz * opts.curb]);
      if (opts.phys) opts.phys(qq);
    }
    if (opts.phys) opts.phys(q);
  }
}

function resample(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n });
  }
  return out;
}

/** Équipements de toit (groupes de clim, citerne, antenne) sur les toits plats des immeubles hauts : visuel seulement. */
function addRoofGear(gb, p) {
  const h = p.y1 - p.y0;
  if (h < 12 || p.w < 9 || p.d < 9 || p.rot) return;
  const r = mulberry32((Math.imul(Math.round(p.cx * 7) + 1013, 73856093) ^ Math.imul(Math.round(p.cz * 7) + 7919, 19349663)) >>> 0), top = p.y1;
  const place = (w, d, hh, color, fx = 0.5, fz = 0.5) => addBox(gb, { cx: p.cx + (fx - 0.5) * (p.w - w - 2), cz: p.cz + (fz - 0.5) * (p.d - d - 2), w, d, y0: top, y1: top + hh, color, win: false, roof: 'flat' });
  for (let k = 0, n = 1 + Math.floor(r() * 3); k < n; k++) place(1.8 + r() * 2.2, 1.8 + r() * 2.2, 1 + r() * 1.2, [0xa9adb3, 0x8f959d, 0xc2c5c9][Math.floor(r() * 3)], r(), r());
  if (h > 24 && r() < 0.6) place(3.4, 3.4, 2.8, 0x7d6a58, r(), r());                       // citerne / local technique
  if (h > 34) place(0.5, 0.5, 6 + r() * 8, 0x6b7078, 0.5, 0.5);                           // antenne
}

/** Construit tous les chunks. Renvoie { chunks: Map, physics: { sidewalkTris, ... } }. */
export function buildChunks(city) {
  const chunks = new Chunks(), g = city.roads;
  const swPos = [], swIdx = [];
  const phys = (q) => { const b = swPos.length / 3; for (const p of q) swPos.push(p[0], p[1], p[2]); swIdx.push(b, b + 2, b + 1, b, b + 3, b + 2); };
  // routes : rubans entre les carrefours + marquages
  for (const e of g.edges) {
    const sA = e.sA ?? 0, sB = e.sB ?? 0, hw = e.width / 2;
    if (e.len - sA - sB < 1) continue;
    const base = g.slice(e, sA, e.len - sB);
    const pts = resample(base, e.curved || Math.abs(g.nodes[e.a].y - g.nodes[e.b].y) > 1 ? 4 : 12);
    const road = e.kind === 'runway' ? ASPH2 : ASPHALT;
    ribbon(city, chunks, pts, -hw, hw, ROAD_Y, road);
    // marquages
    if (e.kind === 'runway') {
      ribbon(city, chunks, resample(g.slice(e, sA + 20, e.len - sB - 20), 12), -0.5, 0.5, MARK_Y, WHITE);
      for (let s = sA + 30; s < e.len - 40; s += 40) ribbon(city, chunks, [g.pointAt(e, s), g.pointAt(e, s + 20)], -0.5, 0.5, MARK_Y, WHITE);
      for (const end of [sA + 14, e.len - sB - 34]) for (let k = -5; k <= 5; k += 2) ribbon(city, chunks, [{ ...g.pointAt(e, end), z: g.pointAt(e, end).z + k * 2.2 }, { ...g.pointAt(e, end + 20), z: g.pointAt(e, end + 20).z + k * 2.2 }], -0.5, 0.5, MARK_Y, WHITE);
      continue;
    }
    const dash = (o, color, w = 0.14, on = 3, off = 5) => {
      for (let s = sA + 4; s < e.len - sB - on; s += on + off) ribbon(city, chunks, g.slice(e, s, s + on), o - w, o + w, MARK_Y, color);
    };
    const solid = (o, color, w = 0.14) => ribbon(city, chunks, pts, o - w, o + w, MARK_Y, color);
    if (e.kind === 'avenue') { solid(-0.25, YELLOW); solid(0.25, YELLOW); dash(-hw / 2, WHITE); dash(hw / 2, WHITE); solid(-hw + 0.5, WHITE); solid(hw - 0.5, WHITE); }
    else if (!e.oneway) dash(0, WHITE);
    else { dash(-e.width / 4, WHITE); dash(e.width / 4, WHITE); }
  }
  // carrefours : éventails
  for (const n of g.nodes) {
    const arms = n.arms || [];
    if (arms.length < 2) continue;
    const poly = [];
    for (const a of arms) {
      if (a.s < 0.5) continue;
      const px = -a.d.z, pz = a.d.x, bx = n.x + a.d.x * a.s, bz = n.z + a.d.z * a.s;
      poly.push({ x: bx + px * a.hw, z: bz + pz * a.hw }, { x: bx - px * a.hw, z: bz - pz * a.hw });
    }
    if (poly.length < 3) continue;
    poly.sort((p, q) => Math.atan2(p.z - n.z, p.x - n.x) - Math.atan2(q.z - n.z, q.x - n.x));
    const ch = chunks.get(n.x, n.z), c = [n.x, groundHeight(n.x, n.z) + ROAD_Y, n.z];
    const V = (p) => [p.x, groundHeight(p.x, p.z) + ROAD_Y, p.z];
    for (let k = 0; k < poly.length; k++) ch.road.tri([c, V(poly[k]), V(poly[(k + 1) % poly.length])], ASPHALT, up, [0.5, 0.5]);
  }
  // trottoirs : rubans + coins + passages piétons
  const { ribbons, quads, zebras } = city.sidewalks;
  for (const r of ribbons) {
    const e = g.edges[r.edge], hw = e.width / 2, pts = resample(g.slice(e, r.s0, r.s1), e.curved ? 4 : 12);
    const o0 = r.side > 0 ? hw : -hw - SW, o1 = r.side > 0 ? hw + SW : -hw;
    ribbon(city, chunks, pts, o0, o1, CURB, PAVE, { curb: r.side, phys });
  }
  const tcv = (p) => [p.x, groundHeight(p.x, p.z) + CURB, p.z];
  for (const q of quads) {
    const ch = chunks.get(q.pts[0].x, q.pts[0].z), p = q.pts.map(tcv);
    ch.road.quad(p, PAVE, p.map((v) => [v[0] / 9, v[2] / 9]), up); phys(p);
  }
  for (const zb of zebras) {
    const ux = -zb.dz, uz = zb.dx, n = Math.floor(zb.width / 1.1);
    for (let k = 0; k < n; k++) {
      const o = -zb.width / 2 + 0.8 + k * 1.1, cx = zb.x + ux * o, cz = zb.z + uz * o;
      ribbon(city, chunks, [{ x: cx - zb.dx * 1.6, z: cz - zb.dz * 1.6 }, { x: cx + zb.dx * 1.6, z: cz + zb.dz * 1.6 }], -0.25, 0.25, MARK_Y, WHITE);
    }
  }
  // bâtiments, arbres, lampadaires, feux
  for (const b of city.buildings) for (const p of b.parts) {
    const ch = chunks.get(b.x, b.z);
    if (p.t === 'box') { addBox(ch.bld, p); if (p.win && (p.roof ?? 'flat') === 'flat') addRoofGear(ch.bld, p); } else addCyl(ch.bld, p, 12);
  }
  for (const b of city.buildings) if (b.pitch) {
    const ch = chunks.get(b.x, b.z), { x, z, rx, rz, y } = b.pitch, c = rgb(0x4fae52), pts = [];
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; pts.push([x + Math.cos(a) * rx, y, z + Math.sin(a) * rz]); }
    for (let k = 0; k < 16; k++) ch.bld.tri([[x, y, z], pts[k], pts[(k + 1) % 16]], c, up);
  }
  for (const t of city.props) { const ch = chunks.get(t.x, t.z); if (t.kind === 'tree' || t.kind === 'palm') addTree(ch.bld, t); else addProp(ch.bld, t); }
  for (const l of city.lamps) addLamp(chunks.get(l.x, l.z).bld, l);
  for (const tl of city.trafficLights) for (const p of tl.poles) addSignal(chunks.get(p.x, p.z).bld, p);
  // estrade de la jetée, rampes
  const P = city.pier;
  const planks = rgb(0x9a7449);
  for (let z = P.z0; z < P.z1; z += 25) {
    const z2 = Math.min(z + 25, P.z1);
    addBox(chunks.get(P.x, (z + z2) / 2).bld, { cx: P.x, cz: (z + z2) / 2, w: P.width, d: z2 - z, y0: P.y - 0.3, y1: P.y, color: planks, roof: 'flat' });
  }
  for (let z = P.z0 + 6; z < P.z1; z += 10) for (const sx of [-1, 1]) addCyl(chunks.get(P.x, z).bld, { cx: P.x + sx * (P.width / 2 - 0.2), cz: z, r: 0.22, y0: -4, y1: P.y + 1.0, color: 0x6b5236 }, 5);
  for (const r of city.ramps) { const c2 = chunks.get(r.x, r.z); addRamp(c2.bld, r); }
  return { chunks, sidewalkMesh: { positions: new Float32Array(swPos), indices: new Uint32Array(swIdx) } };
}

/** Points d'une rampe (coin bas → haut) en repère monde : utile pour la géométrie et la collision. */
export function rampPoints(r) {
  const c = Math.cos(r.rotation), s = Math.sin(r.rotation), hw = r.width / 2, L = r.length / 2;
  // cap de montée = (sin rot, cos rot) ; le haut est à l'avant
  const fx = Math.sin(r.rotation), fz = Math.cos(r.rotation), rx = fz, rz = -fx;
  void c; void s;
  const P = (f, lat, h) => [r.x + fx * f + rx * lat, r.y + h, r.z + fz * f + rz * lat];
  return [P(-L, -hw, 0), P(-L, hw, 0), P(L, hw, 0), P(L, -hw, 0), P(L, -hw, r.height), P(L, hw, r.height)];
}
function addRamp(gb, r) {
  const [a, b, c, d, e, f] = rampPoints(r), col = rgb(0xe0b72a), side = rgb(0x555a63);
  gb.quad([a, b, f, e], col, undefined, [0, 1, 0]);
  gb.tri([a, e, d], side, [(a[0] - b[0]) * 1, 0, (a[2] - b[2]) * 1]); gb.tri([b, c, f], side, [b[0] - a[0], 0, b[2] - a[2]]);
  gb.quad([d, c, f, e], side, undefined, [e[0] - a[0], 0, e[2] - a[2]]);
  // bande de rappel (rayures sombres)
  const dk = rgb(0x2d2d32);
  for (let k = 1; k < 6; k += 2) {
    const t0 = k / 6, t1 = (k + 0.6) / 6, lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t + 0.02, p[2] + (q[2] - p[2]) * t];
    gb.quad([lerp(a, e, t0), lerp(b, f, t0), lerp(b, f, t1), lerp(a, e, t1)], dk, undefined, [0, 1, 0]);
  }
}

export { cKey, CHUNK, WATER_LEVEL, XS, ZS };
