// Ville côté serveur : lieux nommés et graphe routier utilisés par les agents IA (coordonnées x/z en mètres, origine au centre).
// Source unique : la génération déterministe du client (client/src/world/citygen.js, module pur sans Three.js),
// pour que les agents roulent sur les mêmes rues que celles que voient les joueurs.
import { generateCity, districtAt as cityDistrict, groundHeight, HALF as CITY_HALF } from "../client/src/world/citygen.js";

export const HALF = CITY_HALF;
const city = generateCity();
const roads = city.roads;

// Lieux de la spec 5 : clé -> { label, x, z } (le point de repère est au bord de la route la plus proche)
export const PLACES = Object.fromEntries(Object.entries(city.places).map(([key, p]) => [key, {
  label: p.label, x: Math.round(p.position.x * 100) / 100, z: Math.round(p.position.z * 100) / 100,
}]));

/** Quartier : { name, key, color }. */
export function districtAt(x, z) { return cityDistrict(x, z); }

/** Altitude du sol (collines, plage) pour poser les agents. */
export { groundHeight };

/** Graphe routier partagé (nœuds = carrefours, arêtes = rues avec leur tracé `pts`). */
export const GRAPH = roads;

/** Points d'une arête dans le sens a → b (ou b → a). */
function edgePoints(e, fromNode) {
  const pts = e.pts?.length ? e.pts : [roads.nodes[e.a], roads.nodes[e.b]];
  return e.a === fromNode ? pts : [...pts].reverse();
}

/** Itinéraire par les rues jusqu'à `to` : carrefour le plus proche, tracé des rues (virages compris), puis l'arrivée. */
export function roadPath(from, to) {
  const a = roads.nearestNode(from.x, from.z), b = roads.nearestNode(to.x, to.z);
  const steps = a && b && a.id !== b.id ? roads.nodePath(a.id, b.id) : [];
  const pts = [];
  const push = (p) => {
    const q = { x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 };
    const l = pts.at(-1);
    if (!l || Math.hypot(l.x - q.x, l.z - q.z) > 0.5) pts.push(q);
  };
  if (a) push(a);
  for (const st of steps ?? []) {
    const e = typeof st.edge === "number" ? roads.edges[st.edge] : st.edge;
    if (e) for (const p of edgePoints(e, st.from)) push(p); else push(roads.nodes[st.to]);
  }
  push(to);
  return pts;
}

export function resolvePlace(key) {
  const k = String(key || "").toLowerCase();
  const p = PLACES[k];
  return p ? { ...p, key: k } : null;
}

/** Position de départ aléatoire sur un carrefour routier (hors piste de l'aéroport). */
const START_NODES = roads.nodes.filter((n) => (n.arms ?? []).some((a) => a.edge.kind !== "runway"));
export function randomRoadPoint() {
  const pool = START_NODES.length ? START_NODES : roads.nodes;
  const n = pool[Math.floor(Math.random() * pool.length)];
  return { x: n.x, z: n.z };
}
