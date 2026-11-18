// Génération déterministe de Kube City (graine fixe) : PUR, sans DOM ni Three.js.
// Importable par Node (serveur, tests) comme par le client : même ville partout.
// Repère : x vers l'est, z vers le sud (écran), y vers le haut. Un lacet « yaw » vaut atan2(dx, dz).

export const SIZE = 1200;
export const HALF = SIZE / 2;
export const CHUNK = 100;
export const SW = 3;              // largeur des trottoirs (m)
export const CURB = 0.18;         // hauteur des trottoirs (m)
export const WATER_LEVEL = -0.45;
export const SEED = 20261118;

// Lignes de la grille de rues (la dernière rangée en z est la promenade de la plage)
export const XS = [-500, -400, -300, -200, -100, 0, 100, 200, 300, 400, 500];
export const ZS = [-500, -400, -300, -200, -100, 0, 100, 200, 300, 380];

export const DISTRICTS = {
  centre: { name: 'Centre', key: 'centre', color: '#ff4fa3' },
  docks: { name: 'Docks', key: 'docks', color: '#f5a524' },
  collines: { name: 'Collines', key: 'collines', color: '#4ade80' },
  plage: { name: 'Plage', key: 'plage', color: '#38bdf8' },
  industrie: { name: 'Zone industrielle', key: 'industrie', color: '#a78bfa' },
};

// ---------------------------------------------------------------- utilitaires
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hash2 = (a, b, s = 0) => mulberry32((Math.imul(a + 1013, 73856093) ^ Math.imul(b + 7919, 19349663) ^ Math.imul(s + 31, 83492791)) >>> 0)();

// ---------------------------------------------------------------- terrain et quartiers
/** Rivage (z) en fonction de x : légèrement ondulé. */
export function shoreZ(x) { return 446 + 12 * Math.sin(x / 70) + 7 * Math.sin(x / 23 + 1); }

const BUMPS = [[-420, -300, 34, 170], [-330, -60, 16, 100], [-520, -480, 26, 110], [-250, -200, 12, 90]];
function hillHeight(x, z) {
  let h = 0;
  for (const [bx, bz, amp, sg] of BUMPS) h += amp * Math.exp(-((x - bx) ** 2 + (z - bz) ** 2) / (2 * sg * sg));
  return h * smooth(-160, -300, x) * (1 - smooth(40, 140, z));
}

/** Hauteur du sol (m) en (x, z) : plat en ville, collines à l'ouest, plage puis mer au sud. */
export function groundHeight(x, z) {
  let h = hillHeight(x, z);
  const s = z - shoreZ(x);
  if (s < 0) h = h * (1 - smooth(-60, -20, s)) - 0.35 * smooth(-40, 0, s);
  else h = -0.35 - 0.14 * Math.min(s, 70);
  return h;
}

export function isWaterAt(x, z) { return groundHeight(x, z) < WATER_LEVEL; }

/** Quartier en (x, z). */
export function districtAt(x, z) {
  if (z >= 300) return DISTRICTS.plage;
  if (x <= -200 && z < 100) return DISTRICTS.collines;
  if (x >= 100 && z < -100) return DISTRICTS.industrie;
  if (x >= 200 && z >= -100) return DISTRICTS.docks;
  return DISTRICTS.centre;
}

// ---------------------------------------------------------------- feux
export const LIGHT_CYCLE = 24; // s : axe ns vert 0-9, orange 9-11, rouge 11-24 ; axe ew vert 12-21, orange 21-23
/** État d'un feu pour un axe ('ns' | 'ew') à l'instant t (secondes). */
export function lightPhase(light, axis, t) {
  let p = (t + light.offset) % LIGHT_CYCLE;
  if (p < 0) p += LIGHT_CYCLE;
  if (axis === 'ew') p = (p + 12) % LIGHT_CYCLE;
  if (p < 9) return 'green';
  if (p < 11) return 'yellow';
  return 'red';
}

// ---------------------------------------------------------------- graphe routier
const segDist = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1) : 0;
  return { d: Math.hypot(px - (ax + t * dx), pz - (az + t * dz)), t, x: ax + t * dx, z: az + t * dz };
};

/** Graphe routier : nœuds (intersections) et arêtes (polylignes avec largeur, voies, sens, vitesse). */
export class RoadGraph {
  constructor(nodes = [], edges = [], ground = null) {
    this.nodes = nodes; this.edges = edges; this.ground = ground;
    this.CELL = 25;
    this.grid = new Map();
    for (const n of nodes) n.edges = [];
    for (const e of edges) {
      e.cum = [0];
      for (let i = 1; i < e.pts.length; i++) e.cum.push(e.cum[i - 1] + Math.hypot(e.pts[i].x - e.pts[i - 1].x, e.pts[i].z - e.pts[i - 1].z));
      e.len = e.cum[e.cum.length - 1];
      nodes[e.a].edges.push(e.id); nodes[e.b].edges.push(e.id);
      for (let i = 1; i < e.pts.length; i++) this._index(e, i - 1);
    }
  }
  _index(e, i) {
    const a = e.pts[i], b = e.pts[i + 1], m = e.width / 2 + 1, C = this.CELL;
    for (let cx = Math.floor((Math.min(a.x, b.x) - m) / C); cx <= Math.floor((Math.max(a.x, b.x) + m) / C); cx++) {
      for (let cz = Math.floor((Math.min(a.z, b.z) - m) / C); cz <= Math.floor((Math.max(a.z, b.z) + m) / C); cz++) {
        const k = cx * 4096 + cz; let l = this.grid.get(k);
        if (!l) this.grid.set(k, (l = []));
        l.push([e, i]);
      }
    }
  }
  /** Point, tangente et hauteur à l'abscisse curviligne s de l'arête e. */
  pointAt(e, s) {
    s = clamp(s, 0, e.len);
    let i = 1;
    while (i < e.cum.length - 1 && e.cum[i] < s) i++;
    const a = e.pts[i - 1], b = e.pts[i], l = e.cum[i] - e.cum[i - 1] || 1, t = (s - e.cum[i - 1]) / l;
    const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    return { x, y: this.ground ? this.ground(x, z) : 0, z, tx: (b.x - a.x) / l, tz: (b.z - a.z) / l };
  }
  /** Points de l'arête entre s0 et s1 (peut être inversé), sommets d'origine inclus. */
  slice(e, s0, s1) {
    const out = [this.pointAt(e, s0)];
    const up = s1 >= s0;
    if (up) { for (let i = 0; i < e.cum.length; i++) if (e.cum[i] > s0 + 0.01 && e.cum[i] < s1 - 0.01) out.push(this.pointAt(e, e.cum[i])); }
    else { for (let i = e.cum.length - 1; i >= 0; i--) if (e.cum[i] < s0 - 0.01 && e.cum[i] > s1 + 0.01) out.push(this.pointAt(e, e.cum[i])); }
    out.push(this.pointAt(e, s1));
    return out;
  }
  /** Ligne d'une voie : dir = +1 (a → b) ou -1, lane = 0 (voie la plus proche de l'axe), conduite à droite. */
  lanePoints(e, dir = 1, lane = 0) {
    const off = e.lanes > 1 ? (lane + 0.5) * (e.width / 2 / e.lanes) + e.width * 0.04 : e.width / 4;
    const pts = dir > 0 ? this.slice(e, 0, e.len) : this.slice(e, e.len, 0);
    return pts.map((p, i) => {
      const q = pts[Math.min(i + 1, pts.length - 1)], r = pts[Math.max(i - 1, 0)];
      let fx = q.x - r.x, fz = q.z - r.z; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
      const x = p.x - fz * off, z = p.z + fx * off;
      return { x, y: p.y, z };
    });
  }
  /** Arêtes sortantes d'un nœud : [{ edge, to, dir, cost(s) }] en respectant les sens uniques. */
  neighbors(nodeId) {
    const out = [];
    for (const id of this.nodes[nodeId].edges) {
      const e = this.edges[id];
      if (e.a === nodeId) out.push({ edge: e, to: e.b, dir: 1, cost: e.len / (e.speed / 3.6) });
      else if (!e.oneway) out.push({ edge: e, to: e.a, dir: -1, cost: e.len / (e.speed / 3.6) });
    }
    return out;
  }
  /** Point de route le plus proche : { edge, s, x, y, z, dist } (ou null). */
  nearest(x, z, maxRings = 40) {
    const C = this.CELL, cx0 = Math.floor(x / C), cz0 = Math.floor(z / C);
    let best = null;
    for (let r = 0; r <= maxRings; r++) {
      for (let cx = cx0 - r; cx <= cx0 + r; cx++) {
        for (let cz = cz0 - r; cz <= cz0 + r; cz++) {
          if (Math.max(Math.abs(cx - cx0), Math.abs(cz - cz0)) !== r) continue;
          const l = this.grid.get(cx * 4096 + cz);
          if (!l) continue;
          for (const [e, i] of l) {
            const a = e.pts[i], b = e.pts[i + 1], q = segDist(x, z, a.x, a.z, b.x, b.z);
            if (!best || q.d < best.dist) best = { edge: e, s: e.cum[i] + q.t * (e.cum[i + 1] - e.cum[i]), x: q.x, z: q.z, dist: q.d };
          }
        }
      }
      if (best && best.dist <= r * C) break;
    }
    if (best) best.y = this.ground ? this.ground(best.x, best.z) : 0;
    return best;
  }
  /** Vrai si (x, z) est sur la chaussée. */
  isRoad(x, z) {
    const l = this.grid.get(Math.floor(x / this.CELL) * 4096 + Math.floor(z / this.CELL));
    if (!l) return false;
    for (const [e, i] of l) {
      const a = e.pts[i], b = e.pts[i + 1];
      if (segDist(x, z, a.x, a.z, b.x, b.z).d <= e.width / 2) return true;
    }
    return false;
  }
  /** Nœud le plus proche. */
  nearestNode(x, z) {
    let best = null, bd = Infinity;
    for (const n of this.nodes) { const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = n; } }
    return best;
  }
  /** Chemin de nœuds (Dijkstra, coût = temps) d'un nœud à un autre ; renvoie [{ node, edge, dir }] ou null. */
  nodePath(from, to) {
    const r = this._dijkstra([[from, 0]]);
    if (!isFinite(r.dist[to])) return null;
    return this._unwind(r, to);
  }
  _dijkstra(sources) {
    const n = this.nodes.length, dist = new Array(n).fill(Infinity), prev = new Array(n).fill(null), done = new Array(n).fill(false);
    for (const [id, c] of sources) if (c < dist[id]) dist[id] = c;
    for (;;) {
      let u = -1, bd = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; u = i; }
      if (u < 0) break;
      done[u] = true;
      for (const nb of this.neighbors(u)) {
        const c = bd + nb.cost;
        if (c < dist[nb.to]) { dist[nb.to] = c; prev[nb.to] = { from: u, edge: nb.edge, dir: nb.dir }; }
      }
    }
    return { dist, prev };
  }
  _unwind(r, to) {
    const steps = [];
    for (let v = to; r.prev[v]; v = r.prev[v].from) steps.push({ from: r.prev[v].from, to: v, edge: r.prev[v].edge, dir: r.prev[v].dir });
    return steps.reverse();
  }
  /** Itinéraire de `from` à `to` ({x,z}) sur le réseau : points [{x,y,z}] (ou 2 points si aucun chemin). */
  route(from, to) {
    const a = this.nearest(from.x, from.z), b = this.nearest(to.x, to.z);
    const P = (p) => ({ x: p.x, y: this.ground ? this.ground(p.x, p.z) : 0, z: p.z });
    if (!a || !b) return [P(from), P(to)];
    const ea = a.edge, eb = b.edge, sp = (e) => e.speed / 3.6;
    const push = (out, pts) => { for (const p of pts) { const l = out[out.length - 1]; if (!l || Math.hypot(l.x - p.x, l.z - p.z) > 0.4) out.push({ x: p.x, y: p.y, z: p.z }); } };
    const direct = ea === eb && (!ea.oneway || b.s >= a.s);
    // sources : sorties de l'arête de départ ; cibles : entrées de l'arête d'arrivée
    const src = [[ea.b, (ea.len - a.s) / sp(ea)]];
    if (!ea.oneway) src.push([ea.a, a.s / sp(ea)]);
    const r = this._dijkstra(src);
    const ends = [[eb.a, b.s / sp(eb), 1]];
    if (!eb.oneway) ends.push([eb.b, (eb.len - b.s) / sp(eb), -1]);
    let bestEnd = null, bc = Infinity;
    for (const [id, c, dir] of ends) { const t = r.dist[id] + c; if (t < bc) { bc = t; bestEnd = { id, dir }; } }
    const out = [P(from)];
    if (direct && (!bestEnd || Math.abs(a.s - b.s) / sp(ea) <= bc)) {
      push(out, this.slice(ea, a.s, b.s)); push(out, [P(to)]); return out;
    }
    if (!bestEnd) return [P(from), P(to)];
    const steps = this._unwind(r, bestEnd.id);
    const firstNode = steps.length ? steps[0].from : bestEnd.id;
    push(out, this.slice(ea, a.s, firstNode === ea.b ? ea.len : 0));
    for (const st of steps) push(out, st.dir > 0 ? this.slice(st.edge, 0, st.edge.len) : this.slice(st.edge, st.edge.len, 0));
    push(out, this.slice(eb, bestEnd.dir > 0 ? 0 : eb.len, b.s));
    push(out, [P(to)]);
    return out;
  }
  /** Vrai si le graphe est fortement connexe (tous les nœuds s'atteignent). */
  isStronglyConnected() {
    const reach = (rev) => {
      const seen = new Set([0]), q = [0];
      while (q.length) {
        const u = q.pop();
        for (const id of this.nodes[u].edges) {
          const e = this.edges[id];
          const other = e.a === u ? e.b : e.a;
          const ok = rev ? (e.oneway ? e.a === other : true) : (e.oneway ? e.a === u : true);
          if (ok && !seen.has(other)) { seen.add(other); q.push(other); }
        }
      }
      return seen.size === this.nodes.length;
    };
    return reach(false) && reach(true);
  }
}

const lineKind = (axis, c) => {
  if (axis === 'x') return [-300, 0, 300].includes(c) ? 'avenue' : 'street';  // route à x constant
  if (c === 380) return 'promenade';
  return [-300, 0].includes(c) ? 'avenue' : 'street';                           // route à z constant
};
const KIND = {
  avenue: { width: 15, lanes: 2, speed: 70 },
  street: { width: 10, lanes: 1, speed: 50 },
  colline: { width: 8.5, lanes: 1, speed: 40 },
  promenade: { width: 11, lanes: 1, speed: 35 },
  corniche: { width: 11, lanes: 1, speed: 60 },
  runway: { width: 30, lanes: 1, speed: 120 },
};

function buildGraph() {
  const nodes = [], edges = [], at = new Map();
  const addNode = (x, z) => { const n = { id: nodes.length, x, z, y: groundHeight(x, z) }; nodes.push(n); at.set(`${x},${z}`, n); return n; };
  for (const z of ZS) for (const x of XS) addNode(x, z);
  const addEdge = (na, nb, kind, pts, extra = {}) => {
    const k = KIND[kind];
    edges.push({ id: edges.length, a: na.id, b: nb.id, kind, width: k.width, lanes: k.lanes, speed: k.speed, oneway: false, curved: pts.length > 2, sidewalk: kind !== 'runway', pts, ...extra });
  };
  const straight = (a, b) => [{ x: a.x, z: a.z }, { x: b.x, z: b.z }];
  const bow = (a, b, amp, sign) => {
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz), nx = -dz / l, nz = dx / l, pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10, o = sign * (amp * Math.sin(Math.PI * t) + 0.35 * amp * Math.sin(2 * Math.PI * t));
      pts.push({ x: a.x + dx * t + nx * o, z: a.z + dz * t + nz * o });
    }
    return pts;
  };
  const hill = (a, b) => districtAt(a.x, a.z).key === 'collines' && districtAt(b.x, b.z).key === 'collines' && a.x <= -300 && b.x <= -300 && a.z <= 0 && b.z <= 0;
  const edgeAt = (a, b, axis, c) => {
    if (hill(a, b)) { addEdge(a, b, 'colline', bow(a, b, 12, hash2(a.x + b.x, a.z + b.z) < 0.5 ? 1 : -1)); return; }
    addEdge(a, b, lineKind(axis, c), straight(a, b));
  };
  for (let j = 0; j < ZS.length; j++) {
    for (let i = 0; i < XS.length; i++) {
      const n = at.get(`${XS[i]},${ZS[j]}`);
      if (i + 1 < XS.length) edgeAt(n, at.get(`${XS[i + 1]},${ZS[j]}`), 'z', ZS[j]);
      if (j + 1 < ZS.length) edgeAt(n, at.get(`${XS[i]},${ZS[j + 1]}`), 'x', XS[i]);
    }
  }
  // routes non orthogonales : corniche et diagonale du Centre
  for (const [ax, az, bx, bz, k] of [[-500, 300, -400, 380, 'corniche'], [400, 300, 500, 380, 'corniche'], [-200, 100, -100, 200, 'corniche']]) {
    const a = at.get(`${ax},${az}`), b = at.get(`${bx},${bz}`);
    addEdge(a, b, k, bow(a, b, 6, 1));
  }
  // aéroport : bretelles et piste (grandes lignes droites, vitesse élevée)
  const r1 = addNode(100, -560), r2 = addNode(500, -560);
  addEdge(at.get('100,-500'), r1, 'street', straight(at.get('100,-500'), r1), { sidewalk: false });
  addEdge(at.get('500,-500'), r2, 'street', straight(at.get('500,-500'), r2), { sidewalk: false });
  addEdge(r1, r2, 'runway', straight(r1, r2));
  // sens uniques dans le Centre (deux rues parallèles)
  for (const e of edges) {
    const a = nodes[e.a], b = nodes[e.b];
    if (e.kind !== 'street' || a.z !== b.z || Math.abs(a.x) > 200 || Math.abs(b.x) > 200) continue;
    if (a.z === -200) e.oneway = true;                                        // vers l'est (a → b)
    else if (a.z === 100) { e.oneway = true; [e.a, e.b] = [e.b, e.a]; e.pts.reverse(); } // vers l'ouest
  }
  return new RoadGraph(nodes, edges, groundHeight);
}

// ---------------------------------------------------------------- trottoirs (graphe piéton + géométrie)
function buildSidewalks(g) {
  const corners = new Map();       // `${node}:${k}` → coin
  const nodesOut = [], edgesOut = [], quads = [], ribbons = [], zebras = [];
  const armsOf = [];
  for (const n of g.nodes) {
    const arms = n.edges.map((id) => {
      const e = g.edges[id], atA = e.a === n.id, s = Math.min(8, e.len / 2);
      const p = g.pointAt(e, atA ? s : e.len - s);
      let dx = p.x - n.x, dz = p.z - n.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      return { edge: e, atA, d: { x: dx, z: dz }, hw: e.width / 2, ang: Math.atan2(dz, dx), bearing: e.kind !== 'runway' };
    }).sort((a, b) => a.ang - b.ang);
    armsOf.push(arms);
    // retrait de la chaussée de chaque bras (carrefour carré/polygonal)
    arms.forEach((a, i) => {
      let s = 0;
      arms.forEach((b, j) => { if (i === j) return; const sn = Math.abs(a.d.x * b.d.z - a.d.z * b.d.x); if (sn > 0.3) s = Math.max(s, b.hw / sn); });
      a.s = arms.length > 1 ? s : 0;
      if (a.atA) a.edge.sA = a.s; else a.edge.sB = a.s;
    });
    n.arms = arms;
  }
  for (const n of g.nodes) {
    const arms = n.arms.filter((a) => a.bearing);
    n.swArms = arms;
    if (arms.length < 2) continue;
    arms.forEach((a, k) => {
      const b = arms[(k + 1) % arms.length];
      let gap = b.ang - a.ang; if (gap <= 0) gap += Math.PI * 2;
      if (arms.length === 2 && gap > Math.PI * 1.9) return;
      const hw = (a.hw + b.hw) / 2, half = clamp(gap / 2, 0.3, Math.PI - 0.3), ba = a.ang + gap / 2;
      const at = (off) => { const m = off / Math.sin(half); return { x: n.x + Math.cos(ba) * m, z: n.z + Math.sin(ba) * m }; };
      const inner = at(hw), mid = at(hw + SW / 2), outer = at(hw + SW);
      const proj = (p, arm) => (p.x - n.x) * arm.d.x + (p.z - n.z) * arm.d.z;
      const La = { x: -a.d.z, z: a.d.x }, Rb = { x: b.d.z, z: -b.d.x };
      const oa = { x: inner.x + La.x * SW, z: inner.z + La.z * SW };
      const ob = { x: inner.x + Rb.x * SW, z: inner.z + Rb.z * SW };
      const c = { id: nodesOut.length, node: n.id, k, x: mid.x, z: mid.z, y: groundHeight(mid.x, mid.z) + CURB, sA: proj(inner, a), sB: proj(inner, b), armA: a, armB: b };
      corners.set(`${n.id}:${k}`, c); nodesOut.push(c);
      if (gap < Math.PI * 1.2) quads.push({ node: n.id, pts: [inner, oa, outer, ob] });
    });
  }
  const idxOf = (n, arm) => n.swArms.indexOf(arm);
  for (const e of g.edges) {
    if (!e.sidewalk) continue;
    const A = g.nodes[e.a], B = g.nodes[e.b];
    const aa = A.swArms?.find((x) => x.edge === e && x.atA), bb = B.swArms?.find((x) => x.edge === e && !x.atA);
    if (!aa || !bb) continue;
    const kA = idxOf(A, aa), kB = idxOf(B, bb), nA = A.swArms.length, nB = B.swArms.length;
    const sides = [
      { side: 1, c0: corners.get(`${A.id}:${kA}`), c1: corners.get(`${B.id}:${(kB - 1 + nB) % nB}`), s0: (c) => c?.sA, s1: (c) => c?.sB },
      { side: -1, c0: corners.get(`${A.id}:${(kA - 1 + nA) % nA}`), c1: corners.get(`${B.id}:${kB}`), s0: (c) => c?.sB, s1: (c) => c?.sA },
    ];
    for (const sd of sides) {
      if (!sd.c0 || !sd.c1) continue;
      const s0 = sd.s0(sd.c0), s1 = e.len - sd.s1(sd.c1);
      if (s1 - s0 < 2) continue;
      ribbons.push({ edge: e.id, side: sd.side, s0, s1 });
      const mid = g.slice(e, s0, s1).map((p, i, arr) => {
        const q = arr[Math.min(i + 1, arr.length - 1)], r = arr[Math.max(i - 1, 0)];
        let tx = q.x - r.x, tz = q.z - r.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        const off = sd.side * (e.width / 2 + SW / 2);
        return { x: p.x - tz * off, z: p.z + tx * off };
      });
      const pts = [{ x: sd.c0.x, z: sd.c0.z }, ...mid.slice(1, -1), { x: sd.c1.x, z: sd.c1.z }];
      edgesOut.push({ id: edgesOut.length, a: sd.c0.id, b: sd.c1.id, pts, kind: 'walk', roadEdge: e.id, side: sd.side });
    }
  }
  // passages piétons à travers chaque bras des carrefours à 3 branches ou plus
  for (const n of g.nodes) {
    const arms = n.swArms || [];
    if (arms.length < 3) continue;
    arms.forEach((a, k) => {
      const c0 = corners.get(`${n.id}:${(k - 1 + arms.length) % arms.length}`), c1 = corners.get(`${n.id}:${k}`);
      if (!c0 || !c1 || a.edge.kind === 'runway') return;
      edgesOut.push({ id: edgesOut.length, a: c0.id, b: c1.id, pts: [{ x: c0.x, z: c0.z }, { x: c1.x, z: c1.z }], kind: 'crossing', roadEdge: a.edge.id });
      zebras.push({ node: n.id, x: n.x + a.d.x * (a.s + 2.2), z: n.z + a.d.z * (a.s + 2.2), dx: a.d.x, dz: a.d.z, width: a.hw * 2 });
    });
  }
  return { nodes: nodesOut.map(({ armA, armB, sA, sB, ...c }) => c), edges: edgesOut, quads, ribbons, zebras };
}

// ---------------------------------------------------------------- feux tricolores
function buildLights(g) {
  const lights = [];
  for (const n of g.nodes) {
    const arms = n.swArms || [];
    const major = arms.filter((a) => a.edge.kind !== 'runway');
    if (major.length < 3 || n.z > 300 && n.z < 380) continue;
    const hmax = Math.max(...major.map((a) => a.hw));
    const L = { id: lights.length, node: n.id, x: n.x, y: n.y, z: n.z, offset: ((n.x + 600) / 100 * 5 + (n.z + 600) / 100 * 7) % LIGHT_CYCLE, poles: [] };
    for (const a of major) {
      const rx = a.d.z, rz = -a.d.x;                      // droite d'un véhicule qui arrive (il roule vers -d)
      const dist = a.s + 1.5, lat = a.hw + 1.2;
      const x = n.x + a.d.x * dist + rx * lat, z = n.z + a.d.z * dist + rz * lat;
      const axis = Math.abs(a.d.x) > Math.abs(a.d.z) ? 'ew' : 'ns';
      L.poles.push({
        x, y: groundHeight(x, z) + CURB, z, axis, facing: { x: a.d.x, z: a.d.z }, edge: a.edge.id,
        stop: { x: n.x + a.d.x * (a.s + 3) + rx * (a.hw / 2), z: n.z + a.d.z * (a.s + 3) + rz * (a.hw / 2) },
      });
    }
    lights.push(L);
  }
  return lights;
}

// ---------------------------------------------------------------- bâtiments et lieux
const PAL = {
  centre: [0xe8d5c4, 0xc9d6e8, 0xd8c0d8, 0xf2e2b6, 0xb8c4d6, 0xe3b5a4, 0xa9b9a2],
  docks: [0xc77d4a, 0x5b7f9a, 0x8aa05a, 0xb8b8b8, 0xa05a4a],
  industrie: [0xb0b7c2, 0x8b94a3, 0xcbd2dc, 0x9aa7a0],
  villa: [0xf4ece0, 0xf0d9c0, 0xe8e0d0, 0xd9ead8, 0xf2d4cf],
  roof: [0xc9552f, 0x8c4a3a, 0xa04a30, 0x6f5a50],
  plage: [0xffd6a5, 0xa0e7e5, 0xffaebc, 0xfbe7c6, 0xcdb4db],
  container: [0xd9482b, 0x2b7bd9, 0xe0b72a, 0x2f9e6b, 0x8a4fd9, 0xdadada],
};
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];

const box = (cx, cz, w, d, y0, y1, color, o = {}) => ({ t: 'box', cx, cz, w, d, y0, y1, color, win: false, roof: 'flat', rot: 0, ...o });
const cyl = (cx, cz, r, y0, y1, color, o = {}) => ({ t: 'cyl', cx, cz, r, y0, y1, color, ...o });

const RAMPS = [
  { id: 'zone', x: 125, z: -350, rotation: Math.PI / 2, length: 16, width: 7, height: 3 },
  { id: 'zone2', x: 175, z: -350, rotation: -Math.PI / 2, length: 16, width: 7, height: 3 },
  { id: 'plage', x: -100, z: 410, rotation: 0, length: 16, width: 8, height: 3 },
  { id: 'docks', x: 380, z: 130, rotation: -Math.PI / 2, length: 16, width: 7, height: 3 },
  { id: 'collines', x: -440, z: -130, rotation: Math.PI / 2, length: 14, width: 7, height: 2.5 },
];

function generateStructures(g) {
  const buildings = [], props = [], neon = [], reserved = [], places = {};
  let datacenter = null;
  const rngB = (i, j, s = 0) => mulberry32((Math.imul(i + 3, 2654435761) ^ Math.imul(j + 11, 40503) ^ (SEED + s)) >>> 0);
  const gh = groundHeight;
  const lw = (axis, c) => KIND[lineKind(axis, c)].width;
  const gmin = (x0, z0, x1, z1) => Math.min(gh(x0, z0), gh(x1, z0), gh(x0, z1), gh(x1, z1), gh((x0 + x1) / 2, (z0 + z1) / 2));
  const gmax = (x0, z0, x1, z1) => Math.max(gh(x0, z0), gh(x1, z0), gh(x0, z1), gh(x1, z1), gh((x0 + x1) / 2, (z0 + z1) / 2));
  const overlaps = (x0, z0, x1, z1, pad = 0) => reserved.some((r) => x0 < r.x1 + pad && x1 > r.x0 - pad && z0 < r.z1 + pad && z1 > r.z0 - pad);
  const reserve = (x0, z0, x1, z1) => reserved.push({ x0, z0, x1, z1 });
  const curved = g.edges.filter((e) => e.curved && e.kind !== 'runway');
  const nearCurve = (x0, z0, x1, z1) => curved.some((e) => {
    const m = e.width / 2 + SW + 0.5;
    for (let s = 0; s <= e.len; s += 4) { const p = g.pointAt(e, s); if (p.x > x0 - m && p.x < x1 + m && p.z > z0 - m && p.z < z1 + m) return true; }
    return false;
  });
  /** Ajoute un bâtiment : parts = boîtes/cylindres ; colliders déduits sauf si fournis. */
  const add = (district, kind, cx, cz, w, d, parts, extra = {}) => {
    const b = { id: buildings.length, kind, district, x: cx, z: cz, w, d, parts, ...extra };
    b.h = Math.max(...parts.map((p) => p.y1)) - Math.min(...parts.map((p) => p.y0));
    buildings.push(b); return b;
  };
  const sideWalkPoint = (i, j, side) => { // milieu du trottoir d'un côté d'un bloc
    const x0 = XS[i], x1 = XS[i + 1], z0 = ZS[j], z1 = ZS[j + 1];
    const hx = (a) => lw('x', a) / 2 + SW / 2, hz = (a) => lw('z', a) / 2 + SW / 2;
    if (side === 'n') return { x: (x0 + x1) / 2, z: z0 + hz(z0) };
    if (side === 's') return { x: (x0 + x1) / 2, z: z1 - hz(z1) };
    if (side === 'w') return { x: x0 + hx(x0), z: (z0 + z1) / 2 };
    return { x: x1 - hx(x1), z: (z0 + z1) / 2 };
  };
  const place = (key, label, p, extra = {}) => { places[key] = { label, position: { x: p.x, y: gh(p.x, p.z) + CURB, z: p.z }, ...extra }; };
  const blockRect = (i, j) => {
    const x0 = XS[i] + lw('x', XS[i]) / 2 + SW + 1, x1 = XS[i + 1] - lw('x', XS[i + 1]) / 2 - SW - 1;
    const z0 = ZS[j] + lw('z', ZS[j]) / 2 + SW + 1, z1 = ZS[j + 1] - lw('z', ZS[j + 1]) / 2 - SW - 1;
    return { x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 };
  };
  const tree = (x, z, kind = 'tree', s = 1) => props.push({ kind, x, z, y: gh(x, z), s, rot: (x * 7 + z * 13) % 6.28 });

  // ---- lieux spéciaux (réservent leur emprise)
  const special = () => {
    // Mairie (bloc 5,4) : bâtiment à tour d'horloge au fond d'une place
    let r = blockRect(5, 4); reserve(r.x0, r.z0, r.x1, r.z1);
    let y = gh(r.cx, r.cz);
    add('centre', 'mairie', r.cx, r.cz - 14, 60, 26, [
      box(r.cx, r.cz - 14, 60, 26, y - 1, y + 16, 0xefe6d2, { win: true }),
      box(r.cx, r.cz - 14, 16, 16, y + 16, y + 40, 0xe2d6bc, { win: true, roof: 'pyr', roofH: 9, roofColor: 0x3d6b6b }),
      box(r.cx, r.cz + 1.2, 28, 3, y, y + 3, 0xd8ccb2),
    ]);
    add('centre', 'fontaine', r.cx, r.cz + 22, 12, 12, [cyl(r.cx, r.cz + 22, 6, y - 0.5, y + 0.9, 0xc9d3d8), cyl(r.cx, r.cz + 22, 1, y, y + 3.2, 0xe3eef2)], { colliders: [{ cx: r.cx, cz: r.cz + 22, hw: 6, hd: 6, y0: y - 0.5, y1: y + 0.9 }] });
    for (let k = -3; k <= 3; k++) { tree(r.cx + k * 12, r.cz + 38); tree(r.cx + k * 12, r.cz + 6); }
    place('mairie', 'Mairie', sideWalkPoint(5, 4, 's'));
    // Commissariat (bloc 3,5)
    r = blockRect(3, 5); y = gh(r.cx, r.cz); reserve(r.cx - 28, r.cz - 20, r.cx + 28, r.cz + 20);
    add('centre', 'commissariat', r.cx, r.cz, 50, 30, [
      box(r.cx, r.cz, 50, 30, y - 1, y + 14, 0x8fa6c6, { win: true }), box(r.cx, r.cz + 15.3, 50, 1.2, y + 10, y + 12, 0x2c5fd0),
      box(r.cx + 18, r.cz, 6, 6, y + 14, y + 24, 0x6f87a8, { roof: 'pyr', roofH: 3, roofColor: 0x2c5fd0 }),
    ]);
    place('commissariat', 'Commissariat', { x: r.cx, z: r.cz + 26 > r.z1 ? r.z1 + 2 : r.cz + 26 });
    // Hôpital (bloc 6,5)
    r = blockRect(6, 5); y = gh(r.cx, r.cz); reserve(r.cx - 32, r.cz - 22, r.cx + 32, r.cz + 22);
    add('centre', 'hopital', r.cx, r.cz, 60, 36, [
      box(r.cx, r.cz, 60, 36, y - 1, y + 22, 0xf2f4f6, { win: true }),
      box(r.cx, r.cz + 18.4, 12, 0.8, y + 14, y + 20, 0xd93a3a), box(r.cx, r.cz + 18.4, 4, 0.9, y + 12, y + 22, 0xd93a3a),
      box(r.cx - 20, r.cz, 14, 14, y + 22, y + 22.6, 0x3a7bd9),
    ]);
    place('hopital', 'Hôpital', { x: r.cx, z: r.cz + 28 > r.z1 ? r.z1 + 2 : r.cz + 28 });
    // Garage « Chez Lou » (bloc 2,6)
    r = blockRect(2, 6); y = gh(r.cx, r.cz); reserve(r.cx - 22, r.cz - 20, r.cx + 22, r.cz + 20);
    add('centre', 'garage', r.cx, r.cz - 6, 34, 20, [
      box(r.cx, r.cz - 6, 34, 20, y - 1, y + 8, 0xf2b84b, { win: true, roof: 'gable', roofH: 3, roofColor: 0x6b4a2a }),
      box(r.cx - 8, r.cz + 4.4, 12, 0.6, y, y + 5, 0x3a3f4a),
    ]);
    place('garage', 'Garage « Chez Lou »', sideWalkPoint(2, 6, 's'));
    // Boutique de vêtements (bloc 4,3)
    r = blockRect(4, 3); y = gh(r.cx, r.cz); reserve(r.cx - 14, r.cz - 12, r.cx + 14, r.cz + 12);
    add('centre', 'boutique', r.cx, r.cz, 24, 18, [box(r.cx, r.cz, 24, 18, y - 1, y + 9, 0xffb5d4, { win: true }), box(r.cx, r.cz + 9.3, 18, 0.6, y + 3.5, y + 5, 0xff4fa3)]);
    neon.push({ x: r.cx, y: y + 4.2, z: r.cz + 10, color: '#ff4fa3', size: 12 });
    place('boutique', 'Boutique de vêtements', { x: r.cx, z: r.cz + 9 + 3 > r.z1 ? r.z1 : r.cz + 12 });
    // Stade (bloc 1,7)
    r = blockRect(1, 7); reserve(r.x0, r.z0, r.x1, r.z1);
    y = gh(r.cx, r.cz);
    const rx = 36, rz = 28, seats = [];
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2, px = r.cx + Math.cos(a) * rx, pz = r.cz + Math.sin(a) * rz;
      seats.push(box(px, pz, 15, 7, y - 1, y + 7 + (k % 3) * 0.6, k % 2 ? 0xc9d4e2 : 0xe2c9c9, { rot: -(a + Math.PI / 2) }));
    }
    add('centre', 'stade', r.cx, r.cz, 90, 70, seats, { colliders: seats.map((s) => ({ cx: s.cx, cz: s.cz, hw: s.w / 2, hd: s.d / 2, y0: y - 1, y1: s.y1, rot: s.rot })), pitch: { x: r.cx, z: r.cz, rx: rx - 7, rz: rz - 5, y: y + 0.05 } });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      props.push({ kind: 'floodlight', x: r.cx + sx * 44, z: r.cz + sz * 33, y: gh(r.cx, r.cz), s: 1, rot: 0 });
    }
    place('stade', 'Stade', sideWalkPoint(1, 7, 'n'));
    // Belvédère (bloc 1,1) : plateforme sur le sommet des collines
    r = blockRect(1, 1); reserve(r.cx - 15, r.cz - 15, r.cx + 15, r.cz + 15);
    y = gh(r.cx, r.cz);
    add('collines', 'belvedere', r.cx, r.cz, 22, 22, [
      box(r.cx, r.cz, 22, 22, y - 2, y + 1.2, 0xcfc4b0), box(r.cx - 10, r.cz, 0.4, 22, y + 1.2, y + 2.4, 0x6b5a48), box(r.cx + 10, r.cz, 0.4, 22, y + 1.2, y + 2.4, 0x6b5a48),
      box(r.cx, r.cz + 10, 22, 0.4, y + 1.2, y + 2.4, 0x6b5a48), box(r.cx, r.cz - 10, 22, 0.4, y + 1.2, y + 2.4, 0x6b5a48),
      box(r.cx, r.cz - 4, 8, 6, y + 1.2, y + 5.4, 0xe0c9a6, { roof: 'pyr', roofH: 2, roofColor: 0xc9552f }),
    ], { colliders: [{ cx: r.cx, cz: r.cz, hw: 11, hd: 11, y0: y - 2, y1: y + 1.2 }] });
    places.belvedere = { label: 'Belvédère', position: { x: r.cx, y: y + 1.2, z: r.cz + 6 } };
    // Port (bloc 8,6) : grues, hangar, conteneurs
    r = blockRect(8, 6); reserve(r.x0, r.z0, r.x1, r.z1); y = gh(r.cx, r.cz);
    const rp = rngB(8, 6);
    add('docks', 'hangar', r.cx, r.z0 + 16, 64, 26, [box(r.cx, r.z0 + 16, 64, 26, y - 1, y + 11, 0x5b7f9a, { roof: 'gable', roofH: 3, roofColor: 0x3d566b })]);
    for (const dz of [-8, 12]) {
      const cx = r.cx + (dz < 0 ? -14 : 14), cz = r.z1 - 18 + dz * 0.2;
      add('docks', 'grue', cx, cz, 12, 40, [
        box(cx - 5, cz - 17, 1.4, 1.4, y, y + 28, 0xf5a524), box(cx + 5, cz - 17, 1.4, 1.4, y, y + 28, 0xf5a524),
        box(cx - 5, cz + 17, 1.4, 1.4, y, y + 28, 0xf5a524), box(cx + 5, cz + 17, 1.4, 1.4, y, y + 28, 0xf5a524),
        box(cx, cz, 12, 44, y + 28, y + 30, 0xe06b1d), box(cx, cz, 4, 6, y + 24, y + 28, 0x2d3748),
      ], { colliders: [[-5, -17], [5, -17], [-5, 17], [5, 17]].map(([ox, oz]) => ({ cx: cx + ox, cz: cz + oz, hw: 0.7, hd: 0.7, y0: y, y1: y + 28 })) });
    }
    containerYard(add, r.x0 + 4, r.z0 + 36, r.x1 - 4, r.z1 - 4, y, rp, 'docks', [r.cx - 20, r.cx + 20]);
    place('port', 'Port', sideWalkPoint(8, 6, 'w'));
    // Aéroport : terminal, tour, hangars entre la rue du nord et la piste
    y = gh(300, -524);
    add('industrie', 'terminal', 300, -526, 90, 16, [box(300, -526, 90, 16, y - 1, y + 10, 0xdfe6ee, { win: true }), box(340, -526, 8, 8, y + 10, y + 12, 0x7fb4e8)]);
    add('industrie', 'tour', 262, -526, 8, 8, [cyl(262, -526, 3, y - 1, y + 24, 0xe8e8e8), box(262, -526, 9, 9, y + 24, y + 28, 0x7fb4e8, { roof: 'pyr', roofH: 2.5, roofColor: 0x4a5568 })]);
    add('industrie', 'hangar', 430, -526, 60, 18, [box(430, -526, 60, 18, y - 1, y + 12, 0xb0b7c2, { roof: 'gable', roofH: 4, roofColor: 0x6b7480 })]);
    add('industrie', 'hangar', 180, -526, 50, 18, [box(180, -526, 50, 18, y - 1, y + 12, 0xcbd2dc, { roof: 'gable', roofH: 4, roofColor: 0x6b7480 })]);
    reserve(130, -540, 470, -509);
    places.aeroport = { label: 'Aéroport', position: { x: 300, y: gh(300, -507) + CURB, z: -507 } };
    // Datacenter (bloc 8,2) : salle de baies lumineuses derrière une clôture, portail côté sud (route)
    r = blockRect(8, 2);
    {
      const hw = Math.min(36, r.w / 2 - 3), hd = Math.min(36, r.d / 2 - 3), cx = r.cx, cz = r.cz;
      const x0 = cx - hw, x1 = cx + hw, z0 = cz - hd, z1 = cz + hd;
      reserve(x0 - 2, z0 - 2, x1 + 2, z1 + 2);
      const y = Math.max(gh(x0, z0), gh(x1, z0), gh(x0, z1), gh(x1, z1), gh(cx, cz));
      const hz = z0 + 24, FH = 2.4, FC = 0x7d8794, T = 0.3, G = 7; // hall, hauteur de clôture, épaisseur, demi-portail
      const fenceSeg = (fx, fz, fw, fd) => box(fx, fz, fw, fd, y - 0.5, y + FH, FC);
      const segs = [fenceSeg(cx, z0, hw * 2, T), fenceSeg(x0, cz, T, hd * 2), fenceSeg(x1, cz, T, hd * 2),
        fenceSeg((x0 + cx - G) / 2, z1, (cx - G) - x0, T), fenceSeg((x1 + cx + G) / 2, z1, x1 - (cx + G), T)];
      const parts = [
        box(cx, hz, 56, 26, y - 1, y + 11, 0x2b3544, { roof: 'flat' }),
        box(cx, hz + 13.1, 3, 0.4, y, y + 4, 0x1a2029),                       // porte
        box(cx - 14, hz - 4, 8, 8, y + 11, y + 13.2, 0x8b94a3), box(cx + 14, hz - 4, 8, 8, y + 11, y + 13.2, 0x8b94a3), // groupes froids
        box(cx, hz + 4, 10, 10, y + 11, y + 17, 0x1f6f8f),                    // « cube » du Cluster sur le toit
        box(cx, hz + 4, 5, 5, y + 17, y + 20, 0x38e1ff),
        box(x1 - 6, z1 - 10, 5, 4, y - 0.5, y + 3.2, 0xd8dde4, { roof: 'flat' }), // guérite
        cyl(x0 + 8, z1 - 12, 3, y - 0.5, y + 5, 0xe8e8e8), cyl(x0 + 16, z1 - 12, 3, y - 0.5, y + 5, 0xe8e8e8), // cuves de fuel
      ];
      // baies lumineuses en façade sud (vers le portail) et sur les côtés : barres verticales claires
      for (let k = -6; k <= 6; k++) parts.push(box(cx + k * 4.2, hz + 13.2, 1.2, 0.3, y + 1.5, y + 7, k % 2 ? 0x4dff9a : 0x38e1ff));
      for (const sx of [-1, 1]) for (let k = -2; k <= 2; k++) parts.push(box(cx + sx * 28.2, hz + k * 5, 0.3, 1.2, y + 2, y + 9, k % 2 ? 0x4dff9a : 0x38e1ff));
      const colliders = [
        { cx, cz: hz, hw: 28, hd: 13, y0: y - 1, y1: y + 11 },
        { cx: x1 - 6, cz: z1 - 10, hw: 2.5, hd: 2, y0: y - 0.5, y1: y + 3.2 },
        { cx: x0 + 8, cz: z1 - 12, hw: 3, hd: 3, y0: y - 0.5, y1: y + 5 }, { cx: x0 + 16, cz: z1 - 12, hw: 3, hd: 3, y0: y - 0.5, y1: y + 5 },
        ...segs.map((s2) => ({ cx: s2.cx, cz: s2.cz, hw: s2.w / 2, hd: s2.d / 2, y0: y - 0.5, y1: y + FH })),
      ];
      add('industrie', 'datacenter', cx, cz, hw * 2, hd * 2, [...parts, ...segs], { colliders });
      for (let k = -6; k <= 6; k += 2) neon.push({ x: cx + k * 4.2, y: y + 4.5, z: hz + 14.2, color: k % 4 ? '#4dff9a' : '#38e1ff', size: 7 });
      for (const sx of [-1, 1]) for (let k = -2; k <= 2; k += 2) neon.push({ x: cx + sx * 29.2, y: y + 5.5, z: hz + k * 5, color: '#38e1ff', size: 7 });
      neon.push({ x: cx, y: y + 21.5, z: hz + 4, color: '#38e1ff', size: 14 });
      datacenter = { x: cx, y, z: cz, gate: { x: cx, z: z1 }, sign: { x: cx, y: y + 9, z: hz + 13.45 } };
      place('datacenter', 'Datacenter', { x: cx, z: hz + 13 + 14 });
    }
    // Phare au bout de la plage est
    y = gh(545, 418);
    add('plage', 'phare', 545, 418, 9, 9, [cyl(545, 418, 4.5, y - 1, y + 12, 0xf2f2f2), cyl(545, 418, 4, y + 12, y + 22, 0xd93a3a), cyl(545, 418, 3.4, y + 22, y + 32, 0xf2f2f2),
      cyl(545, 418, 3.8, y + 32, y + 33, 0x333844), cyl(545, 418, 2.2, y + 33, y + 37, 0xfff2b0, { glow: true })]);
    reserve(530, 403, 560, 433);
    places.phare = { label: 'Phare', position: { x: 536, y: gh(536, 400), z: 400 } };
    // Jetée (x = 200) : plateforme au-dessus de la mer
    places.jetee = { label: 'Jetée', position: { x: 200, y: 0.25, z: 500 } };
    // Planques des persos
    const planque = (key, label, i, j) => {
      const r2 = blockRect(i, j), y2 = gh(r2.cx, r2.cz); reserve(r2.cx - 13, r2.cz - 10, r2.cx + 13, r2.cz + 10);
      add(districtAt(r2.cx, r2.cz).key, 'planque', r2.cx, r2.cz, 22, 16, [box(r2.cx, r2.cz, 22, 16, y2 - 1, y2 + 7, 0xd8b4e8, { win: true, roof: 'gable', roofH: 2.5, roofColor: 0x5a3d6b })]);
      place(key, label, { x: r2.cx, z: r2.z1 + 2 });
    };
    planque('planque_ines', 'Planque d’Inès', 3, 7);
    planque('planque_malik', 'Planque de Malik', 2, 7);
    planque('planque_jade', 'Planque de Jade', 7, 3);
  };

  for (const r of RAMPS) reserve(r.x - 14, r.z - 14, r.x + 14, r.z + 14);
  special();

  // ---- blocs génériques
  for (let j = 0; j < ZS.length - 1; j++) {
    for (let i = 0; i < XS.length - 1; i++) {
      const r = blockRect(i, j), dist = districtAt(r.cx, r.cz), rng = rngB(i, j);
      const lot = (x0, z0, x1, z1) => !overlaps(x0, z0, x1, z1, 1) && !nearCurve(x0, z0, x1, z1);
      if (dist.key === 'centre') {
        const core = Math.abs(r.cx) <= 200 && Math.abs(r.cz) <= 200, gap = 4;
        const lw2 = (r.w - gap) / 2, ld = (r.d - gap) / 2;
        for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
          const x0 = r.x0 + a * (lw2 + gap), z0 = r.z0 + b * (ld + gap), x1 = x0 + lw2, z1 = z0 + ld;
          if (!lot(x0, z0, x1, z1)) {
            // parcelle libre (route en diagonale ou lieu réservé) : petit square planté d'arbres
            if (!overlaps(x0, z0, x1, z1, 1)) for (let k = 0; k < 5; k++) tree(x0 + 6 + rng() * (lw2 - 12), z0 + 6 + rng() * (ld - 12), 'tree', 0.9 + rng() * 0.4);
            continue;
          }
          const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, d0 = Math.hypot(cx, cz);
          const y0 = gmin(x0, z0, x1, z1) - 1, yb = gmax(x0, z0, x1, z1);
          let h = core ? 22 + rng() * 34 + Math.max(0, 85 - d0 * 0.3) * (0.4 + rng() * 0.6) : 10 + rng() * 22;
          if (rng() < 0.12) h = 8 + rng() * 6;
          const col = pick(rng, PAL.centre), parts = [];
          if (h > 50) {
            const h1 = h * 0.62;
            parts.push(box(cx, cz, lw2, ld, y0, yb + h1, col, { win: true }));
            parts.push(box(cx, cz, lw2 * 0.66, ld * 0.66, yb + h1, yb + h, pick(rng, PAL.centre), { win: true }));
          } else parts.push(box(cx, cz, lw2, ld, y0, yb + h, col, { win: true, roof: h < 14 && rng() < 0.4 ? 'gable' : 'flat', roofH: 3, roofColor: pick(rng, PAL.roof) }));
          const bld = add('centre', h > 50 ? 'tour' : 'immeuble', cx, cz, lw2, ld, parts);
          const nn = rng() < 0.7 ? 1 + Math.floor(rng() * 2) : 0;
          for (let k = 0; k < nn; k++) {
            const side = Math.floor(rng() * 4), c = pick(rng, ['#ff4fa3', '#38e1ff', '#ffb02e', '#a56bff', '#4dff9a']);
            const ny = yb + 3 + rng() * Math.min(h * 0.6, 14);
            const px = side === 0 ? x0 - 0.4 : side === 1 ? x1 + 0.4 : cx + (rng() - 0.5) * lw2 * 0.6;
            const pz = side === 2 ? z0 - 0.4 : side === 3 ? z1 + 0.4 : cz + (rng() - 0.5) * ld * 0.6;
            neon.push({ x: px, y: ny, z: pz, color: c, size: 7 + rng() * 6 });
          }
          bld.core = core;
        }
      } else if (dist.key === 'docks') {
        if (!overlaps(r.x0, r.z0, r.x1, r.z1)) {
          const y = gmax(r.x0, r.z0, r.x1, r.z1);
          if (rng() < 0.55) add('docks', 'entrepot', r.cx, r.z0 + 18, r.w - 10, 30, [box(r.cx, r.z0 + 18, r.w - 10, 30, y - 1, y + 10 + rng() * 5, pick(rng, PAL.docks), { roof: 'gable', roofH: 3.5, roofColor: 0x4a5568 })]);
          containerYard(add, r.x0 + 2, r.z0 + (rng() < 0.55 ? 40 : 4), r.x1 - 2, r.z1 - 2, y, rng, 'docks');
        }
      } else if (dist.key === 'industrie') {
        if (!overlaps(r.x0, r.z0, r.x1, r.z1, -20)) {
          const y = gmax(r.x0, r.z0, r.x1, r.z1);
          for (let b = 0; b < 2; b++) {
            const z0 = r.z0 + b * (r.d / 2 + 2), z1 = z0 + r.d / 2 - 2, x0 = r.x0 + rng() * 8, x1 = r.x1 - rng() * 8;
            if (!lot(x0, z0, x1, z1)) continue;
            if (rng() < 0.65) add('industrie', 'usine', (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, [box((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, y - 1, y + 9 + rng() * 8, pick(rng, PAL.industrie), { roof: 'gable', roofH: 2.5, roofColor: 0x59606b })]);
            else {
              for (let t = 0; t < 3; t++) { const tx = x0 + 12 + t * 22, tz = (z0 + z1) / 2, tr = 6 + rng() * 2; if (tx + tr < x1 && lot(tx - tr, tz - tr, tx + tr, tz + tr)) add('industrie', 'reservoir', tx, tz, tr * 2, tr * 2, [cyl(tx, tz, tr, y - 1, y + 12 + rng() * 4, pick(rng, [0xe8e8e8, 0xc9d1d9, 0xd9c9a6]), { roofColor: 0x8a929c })]); }
              const hx = x1 - 6;
              add('industrie', 'cheminee', hx, (z0 + z1) / 2, 6, 6, [cyl(hx, (z0 + z1) / 2, 2.6, y - 1, y + 14, 0xb85a3a), cyl(hx, (z0 + z1) / 2, 2.3, y + 14, y + 22, 0xf2f2f2), cyl(hx, (z0 + z1) / 2, 2.6, y + 22, y + 30, 0xb85a3a)]);
            }
          }
        }
      } else if (dist.key === 'collines') {
        const cells = 3, cw = r.w / cells, cd = r.d / cells;
        for (let a = 0; a < cells; a++) for (let b = 0; b < cells; b++) {
          const x0 = r.x0 + a * cw + 4, z0 = r.z0 + b * cd + 4, x1 = r.x0 + (a + 1) * cw - 4, z1 = r.z0 + (b + 1) * cd - 4;
          if (rng() < 0.3 || !lot(x0, z0, x1, z1)) { if (rng() < 0.7 && lot(x0, z0, x1, z1)) { tree((x0 + x1) / 2, (z0 + z1) / 2, 'tree', 1.2); } continue; }
          const w = x1 - x0 - rng() * 6, d = z1 - z0 - rng() * 6, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
          const y0 = gmin(x0, z0, x1, z1) - 1.5, yb = gmax(x0, z0, x1, z1), h = 5 + rng() * 4;
          const roof = rng() < 0.5 ? 'gable' : 'pyr';
          add('collines', 'villa', cx, cz, w, d, [box(cx, cz, w, d, y0, yb + h, pick(rng, PAL.villa), { win: true, roof, roofH: 3 + rng() * 1.5, roofColor: pick(rng, PAL.roof) })]);
          tree(x0 + 1, z1 - 1, 'tree', 0.9);
        }
      } else { // plage : hôtels et boutiques en front de mer
        if (!overlaps(r.x0, r.z0, r.x1, r.z1)) {
          const n = 3, cw = r.w / n;
          for (let a = 0; a < n; a++) {
            const x0 = r.x0 + a * cw + 3, x1 = r.x0 + (a + 1) * cw - 3, z0 = r.z0 + 3, z1 = r.z0 + 3 + 22 + rng() * 10;
            if (!lot(x0, z0, x1, z1)) continue;
            const h = 9 + rng() * 16, y = gmax(x0, z0, x1, z1);
            add('plage', 'hotel', (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, [box((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, y - 1, y + h, pick(rng, PAL.plage), { win: true })]);
            neon.push({ x: (x0 + x1) / 2, y: y + 3.5, z: z1 + 0.4, color: pick(rng, ['#38e1ff', '#ff4fa3', '#ffb02e']), size: 9 });
          }
        }
      }
    }
  }
  // sable : cabanes, parasols, palmiers entre la promenade et la mer
  const rs = rngB(99, 99);
  for (let x = -540; x <= 540; x += 22) {
    const zS = shoreZ(x) - 14;
    if (!overlaps(x - 3, 395, x + 3, zS + 4, 0)) tree(x + (rs() - 0.5) * 8, 396 + rs() * (zS - 396), 'palm', 0.9 + rs() * 0.4);
    if (rs() < 0.28) { const cz = 405 + rs() * (zS - 405), col = pick(rs, PAL.plage); add('plage', 'cabane', x, cz, 5, 4, [box(x, cz, 5, 4, gh(x, cz) - 0.5, gh(x, cz) + 3, col, { roof: 'gable', roofH: 1.2, roofColor: 0xa04a30 })]); }
    else if (rs() < 0.5) props.push({ kind: 'parasol', x: x + 6, z: 405 + rs() * (zS - 405), y: 0, s: 1, rot: 0, color: pick(rs, [0xff4fa3, 0x38e1ff, 0xffb02e, 0xffffff]) });
  }
  // zone d'essai : marques de départ (rien) — les arbres de ville sont ajoutés par le long des routes
  return { buildings, props, neon, reserved, places, tree, rngB, get datacenter() { return datacenter; } };
}

/** Parc à conteneurs : rangées de conteneurs empilés (une seule collision par rangée). */
function containerYard(add, x0, z0, x1, z1, y, rng, district, skipX = null) {
  const parts = [], cols = [];
  const L = 12, W = 2.5, Hh = 2.6;
  let used = 0;
  for (let z = z0 + W / 2; z < z1 - W; z += W + 3.2) {
    for (let x = x0 + L / 2; x < x1 - L / 2; x += L + 0.6) {
      if (skipX && x > skipX[0] - 8 && x < skipX[1] + 8 && z > z0 + 4 && z < z0 + 24) continue;
      const stack = 1 + Math.floor(rng() * 3);
      if (rng() < 0.25) continue;
      for (let s = 0; s < stack; s++) parts.push(box(x, z, L, W, y + s * Hh, y + (s + 1) * Hh, pick(rng, PAL.container)));
      cols.push({ cx: x, cz: z, hw: L / 2, hd: W / 2, y0: y, y1: y + stack * Hh });
      used++;
    }
  }
  if (used) add(district, 'conteneurs', (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, parts, { colliders: cols });
}

// ---------------------------------------------------------------- assemblage
const SEEDED = new Map();

/** Génère (une seule fois par graine) toute la ville : données pures. */
export function generateCity(seed = SEED) {
  if (SEEDED.has(seed)) return SEEDED.get(seed);
  const roads = buildGraph();
  const sidewalks = buildSidewalks(roads);
  const trafficLights = buildLights(roads);
  const st = generateStructures(roads);
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const { props, places, tree } = st;

  // lampadaires et arbres le long des routes
  const lamps = [];
  for (const e of roads.edges) {
    if (e.kind === 'runway') continue;
    const step = e.kind === 'promenade' ? 24 : 38, lampS = [];
    for (let s = 14; s < e.len - 14; s += step) {
      const side = (Math.round(s / step) + e.id) % 2 ? 1 : -1, p = roads.pointAt(e, s), off = side * (e.width / 2 + 0.9);
      const x = p.x - p.tz * off, z = p.z + p.tx * off;
      lamps.push({ x, y: groundHeight(x, z) + CURB, z, dx: side * p.tz, dz: -side * p.tx });
      lampS.push([s, side]);
    }
    const dk = districtAt(roads.pointAt(e, e.len / 2).x, roads.pointAt(e, e.len / 2).z).key;
    const kind = dk === 'plage' ? 'palm' : 'tree', prob = { centre: 0.55, collines: 0.8, plage: 1, docks: 0.15, industrie: 0.2 }[dk];
    for (let s = 20; s < e.len - 16; s += 17) {
      for (const side of [1, -1]) {
        if (rng() > prob || lampS.some(([ls, lsd]) => lsd === side && Math.abs(ls - s) < 5)) continue;
        const p = roads.pointAt(e, s), off = side * (e.width / 2 + SW - 0.8);
        tree(p.x - p.tz * off, p.z + p.tx * off, kind, 0.85 + rng() * 0.3);
      }
    }
  }
  // lisière : arbres hors de l'anneau routier (collines boisées, champs au nord et à l'est)
  for (let x = -690; x <= 690; x += 15) {
    for (let z = -690; z <= 430; z += 15) {
      const out = Math.abs(x) > 525 || z < -525;
      if (!out || (z > -590 && z < -500 && x > 90 && x < 510)) continue;
      const jx = x + (rng() - 0.5) * 12, jz = z + (rng() - 0.5) * 12;
      if (rng() < (jx < 0 ? 0.55 : 0.3) && groundHeight(jx, jz) > 0.5) tree(jx, jz, 'tree', 1 + rng() * 0.8);
    }
  }
  // places publiques (points de repère sur la route la plus proche)
  const spawn = { player: null, vehicles: [], peds: [] };
  const hintsBy = { centre: ['sedan', 'taxi', 'compact', 'suv', 'sport'], docks: ['van', 'pickup', 'truck'], collines: ['sport', 'suv', 'muscle'], plage: ['compact', 'sport', 'muscle'], industrie: ['van', 'pickup', 'truck'] };
  const spots = [];
  for (const e of roads.edges) {
    if (e.kind === 'runway' || e.kind === 'avenue') continue;
    for (let s = 22; s < e.len - 22; s += 26) {
      if (rng() > 0.2) continue;
      const side = rng() < 0.5 ? 1 : -1, p = roads.pointAt(e, s), off = side * (e.width / 2 - 1.5);
      const x = p.x - p.tz * off, z = p.z + p.tx * off, dir = side > 0 ? 1 : -1;
      const dk = districtAt(x, z).key;
      spots.push({ x, y: groundHeight(x, z), z, rotation: Math.atan2(p.tx * dir, p.tz * dir), district: dk, hint: hintsBy[dk][Math.floor(rng() * hintsBy[dk].length)] });
    }
  }
  spawn.vehicles = spots.slice(0, 140);
  const n0 = roads.nodes.find((n) => n.x === 0 && n.z === 0);
  const ps = { x: n0.x + 9, z: n0.z - 9 };
  spawn.player = { x: ps.x, y: groundHeight(ps.x, ps.z) + CURB + 0.9, z: ps.z, rotation: 0 };
  // quelques véhicules garés près du point d'arrivée
  const near = roads.nearest(ps.x, ps.z);
  for (const [sd, ds] of [[1, 18], [-1, 30], [1, 46]]) {
    const e = near.edge, s = clamp(near.s + ds * (e.len > 60 ? 1 : 0), 14, e.len - 14), p = roads.pointAt(e, s), off = sd * (e.width / 2 - 1.5);
    const x = p.x - p.tz * off, z = p.z + p.tx * off;
    spawn.vehicles.unshift({ x, y: groundHeight(x, z), z, rotation: Math.atan2(p.tx * sd, p.tz * sd), district: 'centre', hint: ['sport', 'sedan', 'taxi'][Math.abs(sd * ds) % 3] });
  }
  for (const e of sidewalks.edges) {
    if (e.kind !== 'walk') continue;
    for (let k = 1; k < e.pts.length; k++) {
      const a = e.pts[k - 1], b = e.pts[k], l = Math.hypot(b.x - a.x, b.z - a.z);
      if (l < 8 || rng() > 0.45) continue;
      const t = 0.25 + rng() * 0.5, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      spawn.peds.push({ x, y: groundHeight(x, z) + CURB + 0.9, z, district: districtAt(x, z).key });
    }
  }
  // rampes de cascade (hors circulation) : { x, z, rotation (cap de montée), length, width, height }
  const ramps = RAMPS.map((r) => ({ ...r }));
  for (const r of ramps) r.y = groundHeight(r.x, r.z);
  const pier = { x: 200, z0: 396, z1: 520, width: 6, y: 0.25 };
  const lighthouse = { x: 545, z: 418, y: groundHeight(545, 418) + 35 };
  const city = {
    seed, size: SIZE, roads, sidewalks, trafficLights, buildings: st.buildings, props, lamps, neon: st.neon, places, spawnPoints: spawn, ramps, pier, lighthouse, datacenter: st.datacenter,
    groundHeight, district: districtAt, isRoad: (x, z) => roads.isRoad(x, z), isWater: isWaterAt,
    nearestRoadPoint: (p) => { const n = roads.nearest(p.x, p.z); return n ? { x: n.x, y: n.y, z: n.z } : { x: p.x, y: groundHeight(p.x, p.z), z: p.z }; },
    route: (a, b) => roads.route(a, b),
    chunkKey: (x, z) => `${Math.floor((x + HALF) / CHUNK)},${Math.floor((z + HALF) / CHUNK)}`,
  };
  SEEDED.set(seed, city);
  return city;
}
