// Pigeons : une seule InstancedMesh (1 draw call). Ils picorent sur les trottoirs et s'envolent quand
// le joueur ou un véhicule approche, puis se reposent plus loin.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { normalizeGraph } from './graph.js';

const N = 18, SCARE = 5, SCARE_VEH = 8;
function part(g, color) {
  g = g.toNonIndexed(); g.deleteAttribute('uv');
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function pigeonGeometry() {
  const body = new THREE.BoxGeometry(0.16, 0.14, 0.3).translate(0, 0.14, 0);
  const head = new THREE.BoxGeometry(0.09, 0.09, 0.09).translate(0, 0.24, 0.16);
  const beak = new THREE.BoxGeometry(0.03, 0.025, 0.05).translate(0, 0.235, 0.22);
  const tail = new THREE.BoxGeometry(0.1, 0.03, 0.14).translate(0, 0.15, -0.2);
  const wings = new THREE.BoxGeometry(0.42, 0.02, 0.2).translate(0, 0.2, -0.02);
  return mergeGeometries([part(body, 0x7d8493), part(head, 0x5f6675), part(beak, 0xd8b36a), part(tail, 0x575d6b), part(wings, 0x9aa1b0)]);
}

export function createBirds(game, rng) {
  const mesh = new THREE.InstancedMesh(pigeonGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), N);
  mesh.frustumCulled = false; mesh.castShadow = false; mesh.count = N;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  game.three.scene.add(mesh);
  const birds = [];
  for (let i = 0; i < N; i++) birds.push({ x: 0, y: -999, z: 0, yaw: rng() * 6.28, state: 'away', t: 0, vx: 0, vz: 0, ph: rng() * 6 });
  let graph = null, frame = 0;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  const ground = (x, z) => game.world?.groundHeight?.(x, z) ?? 0;

  function place(b, pp) {
    // près d'un autre pigeon posé (volée) ou sur un trottoir au hasard
    const mate = birds.filter((o) => o.state === 'ground');
    let x, z;
    if (mate.length && rng() < 0.5) { const o = mate[(rng() * mate.length) | 0]; x = o.x + (rng() - 0.5) * 2.2; z = o.z + (rng() - 0.5) * 2.2; }
    else if (graph?.arcs.length) {
      const a = graph.arcs[(rng() * graph.arcs.length) | 0], A = graph.nodes[a.a], t = rng() * a.len;
      x = A.x + a.dx * t - a.dz * 2.2; z = A.z + a.dz * t + a.dx * 2.2;
    } else { const an = rng() * 6.28, r = 15 + rng() * 40; x = pp.x + Math.cos(an) * r; z = pp.z + Math.sin(an) * r; }
    const d = Math.hypot(x - pp.x, z - pp.z);
    if (d < 10 || d > 70) return false;
    Object.assign(b, { x, z, y: ground(x, z), state: 'ground', t: rng() * 3, yaw: rng() * 6.28, ph: rng() * 6 });
    return true;
  }
  function scare(b, from) {
    let dx = b.x - from.x, dz = b.z - from.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const a = (rng() - 0.5) * 1.2, c = Math.cos(a), sn = Math.sin(a);
    b.vx = (dx * c - dz * sn) * (4 + rng() * 2); b.vz = (dx * sn + dz * c) * (4 + rng() * 2);
    b.vy = 3.2 + rng() * 1.8; b.state = 'fly'; b.t = 3.2 + rng() * 1.2; b.yaw = Math.atan2(b.vx, b.vz);
  }

  function update(dt) {
    frame++;
    if (!graph) { const g = normalizeGraph(game.world?.sidewalks); graph = g.arcs.length ? g : normalizeGraph(game.world?.roads); }
    const pp = game.player?.position ?? { x: 0, y: 0, z: 0 };
    const fast = [];
    for (const v of game.vehicles?.list ?? []) {
      if (!v.object3d || Math.abs(v.speed) < 12) continue;
      const q2 = v.object3d.position;
      if (Math.abs(q2.x - pp.x) < 90 && Math.abs(q2.z - pp.z) < 90) fast.push(q2);
    }
    const onFoot = game.player?.state === 'onFoot' || game.player?.state === 'ragdoll';
    for (let i = 0; i < N; i++) {
      const b = birds[i];
      if (b.state === 'away') { if (frame % 6 === i % 6 && place(b, pp)) b.state = 'ground'; }
      else if (b.state === 'ground') {
        b.ph += dt * 6;
        b.t -= dt; if (b.t <= 0) { b.t = 0.6 + rng() * 2; b.yaw += (rng() - 0.5) * 2; }
        const pk = Math.max(0, Math.sin(b.ph)); // picorage : petit pas
        if (pk > 0.9) { b.x += Math.sin(b.yaw) * dt * 0.25; b.z += Math.cos(b.yaw) * dt * 0.25; b.y = ground(b.x, b.z); }
        if (onFoot && Math.hypot(b.x - pp.x, b.z - pp.z) < SCARE) scare(b, pp);
        else {
          for (const f of fast) if (Math.hypot(b.x - f.x, b.z - f.z) < SCARE_VEH) { scare(b, f); break; }
          if (b.state === 'ground' && Math.hypot(b.x - pp.x, b.z - pp.z) > 110) b.state = 'away';
        }
      } else { // fly
        b.t -= dt; b.ph += dt * 30;
        b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt; b.vy = Math.max(0.4, b.vy - dt * 0.8);
        if (b.t <= 0) b.state = 'away';
      }
      // matrice d'instance
      if (b.state === 'away') { m.makeScale(0, 0, 0); mesh.setMatrixAt(i, m); continue; }
      const fly = b.state === 'fly';
      e.set(fly ? -0.35 : 0.15 * Math.max(0, Math.sin(b.ph)) , b.yaw, fly ? Math.sin(b.ph) * 0.5 : 0, 'YXZ');
      q.setFromEuler(e); p.set(b.x, b.y, b.z); s.set(1, fly ? 1 + Math.sin(b.ph) * 0.2 : 1, 1);
      m.compose(p, q, s); mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  return { birds, update, mesh };
}
