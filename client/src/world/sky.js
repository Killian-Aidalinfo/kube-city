// Ciel, soleil, lune, brouillard et lumières selon l'heure (dayTime ∈ [0, 24)) et la météo.
import * as THREE from 'three';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const C = (h) => new THREE.Color(h);
const DAY = { zen: C(0x2f7fd6), hor: C(0xb8dcf5), hemiSky: C(0xcfe6ff), hemiGround: C(0x6a7a55) };
const DUSK = { zen: C(0x3b3a7a), hor: C(0xff9460) };
const NIGHT = { zen: C(0x050a1e), hor: C(0x1b2a5c), hemiSky: C(0x8294e6), hemiGround: C(0x3c4468) };
const OVERCAST = C(0x9aa3ad);

const SKY_VS = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`;
const SKY_FS = `
varying vec3 vDir;
uniform vec3 uZen, uHor, uSun; uniform float uNight, uCloud, uTime, uDusk;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*noise(p); p*=2.03; a*=0.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHor, uZen, pow(h, 0.55));
  if (d.y < 0.0) col = mix(uHor, uHor * 0.55, clamp(-d.y * 4.0, 0.0, 1.0));
  float sd = max(dot(d, uSun), 0.0);
  col += vec3(1.0, 0.85, 0.6) * (pow(sd, 600.0) * 3.0 + pow(sd, 12.0) * 0.28 * (1.0 + uDusk)) * (1.0 - uNight * 0.9) * (1.0 - uCloud * 0.7);
  // lune et étoiles
  float md = max(dot(d, -uSun), 0.0);
  col += vec3(0.85, 0.9, 1.0) * smoothstep(0.9993, 0.9997, md) * uNight;
  vec2 sp = d.xz / (abs(d.y) + 0.4) * 140.0, cf = fract(sp) - 0.5; float hs = hash(floor(sp));
  float st = step(0.985, hs) * smoothstep(0.22, 0.0, length(cf)) * (0.6 + 0.4 * sin(uTime * 2.0 + hs * 40.0));
  col += vec3(st) * uNight * smoothstep(0.02, 0.3, d.y) * (1.0 - uCloud);
  // nuages
  if (d.y > 0.0) {
    vec2 cp = d.xz / (d.y + 0.25) * 1.6 + vec2(uTime * 0.01, 0.0);
    float c = smoothstep(0.55 - uCloud * 0.35, 0.85 - uCloud * 0.2, fbm(cp));
    vec3 cc = mix(vec3(1.0), vec3(0.55, 0.58, 0.64), uCloud * 0.8) * mix(1.0, 0.12, uNight);
    cc = mix(cc, uHor * 1.2, uDusk * 0.5);
    col = mix(col, cc, c * smoothstep(0.0, 0.2, d.y) * (0.35 + 0.65 * uCloud));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createSky(game) {
  const { scene, camera } = game.three;
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uNight: { value: 0 }, uCloud: { value: 0 }, uTime: { value: 0 }, uDusk: { value: 0 } },
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16), mat);
  dome.frustumCulled = false; dome.renderOrder = -10;
  scene.add(dome);

  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x6a7a55, 0.9);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  const moon = new THREE.DirectionalLight(0x6f86d0, 0);
  sun.castShadow = true;
  const ss = game.settings.get('shadowMapSize');
  sun.shadow.mapSize.set(ss, ss);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 420 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
  scene.add(hemi, sun, sun.target, moon, moon.target);
  game.settings.onChange((k) => { if (k === 'shadowMapSize') { const v = game.settings.get('shadowMapSize'); sun.shadow.map?.dispose(); sun.shadow.map = null; sun.shadow.mapSize.set(v, v); } });

  const state = { daylight: 1, night: 0, sunDir: new THREE.Vector3(0, 1, 0), horizon: new THREE.Color(), cloud: 0 };
  const tmp = new THREE.Color(), tmp2 = new THREE.Color();
  const sunDir = state.sunDir;

  /** Met à jour tout selon l'heure ; weather = { cloud, rain } (0..1). */
  function update(dayTime, weather, dt) {
    const a = ((dayTime - 6) / 12) * Math.PI, elev = Math.sin(a);
    sunDir.set(Math.cos(a) * 0.82, elev, 0.57).normalize();
    const day = smooth(-0.1, 0.28, elev), night = 1 - day, dusk = Math.exp(-((elev / 0.2) ** 2)) * (elev > -0.25 ? 1 : 0);
    const cloud = weather.cloud;
    state.daylight = day * (1 - 0.35 * cloud); state.night = night; state.cloud = cloud;
    tmp.copy(NIGHT.hor).lerp(DAY.hor, day).lerp(DUSK.hor, dusk * 0.85).lerp(OVERCAST, cloud * 0.6 * (0.25 + day * 0.75));
    tmp2.copy(NIGHT.zen).lerp(DAY.zen, day).lerp(DUSK.zen, dusk * 0.7).lerp(OVERCAST, cloud * 0.5 * day);
    mat.uniforms.uHor.value.copy(tmp); mat.uniforms.uZen.value.copy(tmp2);
    mat.uniforms.uSun.value.copy(sunDir);
    mat.uniforms.uNight.value = night; mat.uniforms.uCloud.value = cloud; mat.uniforms.uDusk.value = dusk; mat.uniforms.uTime.value += dt;
    state.horizon.copy(tmp);
    scene.background = state.horizon;
    if (scene.fog) { scene.fog.color.copy(tmp); scene.fog.near = 120 - cloud * 50; scene.fog.far = game.settings.get('viewDistance') * (1 - weather.rain * 0.35) * (1 - night * 0.2); }
    dome.position.copy(camera.position);
    // lumières
    hemi.color.copy(NIGHT.hemiSky).lerp(DAY.hemiSky, day); hemi.groundColor.copy(NIGHT.hemiGround).lerp(DAY.hemiGround, day);
    hemi.intensity = (0.85 + 0.2 * day) * (1 - 0.25 * cloud);
    sun.color.setRGB(1, 0.78 + 0.22 * Math.min(1, elev * 3), 0.55 + 0.45 * Math.min(1, elev * 3));
    sun.intensity = 2.4 * day * (1 - 0.7 * cloud);
    sun.castShadow = sun.intensity > 0.05; // pas de carte d'ombre la nuit
    moon.intensity = 0.9 * night * (1 - 0.5 * cloud);
    // le soleil suit la caméra (ombres nettes autour du joueur), position calée sur la grille d'ombre
    const snap = (v) => Math.round(v / 1.5) * 1.5;
    const fx = snap(camera.position.x), fz = snap(camera.position.z);
    sun.target.position.set(fx, 0, fz); sun.position.set(fx + sunDir.x * 200, Math.max(sunDir.y, 0.12) * 200, fz + sunDir.z * 200);
    sun.target.updateMatrixWorld();
    moon.target.position.set(fx, 0, fz); moon.position.set(fx - sunDir.x * 100, 100, fz - sunDir.z * 100);
    moon.target.updateMatrixWorld();
    game.three.renderer.toneMappingExposure = 1;
  }
  return { update, state, sun, hemi, moon, dome };
}
