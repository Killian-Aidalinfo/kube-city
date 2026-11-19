// VÉHICULES : gestionnaire (spawn, conduite du joueur, entrer/sortir, carjacking, dégâts, effets) — spec 3.7 et 7.
import * as THREE from 'three';
import { Vehicle } from './vehicle.js';
import { buildGeometry } from './drive.js';
import { TYPES, ALIASES, specFor, collisionDamage, damageLevel, steerInput, flipDelay } from './tuning.js';
import { topple } from './drive.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FIXED = 1 / 60;
const PARKED_POOL = ['moto', 'bus', 'moto', 'sedan', 'hatchback-sports', 'sedan-sports', 'suv', 'taxi', 'van', 'truck', 'suv-luxury', 'race', 'delivery', 'sedan', 'hatchback-sports', 'suv', 'taxi', 'police', 'ambulance'];

/** Petit générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** @param {object} game contexte (spec 3.1) */
export function install(game) {
  const { scene } = game.three;
  const { world, RAPIER, step } = game.physics;
  const manifest = game.assets.manifest;
  const models = manifest?.vehicles?.models ?? {};
  const glow = glowTexture();
  let nextId = 1;
  const byBody = new Map();      // handle du corps → véhicule
  const owners = new Map();      // handle de collider → objet propriétaire (PNJ…)
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();

  // phare unique partagé (toujours dans la scène : le nombre de lumières ne change jamais)
  const spot = new THREE.SpotLight(0xfff0cc, 0, 70, 0.6, 0.55, 1.2);
  spot.target = new THREE.Object3D();
  scene.add(spot, spot.target);

  // ---------- particules : fumée, feu, flash ----------
  const fx = { smoke: [], fire: [], flash: [], acc: 0 };
  const mkSprite = (additive, color) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, depthWrite: false, opacity: 0, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    s.visible = false; s.userData = { life: 0, max: 1, vy: 1, size: 1 }; scene.add(s); return s;
  };
  for (let i = 0; i < 48; i++) fx.smoke.push(mkSprite(false, 0x555555));
  for (let i = 0; i < 24; i++) fx.fire.push(mkSprite(true, 0xff7a1a));
  for (let i = 0; i < 4; i++) fx.flash.push(mkSprite(true, 0xffe9a8));
  const emit = (pool, p, { life = 1.4, vy = 1.5, size = 1, spread = 0.4 } = {}) => {
    const s = pool.find((q) => !q.visible); if (!s) return;
    s.position.set(p.x + (Math.random() - 0.5) * spread, p.y, p.z + (Math.random() - 0.5) * spread);
    Object.assign(s.userData, { life, max: life, vy, size }); s.visible = true;
  };
  function updateFx(dt) {
    for (const pool of [fx.smoke, fx.fire, fx.flash]) {
      const isFlash = pool === fx.flash;
      for (const s of pool) {
        if (!s.visible) continue;
        const u = s.userData; u.life -= dt;
        if (u.life <= 0) { s.visible = false; s.material.opacity = 0; continue; }
        const k = 1 - u.life / u.max;
        s.position.y += u.vy * dt;
        s.scale.setScalar(u.size * (isFlash ? 1 + k * 5 : 0.6 + k * 1.8));
        s.material.opacity = isFlash ? (1 - k) * 0.95 : (pool === fx.fire ? (1 - k) * 0.85 : Math.sin(Math.min(1, k * 3) * Math.PI / 2) * (1 - k) * 0.55);
      }
    }
  }

  // ---------- API publique (spec 3.7) ----------
  const types = {};
  for (const id of Object.keys(TYPES)) types[id] = specFor(id);
  const personal = { type: null, color: null, vehicle: null };

  const vehicles = game.vehicles = {
    list: [], types, personal,
    /** Crée un véhicule. type = id de modèle, ou catégorie (« berline », « sport »…). opts : { owner, color, driver }. */
    spawn(type, position, rotation = 0, opts = {}) {
      const spec = specFor(type) ?? specFor('sedan');
      const geom = buildGeometry(models[spec.model]);
      const p = { x: position.x, y: position.y, z: position.z };
      if (typeof p.y !== 'number') p.y = (game.world?.groundHeight?.(p.x, p.z) ?? 0) + 0.3;
      const v = new Vehicle({ game, spec, geom, id: 'veh-' + nextId++, glow, entry: models[spec.model], url: '/assets/' + (models[spec.model]?.file ?? `vehicles/${spec.model}.glb`) }, { ...opts, position: p, rotation });
      scene.add(v.object3d);
      byBody.set(v.chassis.handle, v);
      vehicles.list.push(v);
      if (opts.driver) v.driver = opts.driver;
      game.bus.emit('vehicle:spawned', { vehicle: v });
      return v;
    },
    /** Retire un véhicule du monde. */
    remove(v) {
      const i = vehicles.list.indexOf(v); if (i < 0) return;
      if (player.vehicle === v) { player.state = 'onFoot'; player.vehicle = null; player.setCollidable(true); }
      vehicles.list.splice(i, 1); byBody.delete(v.chassis.handle); v.dispose();
      if (personal.vehicle === v) personal.vehicle = null;
    },
    get: (id) => vehicles.list.find((v) => v.id === id) ?? null,
    /** Véhicule le plus proche à entrer : { vehicle, seat } ou null. */
    nearestEnterable(position, radius = 3.2) {
      let best = null, bd = radius;
      for (const v of vehicles.list) {
        if (v.wrecked || v.remote || v === player.vehicle) continue;
        const d = distToVehicle(v, position);
        if (d < bd) { bd = d; best = v; } // un conducteur PNJ = carjacking
      }
      return best ? { vehicle: best, seat: 0 } : null;
    },
    /** Fait monter un acteur (joueur : avec animation ; PNJ : instantané). */
    enter(actor, vehicle, seat = 0) {
      if (actor === player) return beginEnter(vehicle, seat);
      if (seat === 0) { vehicle.driver = actor; vehicle.engineOn = true; if (vehicle.chassis) vehicle.chassis.wakeUp(); }
      else if (!vehicle.passengers.includes(actor)) vehicle.passengers[seat - 1] = actor;
      return true;
    },
    /** Fait descendre un acteur. Renvoie la position de sortie. */
    exit(actor) {
      if (actor === player) return beginExit(false);
      for (const v of vehicles.list) {
        if (v.driver === actor) { v.driver = null; v.engineOn = false; return doorPos(v, 0, 1); }
        const i = v.passengers.indexOf(actor); if (i >= 0) { v.passengers[i] = undefined; return doorPos(v, i + 1, -1); }
      }
      return null;
    },
    /** Marque le véhicule comme véhicule personnel (réapparaît près de la planque). */
    setPersonal(v) {
      if (personal.vehicle && personal.vehicle !== v) personal.vehicle.owner = 'npc';
      personal.vehicle = v; personal.type = v?.type ?? null; personal.color = v?.color ?? null;
      if (v) v.owner = 'player';
      game.bus.emit('vehicle:personal', { vehicle: v, type: personal.type, color: personal.color });
    },
    /** Amène le véhicule personnel (le crée au besoin) à une position. */
    summonPersonal(position, rotation = 0) {
      let v = personal.vehicle;
      if (v && !v.driver) vehicles.teleport(v, position, rotation);
      else if (!v && personal.type) { v = vehicles.spawn(personal.type, position, rotation, { owner: 'player', color: personal.color }); personal.vehicle = v; }
      return v ?? null;
    },
    teleport(v, p, rotation = v.heading) {
      const y = (p.y ?? (game.world?.groundHeight?.(p.x, p.z) ?? 0)) + v.geom.H0;
      v.chassis.setTranslation({ x: p.x, y, z: p.z }, true);
      const h = rotation / 2; v.chassis.setRotation({ x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) }, true);
      v.chassis.setLinvel({ x: 0, y: 0, z: 0 }, true); v.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
      v._curP.set(p.x, y, p.z); v._prevP.copy(v._curP); v._hist.length = 0;
    },
    repair: (v) => v.repair(),
    setColor: (v, c) => v.setColor(c),
    /** Associe un collider à un objet (PNJ…) pour renseigner `other` dans vehicle:collision. */
    registerCollider(collider, owner) { owners.set(collider.handle, owner); },
    unregisterCollider(collider) { owners.delete(collider.handle); },
    _onWreck,
  };

  // joueur : API de player/ (installé avant nous)
  const player = game.player;

  // ---------- géométrie : portes et sièges ----------
  /** Position locale du siège (repère châssis au sol) : 0 conducteur G, 1 passager D, 2/3 arrière, 4 centre. */
  function seatLocal(v, seat) {
    if (v.spec.twoWheel) return { x: 0, y: 0.5, z: -0.12 };
    const side = seat === 4 ? 0 : (seat % 2 === 0 ? 1 : -1), row = seat === 4 ? 1 : Math.floor(seat / 2);
    return { x: side * Math.min(0.5, v.geom.halfW * 0.42), y: 0.42, z: v.geom.halfL * 0.05 - row * 0.85 };
  }
  /** Point monde de la porte du siège, côté `side` (+1 gauche, −1 droite). */
  function doorPos(v, seat, side, out = new THREE.Vector3()) {
    const s = seatLocal(v, seat);
    v.localToWorld(side * (v.geom.halfW + 0.7), 0.0, s.z, out);
    const g = game.world?.groundHeight?.(out.x, out.z);
    out.y = typeof g === 'number' ? g : out.y - v.geom.H0 + 0.3;
    return out;
  }
  function distToVehicle(v, p) {
    _v.set(p.x, p.y, p.z).sub(v.object3d.position);
    _q.copy(v.object3d.quaternion).invert(); _v.applyQuaternion(_q);
    const dx = Math.max(Math.abs(_v.x) - v.geom.halfW, 0), dz = Math.max(Math.abs(_v.z) - v.geom.halfL, 0);
    return Math.hypot(dx, dz, Math.max(0, Math.abs(_v.y) - 2));
  }
  /** Rayon horizontal du siège vers la porte : vrai si un obstacle bloque la sortie. */
  function blocked(v, seat, side) {
    const a = v.localToWorld(seatLocal(v, seat).x, 1.0, seatLocal(v, seat).z, _v2.clone());
    const b = doorPos(v, seat, side, new THREE.Vector3()); b.y = a.y;
    const d = b.clone().sub(a), len = d.length(); d.normalize();
    try {
      const hit = world.castRay(new RAPIER.Ray(a, d), len, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, v.chassis);
      return !!hit;
    } catch { return false; }
  }

  // ---------- séquences entrer / sortir du joueur ----------
  let seq = null;   // { kind, vehicle, seat, phase, t, door, side }
  function beginEnter(v, seat = 0) {
    if (!player || seq || player.state !== 'onFoot' || v.wrecked) return false;
    // la porte la plus proche (gauche ou droite) ; si bloquée on prend l'autre
    const pl = player.position;
    const dl = doorPos(v, seat, 1, new THREE.Vector3()), dr = doorPos(v, seat, -1, new THREE.Vector3());
    const side = Math.hypot(dl.x - pl.x, dl.z - pl.z) <= Math.hypot(dr.x - pl.x, dr.z - pl.z) ? 1 : -1;
    seq = { kind: 'enter', vehicle: v, seat, phase: 'walk', t: 0, side, door: side > 0 ? dl : dr };
    player.state = 'enteringVehicle';
    player.setCollidable(false);
    return true;
  }
  function stepEnter(dt) {
    const v = seq.vehicle; seq.t += dt;
    const door = doorPos(v, seq.seat, seq.side, _v2); // la porte suit le véhicule
    if (seq.phase === 'walk') {
      const p = player.position; let dx = door.x - p.x, dz = door.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.3 || seq.t > 2.4 || v.wrecked) {
        seq.phase = 'open'; seq.t = 0;
        // carjacking : le conducteur PNJ est éjecté
        if (seq.seat === 0 && v.driver && v.driver !== player) carjack(v);
        const toV = Math.atan2(v.object3d.position.x - door.x, v.object3d.position.z - door.z);
        player.setPose(door.x, door.y, door.z, toV);
        seq.dur = player.playAnim('sitEnter', { once: true, fade: 0.12, lock: true }) || 0.8;
        seq.wait = Math.min(0.7, seq.dur * 0.55);
        return;
      }
      const sp = Math.min(d, 4.2 * dt);
      dx /= d; dz /= d;
      player.setPose(p.x + dx * sp, p.y, p.z + dz * sp, Math.atan2(dx, dz));
      player.playAnim('run', { timeScale: 0.85 });
    } else if (seq.phase === 'open') {
      if (seq.t >= seq.wait) finishEnter();
    }
  }
  function carjack(v) {
    const d = v.driver; v.driver = null;
    const out = doorPos(v, 0, seq.side, new THREE.Vector3());
    const away = new THREE.Vector3(out.x - v.object3d.position.x, 0, out.z - v.object3d.position.z).normalize().multiplyScalar(2.4);
    try { d.onEjected?.(v, { x: out.x + away.x, y: out.y, z: out.z + away.z }); d.eject?.(v, { x: out.x + away.x, y: out.y, z: out.z + away.z }); } catch { /* PNJ sans réaction */ }
    game.bus.emit('vehicle:driverEjected', { vehicle: v, driver: d, position: { x: out.x, y: out.y, z: out.z } });
    const sev = v.owner === 'police' || v.type === 'police' ? 3 : 2;
    game.bus.emit('crime', { kind: 'carjack', severity: sev, position: { x: out.x, y: out.y, z: out.z } });
  }
  function finishEnter() {
    const v = seq.vehicle, seat = seq.seat;
    seq = null;
    if (seat === 0) { v.driver = player; v.engineOn = !v.wrecked; v.chassis.wakeUp(); }
    else v.passengers[seat - 1] = player;
    player.vehicle = v; player.state = 'inVehicle'; player.seat = seat;
    player.playAnim(seat === 0 ? 'driveWheel' : 'drive', { fade: 0.2 });
    game.bus.emit('player:enterVehicle', { vehicle: v, seat });
    game.bus.emit('notify', { text: v.label + ' — H : klaxon, N : phares' + (v.spec.siren ? ' (2× : sirène)' : ''), kind: 'info', duration: 2.2 });
  }
  /** Sortie : forcée (épave, éjection) ou normale. Renvoie la position de sortie. */
  function beginExit(forced) {
    const v = player.vehicle;
    if (!v || player.state !== 'inVehicle' || seq) return null;
    const seat = player.seat ?? 0, kmh = v.speed ?? 0;
    // côté libre le plus proche de la porte du siège
    let side = seat % 2 === 0 ? 1 : -1;
    if (blocked(v, seat, side)) side = -side;
    const door = doorPos(v, seat, side, new THREE.Vector3());
    const top = blocked(v, seat, side);
    if (top) { v.localToWorld(0, 2.2, 0, door); }
    if (seat === 0) { v.driver = null; v.engineOn = false; v.controls.throttle = 0; v.controls.steer = 0; } else v.passengers[seat - 1] = undefined;
    v.horn = false;
    player.vehicle = null;
    const lv = v.chassis.linvel();
    const rolling = kmh > 30 || forced;
    player.setPose(door.x, door.y + (top ? 0 : 0.02), door.z, v.heading);
    player.camera?.setYaw(player.camera.yaw);
    game.bus.emit('player:exitVehicle', { vehicle: v, seat });
    if (rolling) {
      // sortie en marche : roulade, le perso garde une partie de la vitesse
      player.state = 'onFoot'; player.setCollidable(true);
      player.velocity.set(lv.x * 0.55, 1.5, lv.z * 0.55);
      player.heading = Math.atan2(lv.x, lv.z); player.playAnim('dodge', { once: true, lock: true, fade: 0.08 });
      if (kmh > 60 || forced) player.applyDamage(Math.round(5 + Math.max(0, kmh - 60) * 0.25), 'roulade');
    } else {
      player.state = 'exitingVehicle';
      const d = player.playAnim('sitExit', { once: true, fade: 0.1, lock: true }) || 0.6;
      seq = { kind: 'exit', vehicle: v, t: 0, dur: Math.min(0.75, d * 0.7), pos: door.clone() };
    }
    return { x: door.x, y: door.y, z: door.z };
  }
  function stepExit(dt) {
    seq.t += dt;
    player.setPose(seq.pos.x, seq.pos.y, seq.pos.z, player.heading);
    if (seq.t >= seq.dur) { seq = null; player.state = 'onFoot'; player.setCollidable(true); player.velocity.set(0, 0, 0); }
  }

  // ---------- invite « F : Monter » ----------
  player?.addPromptProvider?.((p) => {
    if (seq) return null;
    const hit = vehicles.nearestEnterable(p.position, 3.0);
    if (!hit) return null;
    const stealing = hit.vehicle.driver && hit.vehicle.driver !== player;
    return { id: 'vehicle', key: 'F', text: stealing ? 'Voler le véhicule' : 'Monter', priority: 10, target: hit.vehicle, onTrigger: () => vehicles.enter(player, hit.vehicle, hit.seat) };
  });

  // ---------- dégâts, collisions ----------
  function _onWreck(v, source) {
    const p = v.object3d.position;
    emit(fx.flash, { x: p.x, y: p.y + 0.8, z: p.z }, { life: 0.45, vy: 0.5, size: 2.2, spread: 0 });
    for (let i = 0; i < 6; i++) emit(fx.smoke, { x: p.x, y: p.y + 0.8, z: p.z }, { life: 2.2, vy: 2.2, size: 1.8, spread: 1.4 });
    if (player.vehicle === v && player.state === 'inVehicle') beginExit(true);
    game.bus.emit('vehicle:destroyed', { vehicle: v, source });
  }
  function checkImpact(v, fdt) {
    if (!v.pv || v.chassis.isSleeping()) return;
    const lv = v.chassis.linvel();
    v._age++;
    v._hist.push(lv.x, lv.y, lv.z); if (v._hist.length > 18) v._hist.splice(0, 3);
    v._cool -= fdt;
    if (v._hist.length < 18 || v._cool > 0 || v._age < 120) return;
    const dv = Math.hypot(lv.x - v._hist[0], lv.y - v._hist[1] + 9.81 * fdt * 5, lv.z - v._hist[2]);
    if (dv < 3.0) return;
    v._cool = 0.4; v._hist.length = 0;
    // identifie l'autre partie via les contacts
    let other = null;
    try {
      world.contactPairsWith(v.collider, (c) => {
        if (other) return;
        const o = owners.get(c.handle) ?? byBody.get(c.parent()?.handle) ?? null;
        if (o) other = o;
      });
    } catch { /* API absente */ }
    const impulse = v.spec.mass * dv;
    game.bus.emit('vehicle:collision', { vehicle: v, other, impulse });
    const dmg = collisionDamage(dv, v.spec.mass, other?.spec?.mass);
    v.damage(dmg, 'collision');
    if (v.spec.twoWheel && dv > 7 && v.driver) fallOff(v, lv, dv);
    if (v.driver === player && dv > 9) player.applyDamage(Math.round((dv - 9) * 2.2), 'accident');
  }
  /** Choc violent à moto : le pilote est éjecté et la moto se couche. */
  function fallOff(v, lv, dv) {
    topple(v.pv, 2.2, (v._age % 2 ? 1 : -1));
    const d = v.driver, spd = Math.hypot(lv.x, lv.z);
    if (d === player) {
      beginExit(true);
      if (player.ragdoll) player.ragdoll({ x: lv.x * 0.7, y: 3 + dv * 0.15, z: lv.z * 0.7 }, Math.min(40, Math.round(6 + dv * 1.6)), 'chute de moto');
      game.bus.emit('notify', { text: 'Vous avez chuté de la moto !', kind: 'warning', duration: 2.5 });
    } else if (d) {
      v.driver = null; v.engineOn = false; v.controls.throttle = 0;
      const p = v.object3d.position, ox = p.x + lv.x * 0.15 + 1.2, oz = p.z + lv.z * 0.15;
      try { d.onEjected?.(v, { x: ox, y: p.y, z: oz }); } catch { /* PNJ sans réaction */ }
    }
    game.bus.emit('vehicle:fall', { vehicle: v, speed: spd * 3.6 });
  }
  // joueur à pied percuté par un véhicule rapide
  let hitCool = 0;
  function checkRunOver(dt) {
    hitCool -= dt;
    if (hitCool > 0 || !player || (player.state !== 'onFoot' && player.state !== 'swimming')) return;
    const pp = player.position;
    for (const v of vehicles.list) {
      if (v.remote || v.wrecked || v.speed < 18 || v === player.vehicle) continue;
      const vp = v.object3d.position;
      if (Math.abs(vp.x - pp.x) > 6 || Math.abs(vp.z - pp.z) > 6) continue;
      _v.set(pp.x, pp.y + 0.9, pp.z).sub(vp); _q.copy(v.object3d.quaternion).invert(); _v.applyQuaternion(_q);
      if (Math.abs(_v.x) < v.geom.halfW + 0.35 && Math.abs(_v.z) < v.geom.halfL + 0.35 && Math.abs(_v.y) < 1.8) {
        const lv = v.chassis.linvel();
        hitCool = 1.5;
        player.ragdoll({ x: lv.x * 0.8, y: 4 + v.speed * 0.03, z: lv.z * 0.8 }, Math.min(45, Math.round(8 + v.speed * 0.35)), 'véhicule');
        game.bus.emit('vehicle:collision', { vehicle: v, other: player, impulse: v.spec.mass * v.speed / 3.6 });
        v.chassis.setLinvel({ x: lv.x * 0.9, y: lv.y, z: lv.z * 0.9 }, true);
        return;
      }
    }
  }

  // ---------- pas physique ----------
  step.preStep.push((fdt) => {
    const wet = game.world?.weather?.wetness ?? game.world?.weather?.rain ?? 0;
    for (const v of vehicles.list) v.physicsStep(fdt, typeof wet === 'number' ? wet : 0);
  });
  step.postStep.push((fdt) => { for (const v of vehicles.list) checkImpact(v, fdt); });

  // ---------- commandes du joueur (avant la physique) ----------
  game.onUpdate((dt) => {
    const v = player?.state === 'inVehicle' ? player.vehicle : null;
    if (!v || game.state !== 'playing') { if (v) { v.controls.throttle = 0; v.controls.brake = 0.4; } return; }
    const input = game.input;
    const my = input.axis('moveY'), mx = input.axis('moveX');
    const vF = v.pv?.out.forwardSpeed ?? 0;
    const c = v.controls;
    const sp = v.pv?.out.speed ?? 0;
    v._steerF = steerInput(v._steerF ?? 0, mx, sp, dt, v.spec); // direction progressive, dépendante de la vitesse
    c.steer = v._steerF; c.handbrake = input.isDown('handbrake');
    if (my < 0 && vF > 1.5) { c.brake = -my; c.throttle = 0; }
    else { c.brake = 0; c.throttle = my; }
    if (v.wrecked || !v.engineOn) { c.throttle = 0; }
    // G : remise sur roues quand la voiture est sur le toit ou sur le flanc
    if (input.pressed('flip') && v.pv && v.pv.out.up < 0.5 && v.pv.out.speed < 8 && !v.wrecked) { v.flip(); game.bus.emit('notify', { text: 'Voiture remise sur ses roues', kind: 'info', duration: 2 }); }
    if (input.pressed('horn')) game.bus.emit('vehicle:horn', { vehicle: v });
    v.horn = input.isDown('horn');
    if (input.pressed('lights')) {
      // phares → (sirène si le véhicule en a une) → éteint
      if (!v.lights) v.lights = true;
      else if (v.spec.siren && !v.siren) v.siren = true;
      else { v.lights = false; v.siren = false; }
    }
    if (input.pressed('camera')) player.camera?.nextMode();
    if (input.pressed('interact') && !seq) beginExit(false);
  }, -50);

  // ---------- image ----------
  let guardN = 0;
  game.onUpdate((dt) => {
    const alpha = clamp(step.alpha ?? 1, 0, 1);
    if (seq) { if (seq.kind === 'enter') stepEnter(dt); else stepExit(dt); }
    const pp = player?.position;
    const now = game.time?.elapsed ?? 0;
    let fxBudget = 0;
    guardN++;
    for (let i = vehicles.list.length - 1; i >= 0; i--) {
      const v = vehicles.list[i];
      const far = pp ? Math.hypot(v.object3d.position.x - pp.x, v.object3d.position.z - pp.z) : 0;
      v.object3d.visible = far < 320;
      // garde-fou : véhicule passé sous le sol (téléportation dans un immeuble…) → remis sur la route la plus proche
      // (corps Rapier lu en direct : object3d n'est mis à jour que pour les véhicules proches ; 1 image sur 3 suffit)
      if (!v.remote && (guardN + i) % 3 === 0) {
        const t = v.chassis.translation(), g = game.world?.groundHeight?.(t.x, t.z);
        if (typeof g === 'number' && t.y < g - 1.5) {
          const r = game.world.nearestRoadPoint?.(t) ?? t;
          vehicles.teleport(v, { x: r.x, z: r.z }, v.heading);
        }
      }
      if (far < 320 || v.driver) v.update(dt, alpha);
      // noyade : une voiture qui s'enfonce dans la mer ralentit brutalement et se détruit en quelques secondes
      if (!v.remote && !v.wrecked && far < 320 && (guardN + i) % 3 === 1) {
        const o = v.object3d.position, dep = game.world?.water?.depth?.(o.x, o.z) ?? 0;
        if (dep > 1.2) {
          const lv = v.chassis.linvel(), k = Math.max(0, 1 - 2.4 * dt * 3);
          v.chassis.setLinvel({ x: lv.x * k, y: lv.y, z: lv.z * k }, true);
          v.damage(14 * dt * 3, 'noyade');
          if (v.driver === player && !v._drownWarned) { v._drownWarned = true; game.bus.emit('notify', { text: 'La voiture prend l\'eau : sortez de là !', kind: 'warning', duration: 3 }); }
        } else v._drownWarned = false;
      }
      if (far < 320) { const cp = game.three.camera.position, o = v.object3d.position; v.setLod(Math.hypot(o.x - cp.x, o.z - cp.z)); }
      // retournement : remise sur roues après 3 s (5 s avec le joueur au volant)
      if (v.pv && v.pv.flipT > flipDelay(v.driver === player) && !v.wrecked) { v.flip(); }
      // fumée / feu
      const lvl = damageLevel(v.health);
      if ((lvl === 'smoke' || lvl === 'fire' || lvl === 'wreck') && far < 120) {
        v._fxT = (v._fxT ?? 0) - dt;
        if (v._fxT <= 0 && fxBudget++ < 6) {
          v._fxT = lvl === 'smoke' ? 0.14 : 0.07;
          const e = v.localToWorld(0, 0.9, v.geom.halfL * 0.7, _v2);
          emit(fx.smoke, e, { life: 1.8, vy: 1.8, size: lvl === 'smoke' ? 1.1 : 1.6 });
          if (lvl === 'fire') emit(fx.fire, e, { life: 0.6, vy: 1.4, size: 1.0, spread: 0.7 });
        }
      }
      // l'incendie ronge la carrosserie jusqu'à l'épave
      if (lvl === 'fire') v.damage(1.4 * dt, 'incendie');
      // épave abandonnée (le « conducteur » factice d'une voiture de circulation ne compte pas) : disparaît après 2 min si loin du joueur
      if (v.wrecked && (!v.driver || v.driver.npc) && now - (v.wreckedAt ?? now) > 120 && far > 60) vehicles.remove(v);
    }
    updateFx(dt);
    // phare du véhicule du joueur
    const cv = player?.state === 'inVehicle' ? player.vehicle : null;
    if (cv && cv.lights && !cv.wrecked) {
      cv.localToWorld(0, 0.7, cv.geom.halfL, spot.position);
      cv.localToWorld(0, 0.2, cv.geom.halfL + 25, spot.target.position);
      spot.intensity = 90;
    } else spot.intensity = 0;
    checkRunOver(dt);
  }, 4);
  // ordre 80 : pose du joueur assis recalculée après le déplacement des véhicules (interpolation à jour)
  game.onUpdate(() => {
    const cv = player?.state === 'inVehicle' ? player.vehicle : null;
    if (!cv) return;
    const s = seatLocal(cv, player.seat ?? 0), o = player.object3d;
    const lean = cv.spec.twoWheel ? (cv.inner.rotation.z || 0) : 0; // moto : le pilote s'incline avec elle
    cv.localToWorld(s.x - Math.sin(lean) * s.y, s.y * Math.cos(lean), s.z, o.position);
    o.quaternion.copy(cv.object3d.quaternion);
    if (lean) o.quaternion.multiply(_q.setFromAxisAngle(_v.set(0, 0, 1), lean));
  }, 80);

  // ---------- véhicules garés ----------
  function spawnParked() {
    const pts = game.world?.spawnPoints?.vehicles;
    const r = rng(20261118);
    let n = 0;
    if (Array.isArray(pts) && pts.length) {
      for (const sp of pts.slice(0, 48)) {
        const type = sp.type ?? PARKED_POOL[Math.floor(r() * PARKED_POOL.length)];
        vehicles.spawn(type, { x: sp.x, y: typeof sp.y === 'number' ? sp.y : undefined, z: sp.z }, sp.rotation ?? 0, { owner: 'npc' });
        n++;
      }
    } else if (player) {
      // pas de points de spawn : quelques voitures garées autour du joueur
      const c = player.position;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + 0.6, d = 9 + r() * 10;
        const x = c.x + Math.sin(a) * d, z = c.z + Math.cos(a) * d;
        vehicles.spawn(PARKED_POOL[Math.floor(r() * 8)], { x, z }, a + Math.PI / 2, { owner: 'npc' });
      }
    }
    return n;
  }
  spawnParked();

  // ---------- voiture libre près du joueur (départ et réapparitions) ----------
  const NEAR_FREE = 30, STARTER_MAX = 3;
  const isFree = (v) => !v.driver && !v.wrecked && !v.remote && v.health > 50 && v.owner !== 'police' && v.owner !== 'remote';
  /** Gare une berline au bord de la route, 8 à 28 m du point, orientée dans le sens de la voie. Renvoie le véhicule ou null. */
  vehicles.ensureNearby = (pos) => {
    const roads = game.world?.roads;
    if (!roads?.nearest || !pos) return null;
    const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    for (const v of vehicles.list) {
      if (!isFree(v)) continue;
      const t = v.chassis.translation();
      if (dist(t, pos) < NEAR_FREE) return v; // déjà une voiture à portée
    }
    // plafond : les voitures de départ abandonnées au loin sont retirées avant d'en poser une autre
    const starters = vehicles.list.filter((v) => v._starter);
    for (const v of starters) if (!v.driver && dist(v.chassis.translation(), pos) > 80) vehicles.remove(v);
    if (vehicles.list.filter((v) => v._starter).length >= STARTER_MAX) return null;
    const near = roads.nearest(pos.x, pos.z); if (!near?.edge) return null;
    // à éviter : lieux et cible de mission, autres véhicules
    const avoid = (game.gameplay?.markers ?? []).filter((m) => m.kind === 'mission').map((m) => ({ x: m.x, z: m.z }));
    const tg = game.gameplay?.active?.target; if (tg) avoid.push({ x: tg.x, z: tg.z });
    let best = null, bs = Infinity;
    const e = near.edge;
    for (const ds of [0, 8, -8, 14, -14, 20, -20, 28, -28, 36, -36]) {
      const s = near.s + ds; if (s < 10 || s > e.len - 10) continue;
      const p = roads.pointAt(e, s);
      for (const side of [1, -1]) {
        const off = side * (e.width / 2 - 1.5), x = p.x - p.tz * off, z = p.z + p.tx * off;
        const d = dist({ x, z }, pos);
        if (d < 8 || d > 28) continue;
        if ((game.world?.water?.depth?.(x, z) ?? 0) > 0.1) continue;
        if (avoid.some((a) => dist(a, { x, z }) < 12)) continue;
        if (vehicles.list.some((v) => dist(v.chassis.translation(), { x, z }) < 6)) continue;
        const score = Math.abs(d - 14);
        if (score < bs) { bs = score; best = { x, z, rot: Math.atan2(p.tx * side, p.tz * side) }; }
      }
    }
    if (!best) return null;
    const v = vehicles.spawn('sedan', { x: best.x, z: best.z }, best.rot, { owner: 'npc' });
    v._starter = true;
    return v;
  };
  // départ puis réapparitions : on laisse le joueur se placer, puis on vérifie
  let starterAt = null, starterDone = false;
  game.bus.on('player:respawn', () => { starterAt = 0.6; });
  game.onUpdate((dt) => {
    if (!starterDone && game.state === 'playing') { starterDone = true; starterAt = 0.8; }
    if (starterAt == null) return;
    starterAt -= dt;
    if (starterAt <= 0) { starterAt = null; if (player?.position) vehicles.ensureNearby(player.position); }
  }, 5);
}
