// Eau animée de la plage : nappe avec vagues, écume au rivage, reflets du ciel (shader maison, avec brouillard).
import * as THREE from 'three';
import { WATER_LEVEL } from './citygen.js';

const VS = `
uniform float uTime; varying vec3 vW;
#include <fog_pars_vertex>
void main(){
  vec3 p = position;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  float w = sin(wp.x * 0.07 + uTime * 0.9) * 0.12 + sin(wp.z * 0.11 - uTime * 1.3) * 0.1 + sin((wp.x + wp.z) * 0.2 + uTime * 1.9) * 0.05;
  wp.y += w;
  vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FS = `
uniform float uTime, uLight; uniform vec3 uSun, uSky, uDeep, uShallow, uCam;
varying vec3 vW;
#include <fog_pars_fragment>
float shoreZ(float x){ return 446.0 + 12.0 * sin(x / 70.0) + 7.0 * sin(x / 23.0 + 1.0); }
void main(){
  float s = vW.z - shoreZ(vW.x);                                   // distance au rivage (m)
  vec2 q = vW.xz;
  vec3 n = normalize(vec3(
    cos(q.x * 0.35 + uTime * 1.1) * 0.12 + cos(q.x * 0.9 - q.y * 0.6 + uTime * 1.7) * 0.06,
    1.0,
    cos(q.y * 0.3 - uTime * 0.9) * 0.12 + cos(q.y * 0.8 + q.x * 0.5 - uTime * 1.5) * 0.06));
  vec3 v = normalize(uCam - vW);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 base = mix(uShallow, uDeep, smoothstep(0.0, 45.0, s));
  vec3 col = mix(base, uSky, fres * 0.65);
  vec3 r = reflect(-v, n);
  col += vec3(1.0, 0.92, 0.75) * pow(max(dot(r, uSun), 0.0), 140.0) * 2.0 * uLight;
  float foam = smoothstep(2.4 + sin(vW.x * 0.3 + uTime * 1.4) * 0.7, 0.0, s) + smoothstep(0.8, 0.0, abs(fract(s * 0.18 - uTime * 0.06) - 0.5) * 2.0 - 0.6) * smoothstep(14.0, 2.0, s) * 0.5;
  col = mix(col, vec3(1.0), clamp(foam, 0.0, 1.0) * 0.85);
  col *= 0.14 + 0.86 * uLight;
  float alpha = mix(0.55, 0.95, smoothstep(0.0, 10.0, s)) * (1.0 - clamp(foam, 0.0, 1.0) * 0.2);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function createWater(game) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uLight: { value: 1 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSky: { value: new THREE.Color(0xa8d4f2) },
    uDeep: { value: new THREE.Color(0x0a4d78) }, uShallow: { value: new THREE.Color(0x3fc5c8) }, uCam: { value: new THREE.Vector3() },
  }]);
  const mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms, transparent: true, depthWrite: false, fog: true });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1500, 340, 150, 34), mat);
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(0, WATER_LEVEL, 560); mesh.renderOrder = 2; mesh.frustumCulled = false;
  game.three.scene.add(mesh);
  return {
    mesh,
    update(dt, sky) {
      uniforms.uTime.value += dt;
      uniforms.uLight.value = Math.max(0.02, sky.daylight);
      uniforms.uSun.value.copy(sky.sunDir);
      uniforms.uSky.value.copy(sky.horizon);
      uniforms.uCam.value.copy(game.three.camera.position);
    },
  };
}
