// Singe procédural (formes simples, CC0) installé au volant d'un véhicule : tête, museau, oreilles, bras sur le volant.
import * as THREE from 'three';

export function createMonkey() {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a77a, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  add(new THREE.SphereGeometry(0.2, 12, 10), fur, 0, 0, 0);                 // tête
  add(new THREE.SphereGeometry(0.14, 10, 8), skin, 0, -0.04, 0.12);         // museau
  add(new THREE.SphereGeometry(0.07, 8, 6), skin, -0.22, 0.02, 0);          // oreilles
  add(new THREE.SphereGeometry(0.07, 8, 6), skin, 0.22, 0.02, 0);
  add(new THREE.SphereGeometry(0.03, 6, 6), dark, -0.07, 0.07, 0.17);       // yeux
  add(new THREE.SphereGeometry(0.03, 6, 6), dark, 0.07, 0.07, 0.17);
  add(new THREE.CylinderGeometry(0.17, 0.21, 0.4, 10), fur, 0, -0.32, -0.02); // buste
  const arm = (x) => { const a = add(new THREE.CylinderGeometry(0.045, 0.045, 0.45, 6), fur, x, -0.3, 0.2); a.rotation.x = Math.PI / 2.4; };
  arm(-0.2); arm(0.2);
  g.scale.setScalar(1.4);
  return g;
}

/** Pose le singe au volant de `veh` ; renvoie une fonction qui le retire. */
export function seatMonkey(veh) {
  const m = createMonkey();
  m.position.set(-0.4, 1.45, 0.25);
  veh.object3d.add(m);
  return () => { veh.object3d.remove(m); m.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); };
}
