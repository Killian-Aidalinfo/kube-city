// Calculs de carte purs (sans DOM) : projection monde → minimap, extraction des routes, formats d'affichage.

/**
 * Projette un point du monde sur la minimap (origine au centre, y vers le bas).
 * (fx, fz) = direction de la caméra sur le plan XZ (normalisée) : « devant » pointe vers le haut de l'écran.
 */
export function worldToMap(x, z, cx, cz, fx, fz, scale) {
  const rx = x - cx, rz = z - cz;
  // droite = (-fz, fx) : pour une caméra qui regarde vers -Z, la droite est +X
  const right = rx * -fz + rz * fx;
  const fwd = rx * fx + rz * fz;
  return { x: right * scale, y: -fwd * scale };
}

/** Normalise une direction (par défaut : vers -Z). */
export function normDir(dx, dz) {
  const l = Math.hypot(dx, dz);
  return l < 1e-6 ? { fx: 0, fz: -1 } : { fx: dx / l, fz: dz / l };
}

/** Ramène un point dans un disque de rayon r ; `clamped` indique qu'il était dehors. */
export function clampToCircle(x, y, r) {
  const d = Math.hypot(x, y);
  if (d <= r) return { x, y, clamped: false };
  return { x: (x / d) * r, y: (y / d) * r, clamped: true };
}

const posOf = (n) => (n ? { x: n.x ?? n.position?.x ?? n.pos?.x, z: n.z ?? n.position?.z ?? n.pos?.z } : null);

/**
 * Extrait des segments [ax, az, bx, bz] d'un graphe routier (tolérant sur la forme : nœuds en tableau ou Map,
 * arêtes {a,b} / {from,to}, indices ou objets, éventuellement une polyligne `points`).
 */
export function extractSegments(roads) {
  const out = [];
  if (!roads) return out;
  const nodes = roads.nodes instanceof Map ? [...roads.nodes.values()] : Array.isArray(roads.nodes) ? roads.nodes : Object.values(roads.nodes || {});
  const byId = new Map();
  nodes.forEach((n, i) => { byId.set(i, n); if (n && n.id !== undefined) byId.set(n.id, n); });
  const edges = roads.edges instanceof Map ? [...roads.edges.values()] : Array.isArray(roads.edges) ? roads.edges : Object.values(roads.edges || {});
  const resolve = (v) => (v && typeof v === 'object' ? posOf(v) : posOf(byId.get(v)));
  for (const e of edges) {
    if (Array.isArray(e.points) && e.points.length > 1) {
      for (let i = 1; i < e.points.length; i++) {
        const a = posOf(e.points[i - 1]), b = posOf(e.points[i]);
        if (a && b) out.push([a.x, a.z, b.x, b.z]);
      }
      continue;
    }
    const a = resolve(e.a ?? e.from ?? e.n0 ?? e.source ?? e.start), b = resolve(e.b ?? e.to ?? e.n1 ?? e.target ?? e.end);
    if (a && b && Number.isFinite(a.x + a.z + b.x + b.z)) out.push([a.x, a.z, b.x, b.z]);
  }
  return out;
}

/** Longueur d'un itinéraire en mètres. */
export function routeLength(pts) {
  let l = 0;
  for (let i = 1; i < (pts?.length || 0); i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return l;
}

/** 12 345 → « 12 345 € » (espace insécable fine entre milliers). */
export function formatMoney(n) {
  return `${Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;
}

/** dayTime (0..24) → « 07:05 ». */
export function formatClock(dayTime) {
  const h = Math.floor(dayTime) % 24, m = Math.floor((dayTime % 1) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Distance lisible : « 85 m » ou « 1,2 km ». */
export function formatDistance(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

/** Fraction 0..1 sûre. */
export const frac = (v, max) => Math.max(0, Math.min(1, (v ?? 0) / (max || 1)));

/** Astuces de l'écran de chargement. */
export const TIPS = [
  'Maintenez Alt pour changer de personnage : la caméra survole la ville.',
  'Le panneau en haut au centre montre quel pod sert votre partie. Tuez-le : le jeu continue.',
  'Repeindre un véhicule chez Lou fait baisser votre niveau de recherche.',
  'Cherchez les kubes cyan cachés dans la ville : 50 en tout, 25 € pièce. Les plus proches apparaissent sur la minimap.',
  'Cliquez sur la carte (M) pour poser un point GPS : l\'itinéraire suit les routes.',
  'Inès conduit mieux, Malik répare vite, Jade fait taire la police.',
  'Sortir d\'un véhicule à plus de 30 km/h se termine par une roulade.',
  'La touche G déclenche la capacité spéciale de votre personnage.',
  'Le téléphone (P) permet d\'appeler un taxi, de lancer une activité ou de prendre une photo.',
  'Les cascades rapportent des bonus : cherchez des rampes et prenez de la vitesse.',
];
