// Portraits 3D des persos : le mannequin colorié (core/outfit.js) est rendu une fois dans une image,
// avec une pose d'attente de la bibliothèque d'animations. Repli : silhouette dessinée en 2D.
import * as THREE from 'three';

const W = 360, H = 480;

/** Silhouette 2D de secours (si le modèle ou WebGL est indisponible). */
function fallbackPortrait(outfit) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const body = (col, x, y, w, h, r = 12) => { g.fillStyle = col; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); };
  body(outfit.shoes, 128, 410, 46, 28); body(outfit.shoes, 186, 410, 46, 28);
  body(outfit.bottom, 128, 270, 104, 150, 10);
  body(outfit.top, 112, 150, 136, 140, 22);
  body(outfit.skin, 84, 160, 30, 120, 14); body(outfit.skin, 246, 160, 30, 120, 14);
  body(outfit.skin, 158, 120, 44, 40, 10);
  g.fillStyle = outfit.skin; g.beginPath(); g.ellipse(180, 90, 40, 48, 0, 0, 7); g.fill();
  g.fillStyle = outfit.hair; g.beginPath(); g.ellipse(180, 66, 44, 34, 0, Math.PI, 0); g.fill();
  return c.toDataURL('image/png');
}

/**
 * Rend les portraits de plusieurs persos avec un seul moteur WebGL temporaire.
 * @param {object} game
 * @param {Record<string, object>} outfits id → tenue
 * @returns {Promise<Record<string, string>>} id → URL de l'image
 */
export async function renderPortraits(game, outfits) {
  const out = {};
  let renderer = null, gltf = null;
  try {
    const url = '/assets/' + (game.assets.manifest?.characters?.model || 'animations/ual.glb');
    gltf = await game.assets.loadGLTF(url);
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(W, H, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } catch (e) { console.warn('[portrait] repli 2D :', e.message); }

  for (const [id, outfit] of Object.entries(outfits)) {
    if (!renderer) { out[id] = fallbackPortrait(outfit); continue; }
    try {
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x302040, 1.6));
      const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(2, 3, 4); scene.add(key);
      const rim = new THREE.DirectionalLight(0x38e8ff, 2.2); rim.position.set(-3, 2, -2); scene.add(rim);
      const pink = new THREE.DirectionalLight(0xff4fa3, 1.4); pink.position.set(3, 0.5, -2); scene.add(pink);
      const model = game.assets.applyOutfit(game.assets.clone(gltf), outfit);
      model.rotation.y = -0.45;
      scene.add(model);
      // pose d'attente
      const clip = gltf.animations.find((a) => a.name === 'Idle_Loop') || gltf.animations[0];
      if (clip) { const mixer = new THREE.AnimationMixer(model); mixer.clipAction(clip).play(); mixer.update(0.9); }
      model.updateMatrixWorld(true);
      const cam = new THREE.PerspectiveCamera(26, W / H, 0.1, 50);
      cam.position.set(0, 1.0, 5.2); cam.lookAt(0, 0.92, 0);
      renderer.render(scene, cam);
      out[id] = renderer.domElement.toDataURL('image/png');
      scene.traverse((o) => { o.geometry?.dispose?.(); });
    } catch (e) { console.warn('[portrait] échec', id, e.message); out[id] = fallbackPortrait(outfit); }
  }
  if (renderer) { renderer.dispose(); renderer.forceContextLoss?.(); }
  return out;
}
