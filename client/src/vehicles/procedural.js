// Modèles procéduraux du bus et de la moto (absents du Car Kit de Kenney). Peu de draw calls :
// la carrosserie est fusionnée en un seul maillage, les vitres et accessoires en un second.
// Repère : l'avant est +Z, la gauche +X ; unités du modèle (échelle 1.4 appliquée par Vehicle).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const mat = (color, extra = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...extra }); return m; };
/** Boîte positionnée (centre cx,cy,cz ; dimensions w,h,d) au format fusionnable. */
function box(w, h, d, cx, cy, cz, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(cx, cy, cz);
  return g.toNonIndexed();
}
function cyl(r, len, cx, cy, cz, axis = 'x') {
  const g = new THREE.CylinderGeometry(r, r, len, 10);
  if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(cx, cy, cz);
  return g.toNonIndexed();
}
function merged(parts, material, name) {
  const geo = mergeGeometries(parts.map((p) => { p.deleteAttribute('uv'); return p; }), false);
  const m = new THREE.Mesh(geo, material);
  m.name = name; m.userData.dispose = true; m.castShadow = true;
  return m;
}
const TIRE = mat(0x1b1b1d, { roughness: 0.9 });
const HUB = mat(0xb8bcc4, { metalness: 0.5 });
const GLASS = mat(0x3d5670, { roughness: 0.15, metalness: 0.3 });
const WHITE = mat(0xf2f2ee);
[TIRE, HUB, GLASS, WHITE].forEach((m) => { m.userData.noTint = true; });

/** Roue : nœud nommé (pivot au centre, axe X) ; `out` décale le pneu vers l'extérieur (comme les roues du Car Kit). */
function wheelNode(name, p, r, width, out) {
  const n = new THREE.Group(); n.name = name; n.position.set(p[0], p[1], p[2]);
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, width, 14).rotateZ(Math.PI / 2), TIRE);
  tire.position.x = out; tire.castShadow = true;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, width * 1.04, 8).rotateZ(Math.PI / 2), HUB);
  hub.position.x = out;
  n.add(tire, hub);
  return n;
}

/** Bus urbain : ~9 m, deux essieux. `entry` = entrée du manifest (positions des roues). */
export function buildBus(entry, color = 0x4aa0e0) {
  const g = new THREE.Group();
  const body = mat(color, { roughness: 0.5 });
  const [W, H, L] = entry.size; // 1.9 × 2.1 × 6.4
  const y0 = 0.28;
  g.add(merged([
    box(W, H - y0, L, 0, y0 + (H - y0) / 2, 0),
    box(W * 0.96, 0.08, L * 0.98, 0, H + 0.03, 0),                    // toit
    box(W * 0.5, 0.12, L * 0.42, 0, H + 0.1, -0.5),                   // climatisation
  ], body, 'bus-body'));
  const wy = 1.25, wh = 0.62;
  const glass = [
    box(W + 0.02, wh, 1.0, 0, wy, 2.05), box(W + 0.02, wh, 1.0, 0, wy, 0.85), box(W + 0.02, wh, 1.0, 0, wy, -0.35), box(W + 0.02, wh, 1.0, 0, wy, -1.55),
    box(W * 0.84, 0.82, 0.05, 0, 1.35, L / 2 + 0.005),               // pare-brise
    box(W * 0.8, 0.5, 0.05, 0, 1.3, -L / 2 - 0.005),                  // lunette arrière
  ];
  g.add(merged(glass, GLASS, 'bus-glass'));
  g.add(merged([
    box(W + 0.03, 0.12, L * 0.99, 0, 0.62, 0),                        // bandeau blanc
    box(W * 0.6, 0.16, 0.05, 0, H - 0.18, L / 2 + 0.01),              // girouette
    box(0.05, 1.0, 0.7, W / 2 + 0.005, 0.95, -2.35),                  // portes (extérieur)
  ], WHITE, 'bus-trim'));
  for (const [name, p] of Object.entries(entry.wheelPositions)) {
    const sx = p[0] > 0 ? 1 : -1;
    g.add(wheelNode(name, p, entry.wheelRadius, 0.25, sx * 0.125));
  }
  return g;
}

/** Moto : cadre, réservoir, fourche, roues sur l'axe central (deux nœuds `wheel-front` et `wheel-back`). */
export function buildMoto(entry, color = 0xd0392b) {
  const g = new THREE.Group();
  const body = mat(color, { roughness: 0.4, metalness: 0.2 });
  g.add(merged([
    box(0.2, 0.2, 0.62, 0, 0.5, 0.05),                                // réservoir
    box(0.15, 0.1, 0.1, 0, 0.62, -0.05),
    box(0.1, 0.1, 0.4, 0, 0.43, -0.5, 0.18),                          // garde-boue / coque arrière
    box(0.05, 0.5, 0.06, 0.07, 0.48, 0.52, 0.32), box(0.05, 0.5, 0.06, -0.07, 0.48, 0.52, 0.32), // fourche
    box(0.6, 0.04, 0.04, 0, 0.8, 0.43),                               // guidon
  ], body, 'moto-body'));
  const dark = mat(0x26262a, { roughness: 0.7 }); dark.userData.noTint = true;
  const trim = merged([
    box(0.18, 0.1, 0.5, 0, 0.55, -0.22),                              // selle
    box(0.22, 0.26, 0.34, 0, 0.3, 0.02),                              // bloc moteur
    box(0.07, 0.07, 0.5, 0.15, 0.2, -0.3), box(0.07, 0.07, 0.5, -0.15, 0.2, -0.3), // échappements
    cyl(0.1, 0.1, 0, 0.63, 0.66, 'z'),                                 // phare
  ], dark, 'moto-trim');
  trim.castShadow = false; g.add(trim);
  const r = entry.wheelRadius;
  for (const [name, p] of Object.entries(entry.wheelPositions)) g.add(wheelNode(name, p, r, 0.12, 0));
  // pilote de la circulation (masqué quand le joueur conduit)
  const rider = new THREE.Group(); rider.name = 'rider';
  const jacket = mat(0x2d3a52), helmet = mat(0xeeeeee);
  const torso = new THREE.Mesh(box(0.34, 0.5, 0.2, 0, 0, 0), jacket); torso.position.set(0, 0.95, -0.2); torso.rotation.x = 0.35;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), helmet); head.position.set(0, 1.3, -0.08);
  const legs = new THREE.Mesh(box(0.32, 0.18, 0.5, 0, 0, 0), jacket); legs.position.set(0, 0.62, -0.1);
  rider.add(torso, head, legs);
  rider.traverse((o) => { if (o.isMesh) { o.userData.dispose = true; o.castShadow = false; } });
  rider.visible = false;
  g.add(rider);
  return g;
}

export const PROCEDURAL = { bus: buildBus, moto: buildMoto };
