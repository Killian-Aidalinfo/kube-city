// MONDE : Kube City en 3D — ville procédurale (citygen.js), chunks fusionnés, collisions Rapier, cycle jour/nuit, météo, eau.
import * as THREE from 'three';
import { generateCity, LIGHT_CYCLE, lightPhase, WATER_LEVEL, isWaterAt, groundHeight, SIZE, CHUNK, HALF } from './citygen.js';
import { buildTerrain, buildChunks, terrainHeights, rampPoints, TERRAIN_CELLS, TERRAIN_SIZE } from './build.js';
import { noiseTexture, windowAtlas, glowTexture, signTexture } from './textures.js';
import { createSky } from './sky.js';
import { createWater } from './water.js';
import { createWeather } from './weather.js';

const LAMP_LIGHTS = 5;

/**
 * Installe le monde et remplit game.world (spec 3.5).
 * @param {object} game contexte (spec 3.1)
 */
export function install(game) {
  const { scene, camera } = game.three;
  const { world: pw, RAPIER } = game.physics;
  const city = generateCity();

  // ---- matériaux
  const noise = noiseTexture(128, 205, 34, 5), win = windowAtlas(), glow = glowTexture();
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: noise, roughness: 1 });
  const roadMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: noise, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const bldMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: win.map, emissiveMap: win.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.82, metalness: 0.02 });

  // ---- terrain et chunks
  const terrain = buildTerrain(terrainMat);
  scene.add(terrain);
  const built = buildChunks(city);
  const chunks = [];
  const root = new THREE.Group(); root.name = 'chunks';
  for (const c of built.chunks.map.values()) {
    const group = new THREE.Group(); group.name = `chunk ${c.key}`;
    const parts = [];
    if (!c.road.empty) { const m = new THREE.Mesh(c.road.build(), roadMat); m.receiveShadow = true; group.add(m); parts.push(m); }
    if (!c.bld.empty) { const m = new THREE.Mesh(c.bld.build(), bldMat); m.castShadow = true; m.receiveShadow = true; group.add(m); parts.push(m); }
    root.add(group);
    chunks.push({ key: c.key, cx: c.cx, cz: c.cz, center: c.center, group, meshes: parts, visible: true });
  }
  scene.add(root);

  // ---- collisions Rapier : sol (heightfield), immeubles, trottoirs, jetée, rampes, eau (capteur)
  const colliders = [];
  const N = TERRAIN_CELLS;
  colliders.push(pw.createCollider(RAPIER.ColliderDesc.heightfield(N, N, terrainHeights(), { x: TERRAIN_SIZE, y: 1, z: TERRAIN_SIZE }).setFriction(0.9)));
  const yawQ = (r) => ({ x: 0, y: Math.sin(r / 2), z: 0, w: Math.cos(r / 2) });
  const cuboid = (cx, cz, hw, hd, y0, y1, rot = 0) => colliders.push(pw.createCollider(RAPIER.ColliderDesc.cuboid(hw, (y1 - y0) / 2, hd).setTranslation(cx, (y0 + y1) / 2, cz).setRotation(yawQ(rot)).setFriction(0.6)));
  for (const b of city.buildings) {
    if (b.colliders) { for (const c of b.colliders) cuboid(c.cx, c.cz, c.hw, c.hd, c.y0, c.y1, c.rot ?? 0); continue; }
    for (const p of b.parts) {
      if (p.t === 'box') cuboid(p.cx, p.cz, p.w / 2, p.d / 2, p.y0, p.y1, p.rot ?? 0);
      else colliders.push(pw.createCollider(RAPIER.ColliderDesc.cylinder((p.y1 - p.y0) / 2, p.r).setTranslation(p.cx, (p.y0 + p.y1) / 2, p.cz)));
    }
  }
  if (built.sidewalkMesh.indices.length) colliders.push(pw.createCollider(RAPIER.ColliderDesc.trimesh(built.sidewalkMesh.positions, built.sidewalkMesh.indices).setFriction(0.8)));
  const P = city.pier;
  cuboid(P.x, (P.z0 + P.z1) / 2, P.width / 2, (P.z1 - P.z0) / 2, P.y - 0.3, P.y);
  for (const r of city.ramps) {
    const pts = rampPoints(r), arr = new Float32Array(pts.flat());
    const d = RAPIER.ColliderDesc.convexHull(arr);
    if (d) colliders.push(pw.createCollider(d.setFriction(0.8)));
  }
  // eau : capteur (zone de nage) ; le fond reste le heightfield
  const waterSensor = pw.createCollider(RAPIER.ColliderDesc.cuboid(750, 6, 170).setTranslation(0, WATER_LEVEL - 6, 580).setSensor(true));

  // ---- lumières nocturnes : halos de lampadaires, néons, feux tricolores, lumières réelles près de la caméra
  const mkPoints = (arr, colors, size, opacity = 0) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const m = new THREE.PointsMaterial({ map: glow, size, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: !!colors, color: 0xffffff, opacity });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 4; scene.add(pts);
    return pts;
  };
  const lampPos = [], lampCol = [];
  for (const l of city.lamps) { lampPos.push(l.x + l.dx * 1.3, l.y + 6.5, l.z + l.dz * 1.3); lampCol.push(1, 0.82, 0.5); }
  const lampPts = mkPoints(lampPos, lampCol, 3.2);
  const neonPos = [], neonCol = [], col = new THREE.Color();
  for (const n of city.neon) { neonPos.push(n.x, n.y, n.z); col.set(n.color); neonCol.push(col.r, col.g, col.b); }
  const neonPts = mkPoints(neonPos, neonCol, 7);
  // feux : 3 ampoules par potence
  const sigPos = [], sigCol = [], sigRef = [];
  for (const tl of city.trafficLights) for (const p of tl.poles) {
    for (let k = 0; k < 3; k++) { sigPos.push(p.x + p.facing.x * 0.42, p.y + 3.95 - k * 0.32, p.z + p.facing.z * 0.42); sigCol.push(0, 0, 0); }
    sigRef.push({ tl, axis: p.axis, base: sigCol.length - 9, last: '' });
  }
  const sigPts = mkPoints(sigPos, sigCol, 0.9, 1);
  sigPts.material.blending = THREE.NormalBlending;
  const SIGC = { red: [1, 0.12, 0.1], yellow: [1, 0.72, 0.1], green: [0.15, 1, 0.35] };
  const lampLights = [];
  for (let i = 0; i < LAMP_LIGHTS; i++) { const l = new THREE.PointLight(0xffc880, 0, 34, 1.6); scene.add(l); lampLights.push(l); }


  // ---- ambiance (instanciée : 1 appel de dessin chacun) : têtes de lampadaire, panneaux « Kube City »
  const lampHeads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.1, 0.28), new THREE.MeshBasicMaterial({ color: 0xdfe3ea }), Math.max(1, city.lamps.length));
  { const o = new THREE.Object3D();
    city.lamps.forEach((l, i) => { o.position.set(l.x + l.dx * 1.3, l.y + 6.54, l.z + l.dz * 1.3); o.rotation.set(0, -Math.atan2(l.dz, l.dx), 0); o.updateMatrix(); lampHeads.setMatrixAt(i, o.matrix); });
    lampHeads.count = city.lamps.length; lampHeads.frustumCulled = false; scene.add(lampHeads); }
  const signMat = (tex) => new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.1, roughness: 0.6, side: THREE.DoubleSide });
  const kubeSignMat = signMat(signTexture('KUBE CITY'));
  const kubeSigns = [];
  { const lamps = city.lamps, n = Math.min(14, Math.floor(lamps.length / 30)), o = new THREE.Object3D();
    const step = Math.max(1, Math.floor(lamps.length / Math.max(1, n)));
    for (let i = 7; i < lamps.length && kubeSigns.length < n; i += step) kubeSigns.push(lamps[i]);
    const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.2, 0.825), kubeSignMat, Math.max(1, kubeSigns.length));
    kubeSigns.forEach((l, k) => { o.position.set(l.x + l.dx * 0.55, l.y + 4.7, l.z + l.dz * 0.55); o.rotation.set(0, Math.atan2(l.dx, l.dz) + Math.PI / 2, 0); o.updateMatrix(); m.setMatrixAt(k, o.matrix); });
    m.count = kubeSigns.length; m.frustumCulled = false; scene.add(m); }
  const dcSignMat = signMat(signTexture('DATACENTER', 'Kube City'));
  if (city.datacenter) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), dcSignMat);
    m.position.set(city.datacenter.sign.x, city.datacenter.sign.y, city.datacenter.sign.z); scene.add(m);
  }

  // phare : faisceau tournant
  const beam = new THREE.Mesh(new THREE.ConeGeometry(7, 90, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.geometry.translate(0, -45, 0); beam.geometry.rotateZ(Math.PI / 2);
  const beamPivot = new THREE.Group(); beamPivot.position.set(city.lighthouse.x, city.lighthouse.y - 1, city.lighthouse.z); beamPivot.add(beam); scene.add(beamPivot);

  // ---- ciel, eau, météo
  const sky = createSky(game);
  const water = createWater(game);
  const weather = createWeather(game, roadMat);

  // ---- feux tricolores : état lisible par la circulation
  for (const tl of city.trafficLights) {
    /** État du feu pour l'axe 'ns' (voies nord-sud) ou 'ew' (est-ouest) : 'green' | 'yellow' | 'red'. */
    tl.state = (axis = 'ns', t = game.time.elapsed) => (world.forceGreen && world.forceGreen(tl, axis)) ? 'green' : lightPhase(tl, axis, t);
  }

  const world = {
    size: SIZE, chunkSize: CHUNK, chunks,
    roads: city.roads, sidewalks: city.sidewalks,
    spawnPoints: city.spawnPoints, places: city.places,
    trafficLights: city.trafficLights, trafficCycle: LIGHT_CYCLE,
    buildings: city.buildings, lamps: city.lamps, ramps: city.ramps, pier: city.pier,
    weather, sky: sky.state, water: { level: WATER_LEVEL, isWater: isWaterAt, depth: (x, z) => Math.max(0, WATER_LEVEL - groundHeight(x, z)), sensor: waterSensor },
    colliders, terrain,
    /** Hauteur du sol en (x, z) (identique au heightfield physique). */
    groundHeight: (x, z) => groundHeight(x, z),
    /** Vrai si (x, z) est sur la chaussée. */
    isRoad: (x, z) => city.roads.isRoad(x, z),
    /** Point de route le plus proche de p ({x, z}). */
    nearestRoadPoint: (p) => city.nearestRoadPoint(p),
    /** Itinéraire from → to ({x, z}) sur le graphe routier : points [{x, y, z}]. */
    route: (from, to) => city.roads.route(from, to),
    /** Quartier en (x, z) : { name, key, color }. */
    district: (x, z) => city.district(x, z),
    /** Tout ce qu'on sait d'un point. */
    query: (x, z) => ({ height: groundHeight(x, z), road: city.roads.isRoad(x, z), water: isWaterAt(x, z), district: city.district(x, z) }),
    /** Heure du jour [0, 24) ; régler avec setTime. */
    get hour() { return game.time.dayTime; },
    setTime(h) { game.time.dayTime = ((h % 24) + 24) % 24; },
    get isNight() { return sky.state.night > 0.6; },
    /** Crochet optionnel (ex. « Panne de réseau » de Jade) : (feu, axe) → true pour forcer le vert. */
    forceGreen: null,
    update(dt) { tick(dt); },
    dispose() { for (const c of colliders) pw.removeCollider(c, false); pw.removeCollider(waterSensor, false); },
  };
  game.world = world;

  // ---- boucle
  let acc = 1, lampAcc = 1, lastNight = -1;
  const camP = new THREE.Vector3();
  function tick(dt) {
    sky.update(game.time.dayTime, weather, dt);
    weather.update(dt);
    water.update(dt, sky.state);
    const night = sky.state.night;
    if (Math.abs(night - lastNight) > 0.004) {
      lastNight = night;
      bldMat.emissiveIntensity = Math.min(1, night * 1.25) * 1.05;
      lampPts.material.opacity = neonPts.material.opacity = Math.min(1, night * 1.4);
      lampPts.visible = neonPts.visible = night > 0.02;
      beam.material.opacity = Math.min(0.12, night * 0.14);
      kubeSignMat.emissiveIntensity = dcSignMat.emissiveIntensity = 0.1 + Math.min(1, night * 1.3) * 0.95;
      lampHeads.material.color.setHex(night > 0.35 ? 0xfff0c0 : 0xdfe3ea);
    }
    beamPivot.rotation.y += dt * 0.8;
    acc += dt; lampAcc += dt;
    if (acc >= 0.25) { // visibilité des chunks + couleurs des feux
      acc = 0;
      const lim = game.settings.get("viewDistance") * 0.72;
      camP.copy(camera.position);
      for (const c of chunks) {
        const dc = Math.hypot(c.center.x - camP.x, c.center.z - camP.z), v = dc < lim;
        if (v !== c.visible) { c.visible = v; c.group.visible = v; }
        if (v) { const sh = dc < 150; if (sh !== c.shadow) { c.shadow = sh; for (const m of c.meshes) if (m.material === bldMat) m.castShadow = sh; } } // ombres : seulement près de la caméra
      }
      let dirty = false;
      for (const s of sigRef) {
        const st = s.tl.state(s.axis);
        if (st === s.last) continue;
        s.last = st; dirty = true;
        for (let k = 0; k < 3; k++) {
          const on = (st === 'red' && k === 0) || (st === 'yellow' && k === 1) || (st === 'green' && k === 2);
          const c = on ? SIGC[['red', 'yellow', 'green'][k]] : [0.04, 0.04, 0.04];
          sigCol[s.base + k * 3] = c[0]; sigCol[s.base + k * 3 + 1] = c[1]; sigCol[s.base + k * 3 + 2] = c[2];
        }
      }
      if (dirty) { sigPts.geometry.attributes.color.array.set(sigCol); sigPts.geometry.attributes.color.needsUpdate = true; }
    }
    if (lampAcc >= 0.3) { // les lampadaires réels les plus proches de la caméra s'allument
      lampAcc = 0;
      const near = [];
      for (const l of city.lamps) { const d = (l.x - camera.position.x) ** 2 + (l.z - camera.position.z) ** 2; if (d < 3600) near.push([d, l]); }
      near.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < LAMP_LIGHTS; i++) {
        const t = near[i], L = lampLights[i];
        if (t) L.position.set(t[1].x + t[1].dx * 1.3, t[1].y + 6.3, t[1].z + t[1].dz * 1.3);
        L.intensity = t ? 90 * Math.min(1, night * 1.5) : 0;
      }
    }
  }
  game.onUpdate((dt) => tick(dt), 95);
  tick(0.016);
  void HALF;
}
