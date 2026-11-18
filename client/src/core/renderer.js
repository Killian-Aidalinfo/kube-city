// Rendu Three.js : renderer, scène, caméra, ombres réglables, resize, pixel ratio plafonné.
import * as THREE from 'three';

export function createRenderer(canvas, settings) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft a été retiré de Three r18x

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b8e8);
  scene.fog = new THREE.Fog(0x87b8e8, 150, settings.get('viewDistance'));

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
  camera.position.set(0, 5, 10);

  function applySettings() {
    renderer.shadowMap.enabled = !!settings.get('shadows');
    renderer.shadowMap.needsUpdate = true;
    if (scene.fog) scene.fog.far = settings.get('viewDistance');
    resize();
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.get('maxPixelRatio')));
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  window.addEventListener('resize', resize);
  settings.onChange((k) => { if (['shadows', 'viewDistance', 'maxPixelRatio', 'shadowMapSize'].includes(k) || k === '*') applySettings(); });
  applySettings();

  return { scene, camera, renderer, resize, applySettings };
}
