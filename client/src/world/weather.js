// Météo : soleil, nuageux, pluie (traits animés par le GPU). Expose cloud, rain, wetness (adhérence réduite).
import * as THREE from 'three';

const VS = `
attribute float aEnd; uniform float uTime; uniform vec3 uCam; varying float vA;
void main(){
  vec3 p = position;
  p.y = mod(p.y - uTime * 30.0, 40.0);
  p.xz = mod(p.xz - uCam.xz + 30.0, 60.0) - 30.0;
  vec3 w = vec3(uCam.x + p.x, uCam.y - 14.0 + p.y, uCam.z + p.z);
  w.y += aEnd * 1.1; w.x += aEnd * 0.14;
  vA = 1.0 - aEnd * 0.7;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const FS = `uniform float uAlpha; varying float vA; void main(){ gl_FragColor = vec4(0.72, 0.8, 0.9, uAlpha * vA * 0.55); }`;

export function createWeather(game, roadMat) {
  const N = 2600, pos = new Float32Array(N * 6), end = new Float32Array(N * 2), rnd = mulberry(77);
  for (let i = 0; i < N; i++) {
    const x = rnd() * 60 - 30, y = rnd() * 40, z = rnd() * 60 - 30;
    pos.set([x, y, z, x, y, z], i * 6); end[i * 2] = 0; end[i * 2 + 1] = 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uCam: { value: new THREE.Vector3() } } });
  const rainMesh = new THREE.LineSegments(g, mat);
  rainMesh.frustumCulled = false; rainMesh.visible = false; rainMesh.renderOrder = 5;
  game.three.scene.add(rainMesh);

  const TARGET = { clair: [0, 0], nuageux: [0.75, 0], pluie: [1, 1] };
  const w = {
    state: 'clair', cloud: 0, rain: 0, wetness: 0, auto: true,
    /** Change la météo : 'clair' | 'nuageux' | 'pluie'. */
    set(s) { if (!TARGET[s]) return; w.state = s; game.bus.emit('weather:changed', { state: s }); },
    update(dt) {
      const [c, r] = TARGET[w.state], k = Math.min(1, dt * 0.25);
      w.cloud += (c - w.cloud) * k; w.rain += (r - w.rain) * Math.min(1, dt * 0.35);
      w.wetness += ((w.rain > 0.2 ? 1 : 0) - w.wetness) * Math.min(1, dt * (w.rain > 0.2 ? 0.15 : 0.03));
      rainMesh.visible = w.rain > 0.02;
      mat.uniforms.uTime.value += dt; mat.uniforms.uAlpha.value = w.rain; mat.uniforms.uCam.value.copy(game.three.camera.position);
      // route mouillée : plus sombre et plus brillante
      if (roadMat) { roadMat.roughness = 0.92 - 0.6 * w.wetness; roadMat.color.setScalar(1 - 0.35 * w.wetness); }
      // changement aléatoire lent : toutes les 3 à 6 minutes de jeu réel
      if (w.auto) {
        w._t = (w._t ?? 150 + rnd() * 120) - dt;
        if (w._t <= 0) { w._t = 180 + rnd() * 180; const roll = rnd(); w.set(roll < 0.55 ? 'clair' : roll < 0.8 ? 'nuageux' : 'pluie'); }
      }
    },
  };
  return w;
}
function mulberry(a) { return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
