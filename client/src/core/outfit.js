// Tenues : colore le mannequin Quaternius par zone du corps (couleurs de sommets via les poids du squelette).
// Permet 3 persos jouables et des piétons distincts avec un seul maillage et le même squelette.
import * as THREE from 'three';

/** @typedef {{ skin: string, hair: string, top: string, bottom: string, shoes: string }} Outfit */

// Zone du corps selon le nom de l'os dominant du sommet
function zoneOf(bone) {
  const n = bone.replace(/^DEF-/, '');
  if (/^(head|neck)/.test(n)) return 'head';
  if (/^(hand|f_|thumb|forearm)/.test(n)) return 'skin';
  if (/^(spine|shoulder|upper_arm)/.test(n)) return 'top';
  if (/^(hips|thigh|shin)/.test(n)) return 'bottom';
  if (/^(foot|toe)/.test(n)) return 'shoes';
  return 'top';
}

/**
 * Applique une tenue à un modèle cloné (via assets.clone). La géométrie et les matériaux sont dupliqués :
 * le modèle d'origine reste intact. Renvoie le modèle.
 * @param {THREE.Object3D} model
 * @param {Outfit} outfit couleurs CSS
 */
export function applyOutfit(model, outfit) {
  const col = Object.fromEntries(Object.entries(outfit).map(([k, v]) => [k, new THREE.Color(v)]));
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const geo = o.geometry.clone();
    const pos = geo.attributes.position, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
    const bones = o.skeleton.bones;
    const head = bones.find((b) => b.name === 'DEF-head');
    const headY = head ? new THREE.Vector3().setFromMatrixPosition(head.matrixWorld).y : 99;
    const inv = new THREE.Matrix4().copy(o.matrixWorld).invert();
    const headLocalY = new THREE.Vector3(0, headY, 0).applyMatrix4(inv).y;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      let best = 0, bw = -1;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
      let zone = zoneOf(bones[best]?.name || '');
      // le haut du crâne devient la chevelure
      if (zone === 'head') zone = pos.getY(i) > headLocalY + 0.13 ? 'hair' : 'skin';
      const c = col[zone] || col.skin;
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    o.geometry = geo;
    o.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 });
    o.castShadow = true;
    o.frustumCulled = false; // les maillages skinnés ont des bornes de bind pose
  });
  return model;
}
