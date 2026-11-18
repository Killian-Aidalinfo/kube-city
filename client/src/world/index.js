// STUB MONDE — à remplacer par le développeur MONDE. Expose l'API de la spec 3.5 avec une ville factice (plan + soleil).
import * as THREE from 'three';

/**
 * @typedef {{ x: number, y?: number, z: number }} P
 * @param {object} game contexte (spec 3.1)
 */
export function install(game) {
  const { scene } = game.three;
  const size = 1200;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ color: 0x5a8f4e }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x4a5a3a, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(60, 100, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(game.settings.get('shadowMapSize'), game.settings.get('shadowMapSize'));
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 300 });
  scene.add(sun);

  // sol physique infini (boîte plate)
  const { world, RAPIER } = game.physics;
  world.createCollider(RAPIER.ColliderDesc.cuboid(size / 2, 0.5, size / 2).setTranslation(0, -0.5, 0));

  /** API publique (voir spec 3.5). Les valeurs ci-dessous sont factices. */
  game.world = {
    size,
    chunks: [],
    roads: { nodes: [], edges: [] },
    sidewalks: { nodes: [], edges: [] },
    spawnPoints: {
      player: { x: 0, y: 1, z: 0, rotation: 0 },
      vehicles: [{ x: 8, y: 1, z: 0, rotation: 0 }],
      peds: [{ x: -5, y: 1, z: 5 }],
    },
    places: { commissariat: { label: 'Commissariat', position: { x: 30, y: 0, z: 30 } } },
    trafficLights: [],
    /** Hauteur du sol en (x, z). */
    groundHeight: (x, z) => 0,
    /** Vrai si (x, z) est sur une route. */
    isRoad: (x, z) => false,
    /** Point de route le plus proche de p. */
    nearestRoadPoint: (p) => ({ x: p.x, y: 0, z: p.z }),
    /** Itinéraire from → to sous forme de points. */
    route: (from, to) => [from, to],
    /** Quartier en (x, z). */
    district: (x, z) => ({ name: 'Centre', color: '#ff4fa3' }),
  };
}
