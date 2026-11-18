// Chargeur d'assets avec cache par URL et manifest (spec 3.4).
// Les modules n'ouvrent jamais de fichier eux-mêmes : game.assets.loadGLTF('/assets/...').
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { applyOutfit } from './outfit.js';

export function createAssets(bus) {
  const gltfLoader = new GLTFLoader();
  const texLoader = new THREE.TextureLoader();
  const cache = new Map();         // url → Promise
  const progress = { loaded: 0, total: 0 };
  let manifest = null;

  const track = (p) => {
    progress.total++;
    bus.emit('assets:progress', { ...progress });
    return p.finally(() => { progress.loaded++; bus.emit('assets:progress', { ...progress }); });
  };
  const cached = (key, make) => {
    if (!cache.has(key)) {
      const p = track(make());
      p.catch(() => cache.delete(key)); // une erreur ne reste pas en cache
      cache.set(key, p);
    }
    return cache.get(key);
  };

  const assets = {
    progress,
    /** Charge le manifest (une fois) ; renvoie null s'il est absent. */
    async loadManifest(url = '/assets/manifest.json') {
      if (manifest) return manifest;
      try { const r = await fetch(url); manifest = r.ok ? await r.json() : null; } catch { manifest = null; }
      return manifest;
    },
    get manifest() { return manifest; },
    /** @returns {Promise<{scene: THREE.Group, animations: THREE.AnimationClip[]}>} */
    loadGLTF: (url) => cached(url, () => gltfLoader.loadAsync(url)),
    /** @returns {Promise<THREE.Texture>} (sRGB par défaut ; colorSpace=false pour normales/rugosité) */
    loadTexture: (url, { srgb = true, repeat = true } = {}) => cached(`tex:${url}:${srgb}`, async () => {
      const t = await texLoader.loadAsync(url);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 4;
      return t;
    }),
    /** Charge un fichier JSON (cache). */
    loadJSON: (url) => cached(`json:${url}`, async () => (await fetch(url)).json()),
    /** Charge un son décodé (nécessite un AudioContext). */
    loadAudio: (url, ctx) => cached(`aud:${url}`, async () => ctx.decodeAudioData(await (await fetch(url)).arrayBuffer())),
    /**
     * Clone un modèle chargé : SkeletonUtils.clone (squelettes corrects pour les modèles animés).
     * Les matériaux sont partagés ; passer { materials: true } pour les dupliquer (teintes).
     */
    clone(gltf, { materials = false } = {}) {
      const scene = cloneSkinned(gltf.scene ?? gltf);
      if (materials) scene.traverse((o) => { if (o.material) o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone(); });
      return scene;
    },
    /** Colore un clone du mannequin par zones (peau, cheveux, haut, bas, chaussures) — voir core/outfit.js. */
    applyOutfit,
    /** Précharge une liste d'URL glb/png/jpg ; ne rejette jamais (renvoie le nombre d'échecs). */
    async preload(urls) {
      let fails = 0;
      await Promise.all(urls.map((u) => (/\.(png|jpe?g)$/i.test(u) ? assets.loadTexture(u) : assets.loadGLTF(u)).catch(() => { fails++; })));
      return fails;
    },
  };
  return assets;
}
