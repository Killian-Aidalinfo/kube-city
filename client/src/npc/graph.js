// Normalise le RoadGraph / graphe de trottoirs du monde en arcs orientés (tolérant sur la forme).

const cache = new WeakMap();

function nodePos(n) {
  if (Array.isArray(n)) return { x: n[0], z: n[n.length > 2 ? 2 : 1] };
  const p = n.position ?? n;
  return { x: p.x, z: p.z };
}

/**
 * @param {{nodes: any[], edges: any[]}} g graphe brut
 * @returns {{nodes: {x:number,z:number,out:object[]}[], arcs: object[]}}
 */
export function normalizeGraph(g) {
  if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) return { nodes: [], arcs: [] };
  const hit = cache.get(g);
  if (hit && hit.n === g.nodes.length && hit.e === g.edges.length) return hit.graph;
  const nodes = g.nodes.map((n) => ({ ...nodePos(n), out: [] }));
  const byId = new Map();
  g.nodes.forEach((n, i) => { if (n && n.id !== undefined) byId.set(n.id, i); });
  const idx = (v) => (byId.has(v) ? byId.get(v) : v);
  const arcs = [];
  const add = (a, b, speed) => {
    const A = nodes[a], B = nodes[b];
    if (!A || !B) return;
    const dx = B.x - A.x, dz = B.z - A.z, len = Math.hypot(dx, dz);
    if (len < 0.5) return;
    const arc = { a, b, len, dx: dx / len, dz: dz / len, speed, rev: null };
    arcs.push(arc); A.out.push(arc);
  };
  for (const e of g.edges) {
    const a = idx(Array.isArray(e) ? e[0] : e.a ?? e.from ?? e.source);
    const b = idx(Array.isArray(e) ? e[1] : e.b ?? e.to ?? e.target);
    let v = e.speedLimit ?? e.speed ?? e.limit ?? 50;
    v = v < 25 ? v * 3.6 : v; // m/s → km/h si la valeur est petite
    const oneWay = e.oneWay === true || e.twoWay === false || e.oneway === true;
    add(a, b, v);
    if (!oneWay) add(b, a, v);
  }
  for (const a of arcs) a.rev = nodes[a.b].out.find((o) => o.b === a.a) ?? null;
  const graph = { nodes, arcs };
  cache.set(g, { n: g.nodes.length, e: g.edges.length, graph });
  return graph;
}

/** Choisit l'arc suivant en évitant le demi-tour et en préférant tout droit. */
export function nextArc(graph, arc, rng = Math.random) {
  const outs = graph.nodes[arc.b]?.out ?? [];
  let c = outs.filter((o) => o !== arc.rev);
  if (!c.length) c = outs;
  if (!c.length) return null;
  const w = c.map((o) => 1 + 2 * Math.max(0, o.dx * arc.dx + o.dz * arc.dz));
  let r = rng() * w.reduce((s, x) => s + x, 0);
  for (let i = 0; i < c.length; i++) { r -= w[i]; if (r <= 0) return c[i]; }
  return c[c.length - 1];
}
