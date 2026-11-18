// Silhouettes et accessoires procéduraux du mannequin : déformation du maillage par zone du corps
// (carrure, taille, hanches, buste) et petits objets attachés aux os (coiffures, lunettes, sac, ceinture...).
import * as THREE from 'three';

/**
 * Forme du corps. Chaque facteur vaut 1 par défaut.
 * @typedef {{ h?: number, w?: number, shoulders?: number, waist?: number, hips?: number, bust?: number, legs?: number, head?: number }} Build
 * @typedef {{ build?: Build, hair?: 'short'|'long'|'ponytail'|'bun'|'afro'|'bald', cap?: string, glasses?: string, headband?: string,
 *   backpack?: string, belt?: string, hood?: string, beard?: boolean, scarf?: string }} Style
 */

const bell = (h, c, w) => Math.exp(-(((h - c) / w) ** 2));

/**
 * Déforme une géométrie clonée du mannequin (repère de liaison, y vers le haut) selon la forme du corps.
 * @param {THREE.BufferGeometry} geo
 * @param {Build} b
 * @param {Uint8Array} zones par sommet : 0 tronc/jambes, 1 tête, 2 bras (non déformés)
 */
export function reshape(geo, b, zones) {
  const pos = geo.attributes.position;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const H = maxY - minY || 1;
  const hd = b.head ?? 1;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), h = (y - minY) / H;
    let x = pos.getX(i), z = pos.getZ(i);
    if (zones[i] === 2) continue; // bras intacts : leurs os sont animés, un décalage éparpillerait les doigts
    if (zones[i] === 1) {
      if (hd !== 1) { const cy = minY + H * 0.935; pos.setXYZ(i, x * hd, cy + (y - cy) * hd, z * hd); }
      continue;
    }
    const kx = 1
      + ((b.shoulders ?? 1) - 1) * bell(h, 0.78, 0.07)
      + ((b.waist ?? 1) - 1) * bell(h, 0.6, 0.045)
      + ((b.hips ?? 1) - 1) * bell(h, 0.5, 0.07)
      + ((b.legs ?? 1) - 1) * bell(h, 0.25, 0.2);
    const kz = 1 + ((b.waist ?? 1) - 1) * 0.6 * bell(h, 0.6, 0.045) + ((b.hips ?? 1) - 1) * 0.5 * bell(h, 0.5, 0.07)
      + (z > 0 ? ((b.bust ?? 1) - 1) * bell(h, 0.7, 0.04) : 0);
    pos.setXYZ(i, x * kx, y, z * kz);
  }
  pos.needsUpdate = true;
  geo.computeBoundingSphere();
}

// ---------- accessoires ----------
const matCache = new Map();
const mat = (color, extra = {}) => {
  const key = color + JSON.stringify(extra);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...extra }));
  return matCache.get(key);
};
const mesh = (geo, color, pos, scale, extra) => {
  const m = new THREE.Mesh(geo, mat(color, extra));
  m.position.set(...pos); if (scale) m.scale.set(...scale);
  m.castShadow = true;
  return m;
};
const sphere = new THREE.SphereGeometry(1, 14, 10);
const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 12);
const dome = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const ring = new THREE.TorusGeometry(1, 0.14, 6, 16);

const findBone = (model, re) => { let r = null; model.traverse((o) => { if (!r && o.isBone && re.test(o.name)) r = o; }); return r; };

/** Attache les accessoires du style au squelette d'un modèle cloné. Les os sont retrouvés par nom (noms nettoyés par three.js). */
export function attachAccessories(model, style, outfit) {
  const head = findBone(model, /head$/i), spine = findBone(model, /spine0*3$/i) ?? findBone(model, /spine0*2$/i), low = findBone(model, /spine0*1$/i);
  const hair = outfit.hair, skin = outfit.skin;
  if (head) {
    // repère de la tête : origine à la base du crâne, y vers le haut, z vers l'avant
    const g = new THREE.Group(); g.name = 'kc-head'; head.add(g);
    const c = [0, 0.1, 0.005];
    switch (style.hair) {
      case 'long': // chevelure dans le dos, jusqu'aux omoplates
        g.add(mesh(sphere, hair, [0, 0.115, -0.03], [0.118, 0.12, 0.118]));
        g.add(mesh(sphere, hair, [0, -0.06, -0.075], [0.105, 0.2, 0.055]));
        g.add(mesh(sphere, hair, [0.085, 0.0, -0.02], [0.03, 0.1, 0.07])); g.add(mesh(sphere, hair, [-0.085, 0.0, -0.02], [0.03, 0.1, 0.07]));
        break;
      case 'ponytail': // queue de cheval haute
        g.add(mesh(sphere, hair, [0, 0.12, -0.03], [0.116, 0.115, 0.116]));
        g.add(mesh(sphere, hair, [0, 0.13, -0.11], [0.04, 0.04, 0.04]));
        { const t = mesh(cyl, hair, [0, 0.05, -0.15], [0.035, 0.22, 0.035]); t.rotation.x = -0.35; g.add(t); }
        break;
      case 'bun':
        g.add(mesh(sphere, hair, [0, 0.12, -0.03], [0.116, 0.115, 0.116]));
        g.add(mesh(sphere, hair, [0, 0.215, -0.04], [0.06, 0.06, 0.06]));
        break;
      case 'afro':
        g.add(mesh(sphere, hair, [0, 0.15, -0.03], [0.16, 0.15, 0.16]));
        break;
      case 'short':
        g.add(mesh(sphere, hair, [0, 0.12, -0.03], [0.116, 0.115, 0.116]));
        break;
      default: break;
    }
    if (style.cap) { // casquette, visière vers l'avant
      g.add(mesh(dome, style.cap, [0, 0.105, -0.025], [0.128, 0.125, 0.13]));
      const v = mesh(cyl, style.cap, [0, 0.13, 0.115], [0.1, 0.012, 0.09]); v.rotation.x = 0.12; g.add(v);
    }
    if (style.headband) g.add(mesh(ring, style.headband, [0, 0.155, 0], [0.107, 0.107, 0.15]).rotateX(Math.PI / 2));
    if (style.glasses) {
      for (const sx of [-1, 1]) g.add(mesh(ring, style.glasses, [sx * 0.038, 0.1, 0.128], [0.032, 0.032, 0.032]));
      g.add(mesh(box, style.glasses, [0, 0.103, 0.131], [0.012, 0.006, 0.006]));
    }
    if (style.beard) g.add(mesh(sphere, hair, [0, 0.045, 0.045], [0.07, 0.05, 0.06]));
    void c; void skin;
  }
  if (spine) {
    if (style.backpack) { // sac à dos plaqué contre les omoplates
      const g = new THREE.Group(); g.position.set(0, 0.02, -0.15);
      g.add(mesh(box, style.backpack, [0, 0, 0], [0.27, 0.34, 0.13]));
      g.add(mesh(box, '#38e8ff', [0, 0.02, -0.068], [0.2, 0.025, 0.01], { emissive: '#38e8ff', emissiveIntensity: 0.6 }));
      spine.add(g);
    }
    if (style.hood) spine.add(mesh(sphere, style.hood, [0, 0.13, -0.075], [0.15, 0.07, 0.09]));
    if (style.scarf) spine.add(mesh(ring, style.scarf, [0, 0.14, 0], [0.12, 0.12, 0.2]).rotateX(Math.PI / 2));
  }
  if (low && style.belt) {
    const g = new THREE.Group(); g.position.set(0, 0.0, 0);
    g.add(mesh(ring, '#3a2f26', [0, 0, 0], [0.17, 0.12, 0.35]).rotateX(Math.PI / 2));
    g.add(mesh(box, style.belt, [0.17, -0.04, 0.02], [0.07, 0.11, 0.08])); // poche d'outils sur la hanche
    const w = mesh(cyl, '#b8bcc6', [-0.18, -0.05, 0.02], [0.012, 0.2, 0.012], { metalness: 0.6, roughness: 0.4 }); w.rotation.z = 0.15; g.add(w); // clé à molette
    low.add(g);
  }
}
