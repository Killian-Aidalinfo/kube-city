// Circulation PNJ : voitures qui suivent les voies du RoadGraph, respectent feux et distances, klaxonnent, contournent.
import { normalizeGraph } from './graph.js';
import { LanePath, headingOf, steerTo, speedCommand, relocate } from './driver.js';
import { carTarget, followSpeed, stopSpeed, lightState, lightPos, yawOf } from './logic.js';

const TYPES = ['sedan', 'sedan', 'hatchback-sports', 'suv', 'taxi', 'van', 'delivery', 'sedan-sports', 'suv-luxury', 'truck'];
const KMH = 1 / 3.6;
const fwd = { x: 0, z: 1 };

export function createTraffic(game, rng) {
  const cars = [];        // { veh, lane, stuck, honkAt, panic, avoidT, ... }
  let graph = null, frame = 0;
  const sdt = (dt) => dt; // la boucle applique déjà game.time.scale
  const pos = () => game.player?.position ?? { x: 0, y: 0, z: 0 };

  function spawnPoint() {
    const pp = pos();
    for (let k = 0; k < 16; k++) {
      const arc = graph.arcs[(rng() * graph.arcs.length) | 0];
      const t = rng() * arc.len, A = graph.nodes[arc.a];
      const x = A.x + arc.dx * t - arc.dz * 2, z = A.z + arc.dz * t + arc.dx * 2;
      const d = Math.hypot(x - pp.x, z - pp.z);
      if (d > 70 && d < 200) return { x, z, arc, yaw: yawOf(arc.dx, arc.dz) };
    }
    return null;
  }

  function claim(veh, arc) {
    const lane = new LanePath(graph, arc, rng, 2);
    const car = { veh, lane, stuck: 0, honkAt: 0, panic: 0, avoid: 0, wait: 0, ambient: true, limitK: 0.7 + rng() * 0.2 };
    cars.push(car);
    return car;
  }

  function addCar() {
    const s = spawnPoint(); if (!s || !game.vehicles?.spawn) return;
    const type = TYPES[(rng() * TYPES.length) | 0];
    let veh;
    try { veh = game.vehicles.spawn(type, { x: s.x, y: 0.8, z: s.z }, s.yaw, { owner: 'npc' }); } catch { return; }
    if (!veh) return;
    veh.owner = 'npc';
    veh.npcDriver = { npc: true, flee: () => { const c = cars.find((q) => q.veh === veh); if (c) c.panic = 8; } };
    // conducteur PNJ visible du module véhicules : carjacking → onEjected (le PNJ sort et s'enfuit)
    veh.driver = {
      npc: true, kind: 'ped',
      onEjected(v, at) {
        v.npcEjected = true;
        release(v);
        game.npc.spawnFleeing?.({ x: at.x, z: at.z }, { x: v.object3d.position.x, z: v.object3d.position.z });
      },
    };
    veh.engineOn = true;
    claim(veh, s.arc);
  }

  /** Reprend un véhicule (ex. voiture de police qui redevient patrouille) dans la circulation. */
  function adopt(veh) {
    if (!graph?.arcs.length || cars.some((c) => c.veh === veh)) return null;
    const p = veh.object3d.position;
    let best = null, bd = 1e9;
    for (const a of graph.arcs) {
      const A = graph.nodes[a.a];
      const t = Math.max(0, Math.min(a.len, (p.x - A.x) * a.dx + (p.z - A.z) * a.dz));
      const d = Math.hypot(A.x + a.dx * t - p.x, A.z + a.dz * t - p.z);
      if (d < bd) { bd = d; best = a; }
    }
    if (!best) return null;
    const car = claim(veh, best); car.ambient = false;
    return car;
  }
  function release(veh) {
    const i = cars.findIndex((c) => c.veh === veh);
    if (i >= 0) cars.splice(i, 1);
  }

  /** Obstacle devant : renvoie { gap, speed, kind } du plus proche dans le cône, sinon null. */
  function obstacleAhead(car, p, h, maxD) {
    let best = null;
    for (const o of game.vehicles?.list ?? []) {
      if (o === car.veh || !o.object3d) continue;
      const q = o.object3d.position;
      const dx = q.x - p.x, dz = q.z - p.z, ahead = dx * h.x + dz * h.z;
      if (ahead < 1 || ahead > maxD) continue;
      const lat = Math.abs(dx * -h.z + dz * h.x);
      if (lat > 2.4) continue;
      if (!best || ahead < best.gap) best = { gap: ahead - 4.2, speed: (o.speed ?? 0) * KMH, other: o };
    }
    // piétons en train de traverser ou devant le capot
    for (const ped of game.npc?.peds ?? []) {
      if (!ped.active || !ped.vis) continue;
      const dx = ped.position.x - p.x, dz = ped.position.z - p.z, ahead = dx * h.x + dz * h.z;
      if (ahead < 0.5 || ahead > Math.min(maxD, 16)) continue;
      if (Math.abs(dx * -h.z + dz * h.x) > 1.8) continue;
      if (!best || ahead < best.gap) best = { gap: ahead - 3, speed: 0, other: ped, ped: true };
    }
    return best;
  }

  function honk(car, t) {
    if (t - car.honkAt < 3) return;
    car.honkAt = t;
    if (typeof car.veh.honk === 'function') car.veh.honk(0.5);
    game.bus.emit('vehicle:horn', { vehicle: car.veh, npc: true });
  }

  function drive(car, dt, t) {
    const veh = car.veh, p = veh.object3d.position;
    const h = headingOf(veh.object3d, fwd);
    const speed = (veh.speed ?? 0) * KMH;
    const remain = car.lane.update(p);
    const arc = car.lane.arc;
    // virage à venir -> ralentir ; panique -> plus vite
    let desired = arc.speed * KMH * car.limitK * (car.panic > 0 ? 1.5 : 1);
    if (remain < 25) desired = Math.min(desired, 12 - Math.min(8, car.lane.curve() * 5));
    // feux tricolores
    if (remain < 45) {
      for (const L of game.world?.trafficLights ?? []) {
        const lp = lightPos(L), B = graph.nodes[arc.b];
        if (Math.hypot(lp.x - B.x, lp.z - B.z) > 18) continue;
        const st = lightState(L, arc.dx, arc.dz);
        if (st === 'red' || (st === 'yellow' && remain > speed * 1.2 + 6)) {
          if (remain > 3) desired = Math.min(desired, stopSpeed(remain - 6, 3.2));
        }
        break;
      }
    }
    // obstacle devant
    const ob = obstacleAhead(car, p, h, 30);
    if (ob) {
      desired = Math.min(desired, followSpeed(ob.gap, ob.speed, desired));
      if (ob.gap < 7 && (ob.other === game.player?.vehicle || ob.ped)) honk(car, t);
    }
    // blocage prolongé (épave, voiture arrêtée) : klaxon puis contournement par la gauche
    if (speed < 0.6 && desired > 2 && ob) car.stuck += dt; else car.stuck = Math.max(0, car.stuck - dt);
    car.avoidT = Math.max(0, (car.avoidT ?? 0) - dt);
    if (car.stuck > 2.5) honk(car, t);
    if (car.stuck > 5) { car.avoidT = 4; car.stuck = 0; }
    car.lane.avoid = car.avoidT > 0 ? -3 : 0;
    if (car.avoidT > 0 && ob) desired = Math.max(desired, 4);
    car.panic = Math.max(0, car.panic - dt);

    const look = Math.max(6, speed * 0.9);
    const tg = car.lane.target(look);
    const steer = steerTo(h.x, h.z, tg.x - p.x, tg.z - p.z);
    const cmd = speedCommand(speed, desired);
    veh.setControls({ throttle: cmd.throttle, brake: cmd.brake, steer, handbrake: false });
  }

  /** Recycle les voitures lointaines vers un nouveau point de route. */
  function recycle(car) {
    const p = car.veh.object3d.position, pp = pos();
    if (Math.hypot(p.x - pp.x, p.z - pp.z) < 260) return;
    const s = spawnPoint(); if (!s) return;
    relocate(car.veh, s, s.yaw);
    car.lane = new LanePath(graph, s.arc, rng, 2);
  }

  function update(dt) {
    frame++;
    dt = sdt(dt);
    if (!graph) graph = normalizeGraph(game.world?.roads);
    if (!graph.arcs.length || !game.vehicles?.spawn) return;
    const t = game.time.elapsed;
    const target = carTarget({ quality: game.settings.get('quality'), density: game.settings.get('pedDensity') || 0.6, hour: game.time.dayTime });
    game.npc.maxCars = target;
    if (cars.filter((c) => c.ambient).length < target && frame % 20 === 0) addCar();
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      // plus à nous : le joueur au volant, véhicule détruit ou devenu autre chose
      if (c.veh.owner === 'player' || game.player?.vehicle === c.veh) { cars.splice(i, 1); continue; }
      if (c.veh.destroyed || (c.veh.health ?? 1) <= 0) { c.veh.setControls({ throttle: 0, brake: 1, steer: 0, handbrake: true }); cars.splice(i, 1); continue; }
      drive(c, dt, t);
      if (frame % 60 === i % 60 && c.ambient) recycle(c);
    }
  }

  // les voitures proches d'un crime paniquent
  game.bus.on('crime', (c) => {
    const p = c.position; if (!p) return;
    for (const car of cars) {
      const q = car.veh.object3d.position;
      if (Math.hypot(q.x - p.x, q.z - p.z) < 35) car.panic = 8;
    }
  });
  // le joueur prend une voiture de circulation : on la libère et le conducteur s'enfuit
  game.bus.on('player:enterVehicle', ({ vehicle }) => {
    const i = cars.findIndex((c) => c.veh === vehicle);
    if (i < 0) return;
    cars.splice(i, 1);
    if (vehicle.npcEjected) return; // déjà sorti par le carjacking (onEjected)
    const q = vehicle.object3d.position;
    game.npc.spawnFleeing?.({ x: q.x + 1.8, z: q.z }, { x: q.x, z: q.z });
  });

  return { cars, update, adopt, release };
}
