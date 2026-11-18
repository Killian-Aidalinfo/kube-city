// Fabrique de personnages animés (mannequin + clips UAL) avec repli procédural. Partagée par PNJ et police.
import * as THREE from 'three';

const kitCache = new WeakMap();

/** Charge le mannequin et ses animations (une fois). Renvoie null si indisponible. */
export function loadKit(game) {
  if (!kitCache.has(game)) {
    kitCache.set(game, (async () => {
      try {
        const m = game.assets.manifest;
        const gltf = await game.assets.loadGLTF('/assets/' + (m?.characters?.model ?? 'animations/ual.glb'));
        return { gltf, clips: new Map(gltf.animations.map((c) => [c.name, c])), protos: new Map() };
      } catch (e) { console.warn('[npc] mannequin indisponible, repli procédural', e?.message); return null; }
    })());
  }
  return kitCache.get(game);
}

/** Tenues de piétons du manifest (repli : quelques couleurs). */
export function pedOutfits(game) {
  const o = game.assets.manifest?.characters?.pedestrians;
  const list = o?.length ? o : ['#e8b949', '#7bbf6a', '#c94c8f', '#4aa3df'].map((top) => ({ skin: '#e0ac8a', hair: '#3a2a1a', top, bottom: '#2b2b2b', shoes: '#222222' }));
  return list.map((f, i) => ({ ...f, style: f.style ?? pedStyle(i) }));
}

// Silhouettes et accessoires de piétons : combinaisons déterministes (même indice = même passant)
const PED_BUILDS = [
  { h: 1.04, w: 1.04, shoulders: 1.08 },                                                 // costaud
  { h: 0.95, w: 0.97, shoulders: 0.88, waist: 0.85, hips: 1.1, bust: 1.06 },             // silhouette féminine
  { h: 0.9, w: 1.0 },                                                                    // petit
  { h: 1.0, w: 0.93 },                                                                   // élancé
  { h: 0.97, w: 1.05, waist: 1.12 },                                                     // rond
  { h: 0.93, w: 0.95, shoulders: 0.9, waist: 0.86, hips: 1.08, bust: 1.05 },             // féminine, petite
];
const PED_HAIR = ['short', 'short', 'afro', 'bald', 'short', 'ponytail', 'bun'];
const PED_BAGS = ['#6b4a2b', '#2b4f7a', '#7a2b3f', '#3a3a3a'];
function pedStyle(i) {
  const build = PED_BUILDS[(i * 5 + 1) % PED_BUILDS.length];
  const feminine = (build.hips ?? 1) > 1.05;
  const hair = feminine ? ['long', 'ponytail', 'bun', 'short'][(i * 3) % 4] : PED_HAIR[(i * 7) % PED_HAIR.length];
  const s = { build, hair };
  if (i % 5 === 2) s.glasses = '#222222';
  if (i % 7 === 3 && !feminine) s.cap = ['#c94c4c', '#3a6ab0', '#2b2b2b'][i % 3];
  if (i % 6 === 4) s.backpack = PED_BAGS[i % PED_BAGS.length];
  if (i % 9 === 5 && !feminine) s.beard = true;
  if (i % 8 === 6) s.scarf = ['#d4513f', '#e8b949', '#7bbf6a'][i % 3];
  return s;
}

/** Prototype coloré par tenue : les clones partagent géométrie et matériaux (peu coûteux). */
function proto(game, kit, outfit) {
  const key = JSON.stringify(outfit);
  if (!kit.protos.has(key)) {
    const m = game.assets.clone(kit.gltf);
    m.traverse((o) => { if (o.isSkinnedMesh) o.castShadow = true; });
    kit.protos.set(key, game.assets.applyOutfit(m, outfit));
  }
  return kit.protos.get(key);
}

/** Version procédurale (boîtes) quand le mannequin n'est pas chargé. */
function fallbackBody(outfit) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.3), mat(outfit.top)); body.position.y = 1.15;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.75, 0.25), mat(outfit.bottom)); legs.position.y = 0.4;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), mat(outfit.skin)); head.position.y = 1.7;
  for (const m of [body, legs, head]) m.castShadow = true;
  g.add(body, legs, head);
  return g;
}

/**
 * Crée un personnage animé.
 * @returns {{ root: THREE.Group, play(name: string, o?: {fade?: number, loop?: boolean, speed?: number}): void, update(dt: number): void, has(name: string): boolean, current: string, dispose(): void }}
 */
export function createCharacter(game, kit, outfit) {
  const root = new THREE.Group();
  const model = kit ? game.assets.clone(proto(game, kit, outfit)) : fallbackBody(outfit);
  root.add(model);
  const mixer = kit ? new THREE.AnimationMixer(model) : null;
  const actions = new Map();
  let curName = '', cur = null, t = Math.random() * 10;
  const get = (name) => {
    if (!actions.has(name)) {
      const clip = kit?.clips.get(name);
      actions.set(name, clip ? mixer.clipAction(clip) : null);
    }
    return actions.get(name);
  };
  return {
    root, model,
    get current() { return curName; },
    has: (n) => !!kit?.clips.has(n),
    play(name, { fade = 0.2, loop = true, speed = 1 } = {}) {
      if (name === curName) { if (cur) cur.timeScale = speed; return; }
      curName = name;
      const a = get(name);
      if (!a) { cur = null; return; }
      a.reset();
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !loop;
      a.timeScale = speed;
      a.play();
      if (cur && cur !== a) cur.crossFadeTo(a, fade, false);
      else a.fadeIn(fade);
      cur = a;
    },
    update(dt) {
      if (mixer) mixer.update(dt);
      else { t += dt; model.position.y = curName.includes('Walk') || curName.includes('Jog') ? Math.abs(Math.sin(t * 8)) * 0.05 : 0; }
    },
    dispose() { mixer?.stopAllAction(); root.removeFromParent(); },
  };
}
