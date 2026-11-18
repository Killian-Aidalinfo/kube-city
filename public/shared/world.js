// Ville de Kube City : carte déterministe partagée par le navigateur et le serveur.
// Même graine => même ville partout, donc rien à synchroniser.

export const TILE = 40;            // taille d'une case, en pixels monde
export const SIZE = 128;           // la ville fait SIZE x SIZE cases
export const BLOCK = 10;           // une rue toutes les BLOCK cases
export const ROAD = 3;             // largeur d'une rue, en cases
export const WORLD = SIZE * TILE;  // taille du monde, en pixels

// Types de case
export const T = { BUILDING: 0, ROAD: 1, PARK: 2, WATER: 3, SAND: 4, PLAZA: 5 };

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function isRoadLine(i) {
  return i % BLOCK < ROAD;
}

// Centre (en cases) de la rue la plus proche sur un axe
export function nearestRoadCenter(i) {
  const b = Math.round((i - ROAD / 2) / BLOCK);
  return Math.max(0, Math.min(Math.floor((SIZE - 1) / BLOCK), b)) * BLOCK + ROAD / 2;
}

export const DISTRICTS = [
  { name: "Centre-ville", hue: 285 },
  { name: "Docks", hue: 190 },
  { name: "Collines", hue: 330 },
  { name: "Plage", hue: 45 },
];

export function districtAt(x, y) {
  const cx = x / WORLD, cy = y / WORLD;
  if (cx > 0.78) return DISTRICTS[3];
  if (cy > 0.62) return DISTRICTS[1];
  if (cy < 0.3) return DISTRICTS[2];
  return DISTRICTS[0];
}

export function buildCity(seed = 6) {
  const r = rng(seed);
  const tiles = new Uint8Array(SIZE * SIZE);
  const height = new Uint8Array(SIZE * SIZE);
  const blockKind = new Map();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const beach = x > SIZE * 0.86;
      const sea = x > SIZE * 0.93;
      if (sea) { tiles[i] = T.WATER; continue; }
      if (isRoadLine(x) || isRoadLine(y)) { tiles[i] = beach && !isRoadLine(y) ? T.SAND : T.ROAD; continue; }
      if (beach) { tiles[i] = T.SAND; continue; }
      const key = `${Math.floor(x / BLOCK)},${Math.floor(y / BLOCK)}`;
      if (!blockKind.has(key)) {
        const v = r();
        blockKind.set(key, v < 0.1 ? T.PARK : v < 0.16 ? T.PLAZA : T.BUILDING);
      }
      tiles[i] = blockKind.get(key);
      height[i] = 2 + Math.floor(r() * 10);
    }
  }
  return { tiles, height };
}

export const CITY = buildCity();

export function tileAt(px, py) {
  const x = Math.floor(px / TILE), y = Math.floor(py / TILE);
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return T.WATER;
  return CITY.tiles[y * SIZE + x];
}

export function drivable(px, py) {
  const t = tileAt(px, py);
  return t === T.ROAD || t === T.PLAZA || t === T.SAND || t === T.PARK;
}

// Lieux nommés : utiles aux joueurs comme aux agents IA (MCP)
const c = (bx, by) => ({ x: (bx * BLOCK + ROAD / 2) * TILE, y: (by * BLOCK + ROAD / 2) * TILE });
export const PLACES = {
  "mairie": { label: "Mairie (centre-ville)", ...c(6, 5) },
  "port": { label: "Port industriel", ...c(3, 11) },
  "plage": { label: "Promenade de la plage", ...c(11, 6) },
  "collines": { label: "Belvédère des collines", ...c(5, 1) },
  "aeroport": { label: "Aéroport", ...c(0, 12) },
  "stade": { label: "Stade néon", ...c(9, 9) },
  "garage": { label: "Garage de Lou", ...c(2, 3) },
  "phare": { label: "Phare", ...c(11, 12) },
};

const onH = (y) => isRoadLine(Math.floor(y / TILE));
const onV = (x) => isRoadLine(Math.floor(x / TILE));

// Chemin par les rues, en L sur la grille : on ne traverse jamais un immeuble
export function roadPath(from, to) {
  const tx = nearestRoadCenter(to.x / TILE) * TILE, ty = nearestRoadCenter(to.y / TILE) * TILE;
  let pts;
  if (onH(from.y)) {
    // sur une rue horizontale : on la suit jusqu'à la rue verticale de l'arrivée
    pts = [{ x: tx, y: from.y }, { x: tx, y: to.y }];
  } else if (onV(from.x)) {
    pts = [{ x: from.x, y: ty }, { x: to.x, y: ty }];
  } else {
    // hors des rues (parc, place) : on rejoint la rue horizontale la plus proche
    const fy = nearestRoadCenter(from.y / TILE) * TILE;
    pts = [{ x: from.x, y: fy }, { x: tx, y: fy }, { x: tx, y: to.y }];
  }
  pts.push({ x: to.x, y: to.y });
  return pts;
}
