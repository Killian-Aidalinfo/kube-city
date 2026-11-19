// Rendu Three.js : renderer, scène, caméra, ombres réglables, resize, pixel ratio plafonné.
import * as THREE from 'three';

/** GPU logiciel (SwiftShader, llvmpipe…) : le MSAA y coûte ~2x le temps de frame. */
function softwareGpu() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return !gl || /swiftshader|llvmpipe|software|basic render/i.test(ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '');
  } catch { return false; }
}

export function createRenderer(canvas, settings) {
  const lowEnd = softwareGpu();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowEnd && settings.get('quality') !== 'low', powerPreference: 'high-performance' });
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
    // plan lointain = fin du brouillard (rien n'est visible au-delà) : le frustum élimine le reste de la ville
    camera.far = Math.max(300, settings.get('viewDistance') * 1.1);
    camera.updateProjectionMatrix();
    resize();
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    // qualité Basse : résolution interne plafonnée à 0,5 (mesuré : 17 -> 30 i/s en rendu logiciel)
    const cap = settings.get('quality') === 'low' ? Math.min(0.5, settings.get('maxPixelRatio')) : settings.get('maxPixelRatio');
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  window.addEventListener('resize', resize);
  settings.onChange((k) => { if (['quality', 'shadows', 'viewDistance', 'maxPixelRatio', 'shadowMapSize'].includes(k) || k === '*') applySettings(); });
  applySettings();

  return { scene, camera, renderer, resize, applySettings };
}
