// Hélicoptère de police procédural avec projecteur (aucun asset requis).
import * as THREE from 'three';

export function createHeli(game) {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d2433, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 10), dark); body.scale.set(1, 0.85, 1.7);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 4.5, 8), dark); tail.rotation.x = Math.PI / 2; tail.position.z = -3.6;
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.8), dark); fin.position.set(0, 0.5, -5.6);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.2, 1), new THREE.MeshBasicMaterial({ color: 0x2f6fb3 })); stripe.position.set(0, 0, 0.3);
  const rotor = new THREE.Group(); rotor.position.y = 1.4;
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(8, 0.05, 0.3), dark); b.rotation.y = i * Math.PI / 2; rotor.add(b);
  }
  const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.4, 0.15), dark); tailRotor.position.set(0.25, 0.5, -5.6);
  const blink = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 })); blink.position.set(0, 1.5, -5.7);
  g.add(body, tail, fin, stripe, rotor, tailRotor, blink);

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

  const heli = {
    group: g, active: false, position: g.position, target: new THREE.Vector3(),
    set(on, near) {
      if (on === heli.active) return;
      heli.active = on;
      g.visible = cone.visible = spot.visible = on;
      if (on) { const a = Math.random() * 6.28; g.position.set(near.x + Math.cos(a) * 160, 55, near.z + Math.sin(a) * 160); }
    },
    /** Tourne autour de `focus` (joueur ou centre de zone) et braque le projecteur sur `ground`. */
    update(dt, focus, ground, t) {
      if (!heli.active) return;
      const want = new THREE.Vector3(focus.x + Math.cos(t * 0.25) * 25, 48, focus.z + Math.sin(t * 0.25) * 25);
      const d = want.clone().sub(g.position); const dist = d.length();
      if (dist > 0.1) g.position.addScaledVector(d, Math.min(1, (Math.min(dist, 24) / dist) * dt * 1.2));
      if (dist > 3) g.rotation.y = Math.atan2(d.x, d.z);
      g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, Math.max(-0.25, Math.min(0.25, dist * 0.01)), dt * 2);
      rotor.rotation.y += dt * 30; tailRotor.rotation.x += dt * 35;
      blink.visible = Math.floor(t * 2) % 2 === 0;
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
