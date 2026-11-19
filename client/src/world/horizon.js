// Lointain : silhouettes (montagnes, collines, îles, skyline d'une autre ville, pont) en UN maillage collé à la caméra,
// plus quelques cargos qui croisent au large (1 InstancedMesh) et leurs feux de nuit (1 Points). Aucune collision.
// Niveaux (réglage « lointain ») : 'off' rien, 'light' silhouettes seules, 'full' avec bateaux. Procédural, sans texture.
import * as THREE from 'three';
import { mulberry32, WATER_LEVEL } from './citygen.js';
import { glowTexture } from './textures.js';

const R = 850, BASE = -8, RAD = Math.PI / 180;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const VS = `
attribute vec3 aInfo; varying vec3 vCol, vInfo; varying vec2 vUv;
void main(){ vCol = color; vInfo = aInfo; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FS = `
uniform vec3 uHor; uniform float uTone, uNight;
varying vec3 vCol, vInfo; varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec3 col = mix(vCol * uTone, uHor, vInfo.x);                    // brume : plus loin = plus proche de l'horizon
  if (vInfo.y > 0.5 && vInfo.y < 1.5) {                           // tour : fenêtres allumées la nuit
    vec2 c = floor(vUv), f = fract(vUv);
    float lit = step(0.55, hash(c)) * step(0.2, f.x) * step(f.x, 0.8) * step(0.2, f.y) * step(f.y, 0.75);
    col += vec3(1.0, 0.8, 0.5) * lit * uNight * (0.45 + 0.55 * hash(c + 7.0)) * (1.0 - vInfo.x * 0.4);
  } else if (vInfo.y > 1.5) col = mix(col, vCol, uNight);         // feu : pleine couleur la nuit
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

class Sil {
  constructor() { this.p = []; this.c = []; this.a = []; this.u = []; this.i = []; this.n = 0; }
  v(x, y, z, col, haze, kind = 0, u = 0, w = 0) { this.p.push(x, y, z); this.c.push(col[0], col[1], col[2]); this.a.push(haze, kind, 0); this.u.push(u, w); return this.n++; }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.a, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 2);
    return g;
  }
}
const at = (az, y) => [R * Math.sin(az), y, R * Math.cos(az)];
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** Bruit 1D sur l'azimuth : somme de sinus à phases tirées (déterministe). */
function noiseFn(seed, freqs = [5, 13, 29, 61]) {
  const r = mulberry32(seed), ph = freqs.map(() => r() * 6.283);
  return (az) => { let s = 0, a = 0.5, n = 0; freqs.forEach((f, k) => { s += Math.sin(az * f + ph[k]) * a; n += a; a *= 0.55; }); return s / n * 0.5 + 0.5; };
}

/** Bande de relief entre deux azimuts ; fn(az) = hauteur du sommet (m) ; le pied descend sous l'horizon. */
function ridge(S, az0, az1, step, fn, col, haze) {
  let prev = null;
  for (let az = az0; az <= az1 + 1e-6; az += step) {
    const h = fn(az), t = at(az, h), b = at(az, BASE);
    const cur = [S.v(t[0], t[1], t[2], shade(col, 1.07), haze), S.v(b[0], b[1], b[2], shade(col, 0.9), haze)];
    if (prev) S.quad(prev[0], cur[0], cur[1], prev[1]);
    prev = cur;
  }
}

/** Rectangle vertical centré sur l'azimuth az (largeur w m, de y0 à y1) ; fenêtres si kind = 1. */
function slab(S, az, w, y0, y1, col, haze, kind = 0, uv0 = 0) {
  const da = w / 2 / R, l = at(az - da, 0), r = at(az + da, 0), u1 = uv0 + w / 7;
  S.quad(S.v(l[0], y0, l[2], col, haze, kind, uv0, y0 / 9), S.v(r[0], y0, r[2], col, haze, kind, u1, y0 / 9), S.v(r[0], y1, r[2], shade(col, 1.05), haze, kind, u1, y1 / 9), S.v(l[0], y1, l[2], shade(col, 1.05), haze, kind, uv0, y1 / 9));
}

/** Skyline : tours serrées par grappes (rangée arrière brumeuse, rangée avant plus sombre). */
function skyline(S, az0, az1, seed, centers, hMax, col, haze, density) {
  const r = mulberry32(seed);
  let az = az0;
  while (az < az1) {
    const w = 10 + r() * 24, edge = smooth(0, 6 * RAD, az - az0) * smooth(0, 6 * RAD, az1 - az);
    let cl = 0; for (const c of centers) cl = Math.max(cl, Math.exp(-(((az - c[0]) / c[1]) ** 2)));
    const h = (14 + hMax * cl * cl * (0.35 + 0.65 * r()) + 10 * r()) * edge;
    if (h > 6 && r() < density) {
      const k = 0.88 + r() * 0.22, c = [col[0] * k, col[1] * k, col[2] * (0.95 + r() * 0.1)], uv0 = r() * 40;
      slab(S, az, w, BASE, h, c, haze, 1, uv0);
      if (r() < 0.45) slab(S, az, w * 0.6, h - 1, h * (1.08 + r() * 0.12), c, haze, 1, uv0 + 3);          // retrait
      if (r() < 0.2) slab(S, az, 1.4, h, h + 14 + r() * 26, shade(c, 0.9), haze, 0);                        // antenne
    }
    az += (w * (0.7 + r() * 0.5)) / R;
  }
}

/** Île : bosse lisse + éventuel phare (feu ambre la nuit). */
function island(S, azC, halfDeg, h, seed, col, lighthouse = false) {
  const n = noiseFn(seed, [9, 23, 47]), half = halfDeg * RAD;
  ridge(S, azC - half, azC + half, 0.35 * RAD, (az) => h * Math.pow(Math.max(0, 1 - ((az - azC) / half) ** 2), 0.8) * (0.7 + 0.5 * n(az)), col, 0.22);
  if (lighthouse) {
    const top = h * 0.8;
    slab(S, azC + half * 0.1, 2.6, top - 2, top + 20, [0.9, 0.88, 0.82], 0.2, 0);
    slab(S, azC + half * 0.1, 4, top + 20, top + 24, [1, 0.8, 0.35], 0, 2);
  }
}

/** Pont suspendu qui file vers l'horizon : tablier, deux pylônes, câbles, haubans, guirlande de feux. */
function bridge(S, azA, azB, col) {
  const deck0 = 13, deck1 = 16.5, pyl = [azA + (azB - azA) * 0.3, azA + (azB - azA) * 0.7], H = 98;
  const seg = (a0, y0, a1, y1, th) => { const p = at(a0, y0), q = at(a1, y1); S.quad(S.v(p[0], p[1] - th, p[2], col, 0.25), S.v(q[0], q[1] - th, q[2], col, 0.25), S.v(q[0], q[1] + th, q[2], col, 0.25), S.v(p[0], p[1] + th, p[2], col, 0.25)); };
  seg(azA, (deck0 + deck1) / 2, azB, (deck0 + deck1) / 2, (deck1 - deck0) / 2);
  const dm = (azB - azA) * 0.4;
  for (const pz of pyl) {
    for (const o of [-5, 5]) slab(S, pz + o / R, 3.2, BASE, H, shade(col, 0.95), 0.15, 0);
    for (const y of [55, 88]) slab(S, pz, 10, y, y + 3.5, col, 0.15, 0);
    slab(S, pz + 6 / R, 2.2, H, H + 3, [1, 0.12, 0.08], 0, 2);
    // câbles : pylône → mi-travée (catenaire) de chaque côté, puis haubans verticaux
    for (const dir of [-1, 1]) {
      let pa = pz, py = H - 2;
      for (let k = 1; k <= 10; k++) {
        const t = k / 10, a = pz + dir * dm * t, y = deck1 + 6 + (H - 8 - deck1) * (1 - t) ** 2;
        seg(pa, py, a, y, 0.55); pa = a; py = y;
        if (k < 10) slab(S, a, 0.8, deck1, y, col, 0.15, 0);
      }
    }
  }
  const n = Math.floor((azB - azA) / (0.75 * RAD));
  for (let k = 0; k <= n; k++) slab(S, azA + k * 0.75 * RAD, 3, deck1, deck1 + 3.5, [1, 0.8, 0.45], 0, 2);
}

function buildHorizon() {
  const S = new Sil();
  const nF = noiseFn(11), nM = noiseFn(23), nN = noiseFn(37, [7, 17, 41, 83]);
  const land0 = 55 * RAD, land1 = 305 * RAD;           // la mer occupe le sud (azimut 0 = sud, 90° = est)
  // 1. grande chaîne lointaine, très brumeuse
  ridge(S, land0 - 25 * RAD, land1 + 25 * RAD, 0.3 * RAD, (az) => (22 + 70 * Math.pow(nF(az), 1.6)) * (0.15 + 0.85 * smooth(land0 - 25 * RAD, land0 + 25 * RAD, az) * smooth(land1 + 25 * RAD, land1 - 25 * RAD, az)), [0.42, 0.52, 0.64], 0.66);
  // 2. skyline d'une autre ville : grande au nord-est, petite au nord-ouest
  skyline(S, 100 * RAD, 178 * RAD, 101, [[132 * RAD, 11 * RAD], [158 * RAD, 7 * RAD]], 150, [0.52, 0.58, 0.68], 0.55, 0.9);
  skyline(S, 100 * RAD, 178 * RAD, 102, [[132 * RAD, 11 * RAD], [158 * RAD, 7 * RAD]], 110, [0.4, 0.45, 0.55], 0.42, 0.75);
  skyline(S, 205 * RAD, 255 * RAD, 103, [[228 * RAD, 8 * RAD]], 75, [0.46, 0.52, 0.62], 0.5, 0.85);
  // 3. collines proches, plus vertes
  ridge(S, 70 * RAD, 290 * RAD, 0.4 * RAD, (az) => (8 + 34 * Math.pow(nM(az), 1.4)) * smooth(70 * RAD, 100 * RAD, az) * smooth(290 * RAD, 260 * RAD, az), [0.3, 0.42, 0.36], 0.4);
  ridge(S, 190 * RAD, 300 * RAD, 0.4 * RAD, (az) => (4 + 22 * nN(az)) * smooth(190 * RAD, 215 * RAD, az) * smooth(300 * RAD, 270 * RAD, az), [0.26, 0.38, 0.32], 0.3);
  // 4. îles au large (dont une avec un phare) puis le pont
  island(S, -30 * RAD, 6, 58, 5, [0.3, 0.36, 0.38]);
  island(S, -8 * RAD, 1.8, 14, 9, [0.34, 0.38, 0.38]);
  island(S, 17 * RAD, 3.2, 30, 6, [0.33, 0.38, 0.36], true);
  island(S, 46 * RAD, 10, 44, 7, [0.28, 0.35, 0.34]);
  island(S, -56 * RAD, 4, 34, 8, [0.34, 0.36, 0.4]);
  bridge(S, 34 * RAD, 92 * RAD, [0.26, 0.29, 0.34]);
  return S.build();
}

// ---- bateaux (cargo stylisé) : géométrie fusionnée à couleurs de sommet, forward = +z
function buildShip() {
  const pos = [], nor = [], col = [], idx = [];
  const quad = (a, b, c, d, color) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...n) || 1; n = n.map((x) => x / l);
    const b0 = pos.length / 3; for (const p of [a, b, c, d]) { pos.push(...p); nor.push(...n); col.push(...color); }
    idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
  };
  const box = (x0, x1, y0, y1, z0, z1, c) => {
    const P = (x, y, z) => [x, y, z];
    quad(P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1), c);
    quad(P(x0, y0, z0), P(x0, y1, z0), P(x0, y1, z1), P(x0, y0, z1), c.map((v) => v * 0.85));
    quad(P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1), c.map((v) => v * 0.85));
    quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), c.map((v) => v * 0.92));
    quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0), c.map((v) => v * 0.92));
  };
  const hull = [0.16, 0.2, 0.26];
  box(-4, 4, -1.5, 4, -20, 14, hull);
  quad([-4, 4, 14], [4, 4, 14], [0.3, 4, 25], [-0.3, 4, 25], [0.2, 0.24, 0.3]);
  quad([-4, -1.5, 14], [-4, 4, 14], [-0.3, 4, 25], [-0.3, -1.5, 25], hull); quad([4, -1.5, 14], [4, 4, 14], [0.3, 4, 25], [0.3, -1.5, 25], hull);
  box(-3.8, 3.8, 3.2, 4.2, -20, 14, [0.55, 0.12, 0.1]);                       // liston rouge
  box(-3, 3, 4, 11, -19, -9, [0.9, 0.9, 0.88]); box(-1, 1, 11, 15, -15, -12, [0.75, 0.2, 0.15]); // château et cheminée
  const cc = [[0.8, 0.25, 0.15], [0.15, 0.4, 0.7], [0.85, 0.65, 0.15], [0.2, 0.55, 0.35], [0.7, 0.7, 0.72], [0.6, 0.2, 0.45]], r = mulberry32(77);
  for (let z = -6; z < 13; z += 6.2) for (const x of [-3.6, 0, 3.6 - 3.2]) {
    const c = cc[Math.floor(r() * cc.length)]; box(x, x + 3.2, 4.2, 6.9, z, z + 6, c);
    if (r() < 0.5) box(x, x + 3.2, 6.9, 9.6, z, z + 6, cc[Math.floor(r() * cc.length)]);
  }
  box(-0.25, 0.25, 11, 24, 6, 6.5, [0.3, 0.3, 0.32]);                          // mât
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 5, 0), 40);
  return g;
}

export function createHorizon(game) {
  const { scene, camera } = game.three;
  const uniforms = { uHor: { value: new THREE.Color() }, uTone: { value: 1 }, uNight: { value: 0 } };
  const mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms, vertexColors: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false, fog: false });
  const ring = new THREE.Mesh(buildHorizon(), mat);
  ring.frustumCulled = false; ring.renderOrder = -9; ring.name = 'lointain';
  scene.add(ring);

  // cargos : 6 instances qui longent la côte bien au large (z > 700, hors de la zone de nage)
  const N = 6, rows = [710, 780, 870, 990, 750, 930], r = mulberry32(2026);
  const boats = Array.from({ length: N }, (_, i) => ({ z: rows[i], x0: (r() - 0.5) * 2400, v: (2.2 + r() * 3.2) * (i % 2 ? 1 : -1), s: 0.8 + r() * 0.8, ph: r() * 6.28 }));
  const ships = new THREE.InstancedMesh(buildShip(), new THREE.MeshLambertMaterial({ vertexColors: true }), N);
  ships.frustumCulled = false; ships.name = 'cargos';
  const tint = new THREE.Color();
  boats.forEach((b, i) => { tint.setHSL(0.55 + r() * 0.1, 0.1, 0.8 + r() * 0.2); ships.setColorAt(i, tint); });
  scene.add(ships);
  // feux de navigation : mât (blanc), bâbord (rouge), tribord (vert) ; fog:false, masqués le jour
  const lg = new THREE.BufferGeometry(), lp = new Float32Array(N * 9), lc = new Float32Array(N * 9);
  for (let i = 0; i < N; i++) lc.set([1, 1, 0.85, 1, 0.1, 0.08, 0.1, 1, 0.3], i * 9);
  lg.setAttribute('position', new THREE.BufferAttribute(lp, 3)); lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
  const lights = new THREE.Points(lg, new THREE.PointsMaterial({ map: glowTexture(), size: 7, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, opacity: 0, fog: false }));
  lights.frustumCulled = false; lights.renderOrder = 4; scene.add(lights);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  let t = 0, level = '';
  function setLevel(l) {
    level = l;
    ring.visible = l !== 'off'; ships.visible = lights.visible = l === 'full';
  }
  return {
    ring, ships, lights,
    update(dt, sky) {
      const l = game.settings.get('lointain') || 'full';
      if (l !== level) setLevel(l);
      if (!ring.visible) return;
      const s = Math.min(1, camera.far * 0.9 / 900);
      ring.position.copy(camera.position); ring.scale.setScalar(s);
      uniforms.uHor.value.copy(sky.horizon);
      uniforms.uTone.value = 0.07 + 0.93 * Math.max(0, 1 - sky.night * 1.15);
      uniforms.uNight.value = sky.night;
      if (!ships.visible) return;
      t += dt;
      for (let i = 0; i < N; i++) {
        const b = boats[i], x = ((b.x0 + b.v * t + 1200) % 2400 + 2400) % 2400 - 1200, dir = Math.sign(b.v);
        const bob = Math.sin(t * 0.8 + b.ph) * 0.35, roll = Math.sin(t * 0.6 + b.ph * 2) * 0.03;
        p.set(x, WATER_LEVEL + 0.5 + bob, b.z); sc.setScalar(b.s);
        e.set(0, dir > 0 ? Math.PI / 2 : -Math.PI / 2, roll); q.setFromEuler(e); m.compose(p, q, sc); ships.setMatrixAt(i, m);
        // feux : bâbord et tribord de part et d'autre de l'axe de marche
        const k = i * 9, f = dir > 0 ? 1 : -1;
        lp[k] = x + f * 6 * b.s; lp[k + 1] = p.y + 24 * b.s; lp[k + 2] = b.z;
        lp[k + 3] = x + f * 14 * b.s; lp[k + 4] = p.y + 5 * b.s; lp[k + 5] = b.z + f * 3.8 * b.s;
        lp[k + 6] = x + f * 14 * b.s; lp[k + 7] = p.y + 5 * b.s; lp[k + 8] = b.z - f * 3.8 * b.s;
      }
      ships.instanceMatrix.needsUpdate = true;
      lg.attributes.position.needsUpdate = true;
      lights.material.opacity = Math.min(1, sky.night * 1.5);
      lights.visible = sky.night > 0.05;
    },
  };
}
