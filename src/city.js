// Ville côté serveur : lieux nommés et graphe routier utilisés par les agents IA (coordonnées x/z en mètres, origine au centre).
// TODO(MONDE) : quand client/src/world/citygen.js existera (génération partagée, spec 5), remplacer ce repli
// par ses lieux (`places`) et son RoadGraph ; seule l'interface exportée ici (PLACES, roadPath, districtAt, GRAPH) compte.
export const HALF = 600;        // la ville fait 1200 m x 1200 m
export const STEP = 100;        // une rue tous les 100 m (grille de repli)
const N = 5;                    // indices de rue : -5 … 5

const at = (i, j) => ({ x: i * STEP + 0, z: j * STEP + 0 }); // « + 0 » évite -0

// Lieux de la spec 5 : clé -> { label, x, z }
export const PLACES = {
  mairie: { label: "Mairie", ...at(0, 0) },
  commissariat: { label: "Commissariat", ...at(1, -1) },
  hopital: { label: "Hôpital", ...at(-2, 1) },
  garage: { label: "Garage « Chez Lou »", ...at(-1, 3) },
  boutique: { label: "Boutique de vêtements", ...at(2, 1) },
  jetee: { label: "Jetée", ...at(5, 2) },
  phare: { label: "Phare", ...at(5, -3) },
  stade: { label: "Stade", ...at(-3, -2) },
  belvedere: { label: "Belvédère", ...at(-4, -4) },
  port: { label: "Port", ...at(-1, 5) },
  aeroport: { label: "Aéroport", ...at(4, 5) },
};

export function districtAt(x, z) {
  if (x > 350) return { name: "Plage" };
  if (z > 250) return { name: "Docks" };
  if (z < -250) return { name: "Collines" };
  return { name: "Centre" };
}

// Graphe de repli : intersections de la grille, arêtes entre voisines.
export const GRAPH = { step: STEP, min: -N, max: N };
const snap = (v) => Math.max(-N, Math.min(N, Math.round(v / STEP)));

/** Itinéraire par les rues (angles droits sur la grille) jusqu'à `to`, sans traverser de bâtiment. */
export function roadPath(from, to) {
  const a = { i: snap(from.x), j: snap(from.z) }, b = { i: snap(to.x), j: snap(to.z) };
  const pts = [at(a.i, a.j)];
  // d'abord l'axe x, puis l'axe z, intersection par intersection (les virages restent sur les carrefours)
  for (let i = a.i; i !== b.i; ) { i += Math.sign(b.i - i); pts.push(at(i, a.j)); }
  for (let j = a.j; j !== b.j; ) { j += Math.sign(b.j - j); pts.push(at(b.i, j)); }
  return pts;
}

export function resolvePlace(key) {
  const p = PLACES[String(key || "").toLowerCase()];
  return p ? { ...p, key: String(key).toLowerCase() } : null;
}

/** Position de départ aléatoire sur une intersection. */
export function randomRoadPoint() {
  return at(Math.floor(Math.random() * (2 * N + 1)) - N, Math.floor(Math.random() * (2 * N + 1)) - N);
}
