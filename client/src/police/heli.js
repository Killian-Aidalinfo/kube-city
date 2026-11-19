// Hélicoptère de police procédural avec projecteur (aucun asset requis).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function createHeli(game) {
  const g = new THREE.Group();
  // coque (corps + queue + dérive + bande + feu) fusionnée en une géométrie à couleurs de sommet : 1 draw call
  const paint = (geo, hex) => { const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo; };
  const at = (geo, x, y, z, rx = 0, ry = 0) => { geo.rotateX(rx); geo.rotateY(ry); geo.translate(x, y, z); return geo; };
  const flat = (geo) => { const q = geo.index ? geo.toNonIndexed() : geo; q.deleteAttribute('uv'); return q; };
  const hullParts = [
    paint(flat(at(new THREE.SphereGeometry(1.5, 14, 10).scale(1, 0.85, 1.7), 0, 0, 0)), 0x1d2433),
    paint(flat(at(new THREE.CylinderGeometry(0.18, 0.3, 4.5, 8), 0, 0, -3.6, Math.PI / 2)), 0x1d2433),
    paint(flat(at(new THREE.BoxGeometry(0.1, 1.2, 0.8), 0, 0.5, -5.6)), 0x1d2433),
    paint(flat(at(new THREE.BoxGeometry(2.62, 0.2, 1), 0, 0, 0.3)), 0x2f6fb3),
    paint(flat(at(new THREE.SphereGeometry(0.12, 6, 6), 0, 1.5, -5.7)), 0xff3030),
  ];
  const hull = new THREE.Mesh(mergeGeometries(hullParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }));
  const rotor = new THREE.Mesh(mergeGeometries([0, 1].map((i) => flat(at(new THREE.BoxGeometry(8, 0.05, 0.3), 0, 0, 0, 0, i * Math.PI / 2)))), new THREE.MeshStandardMaterial({ color: 0x1d2433 }));
  rotor.position.y = 1.4;
  const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.4, 0.15), new THREE.MeshStandardMaterial({ color: 0x1d2433 })); tailRotor.position.set(0.25, 0.5, -5.6);
  g.add(hull, rotor, tailRotor);

  // projecteur : lumière + cône visible
  const spot = new THREE.SpotLight(0xfff2cc, 6000, 140, 0.16, 0.5, 1.6);
  spot.position.set(0, -1.2, 1);
  const aim = new THREE.Object3D();
  g.parent?.add(aim);
  spot.target = aim;
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(1, 1, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff2cc, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  g.add(spot);
  game.three.scene.add(g, aim, cone);
  g.visible = cone.visible = spot.visible = false;

  let beam = false;
  const heli = {
    group: g, active: false, get beam() { return beam; }, beamRadius: 22, position: g.position, target: new THREE.Vector3(),
    set(on, near) {
      if (on === heli.active) return;
      heli.active = on;
      g.visible = on; if (!on) beam = cone.visible = spot.visible = false;
      if (on) { const a = Math.random() * 6.28; g.position.set(near.x + Math.cos(a) * 160, 55, near.z + Math.sin(a) * 160); }
    },
    /** Tourne autour de `focus` (joueur ou centre de zone) et braque le projecteur sur `ground`. */
    update(dt, focus, ground, t) {
      if (!heli.active) return;
      // projecteur : seulement la nuit (ou par temps très sombre) ; la lumière suit la cible
      const night = !!game.world?.isNight;
      beam = night; cone.visible = spot.visible = night;
      const want = new THREE.Vector3(focus.x + Math.cos(t * 0.25) * 25, 48, focus.z + Math.sin(t * 0.25) * 25);
      const d = want.clone().sub(g.position); const dist = d.length();
      if (dist > 0.1) g.position.addScaledVector(d, Math.min(1, (Math.min(dist, 24) / dist) * dt * 1.2));
      if (dist > 3) g.rotation.y = Math.atan2(d.x, d.z);
      g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, Math.max(-0.25, Math.min(0.25, dist * 0.01)), dt * 2);
      rotor.rotation.y += dt * 30; tailRotor.rotation.x += dt * 35;
      heli.target.lerp(new THREE.Vector3(ground.x, ground.y ?? 0, ground.z), Math.min(1, dt * 2.5));
      aim.position.copy(heli.target);
      const from = new THREE.Vector3(g.position.x, g.position.y - 1.2, g.position.z);
      const len = from.distanceTo(heli.target);
      cone.position.copy(from).lerp(heli.target, 0.5);
      cone.scale.set(Math.tan(0.16) * len, len, Math.tan(0.16) * len);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), heli.target.clone().sub(from).normalize());
    },
    dispose() { g.removeFromParent(); aim.removeFromParent(); cone.removeFromParent(); },
  };
  return heli;
}
