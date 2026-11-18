// STUB JOUEUR — à remplacer par le développeur JOUEUR. Un cube déplaçable (ZQSD) et une caméra qui le suit.
import * as THREE from 'three';

/** @param {object} game contexte (spec 3.1) */
export function install(game) {
  const { scene, camera } = game.three;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.8, 0.8), new THREE.MeshStandardMaterial({ color: 0xd4513f }));
  mesh.castShadow = true;
  mesh.position.set(0, 0.9, 0);
  scene.add(mesh);
  const velocity = new THREE.Vector3();

  /** API publique (spec 3.6). */
  const player = game.player = {
    object3d: mesh,
    body: null,               // corps Rapier (le vrai module le crée)
    character: 'ines',        // id du perso actif
    state: 'onFoot',          // 'onFoot'|'enteringVehicle'|'inVehicle'|'exitingVehicle'|'ragdoll'|'ko'|'swimming'
    health: 100, armor: 0, stamina: 100,
    vehicle: null,
    position: mesh.position,
    velocity,
    setCharacter(id) { player.character = id; },
    teleport(p) { mesh.position.set(p.x, p.y ?? 0.9, p.z); },
    applyDamage(n, source) {
      player.health = Math.max(0, player.health - n);
      game.bus.emit('player:damaged', { amount: n, source });
    },
  };

  game.onUpdate((dt) => {
    if (game.state !== 'playing') return;
    const x = game.input.axis('moveX'), y = game.input.axis('moveY');
    const speed = game.input.isDown('sprint') ? 8 : 4;
    velocity.set(x * speed, 0, -y * speed);
    mesh.position.addScaledVector(velocity, dt);
  }, 5);
  // caméra 3e personne factice, ordre 90 (spec 3.1)
  game.onUpdate(() => {
    camera.position.set(mesh.position.x, mesh.position.y + 4, mesh.position.z + 8);
    camera.lookAt(mesh.position);
  }, 90);
  game.bus.emit('player:spawned', { character: player.character });
}
