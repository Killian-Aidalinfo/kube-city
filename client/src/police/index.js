// Police (spec 9) : chaleur → étoiles, témoins, patrouilles, poursuite, barrages, hélicoptère, zone de recherche, arrestation.
import { heatFromCrime, levelFromHeat, heatForLevel, newSearch, stepSearch, isWitnessed, UNIT_TARGET } from './logic.js';
import { createHeli } from './heli.js';
import { createFootCops } from './foot.js';
import { normalizeGraph } from '../npc/graph.js';
import { PolyPath, headingOf, steerTo, speedCommand, relocate } from '../npc/driver.js';
import { makeRng, yawOf } from '../npc/logic.js';

const KMH = 1 / 3.6, CAP = 8;
const fwd = { x: 0, z: 1 };

/** @param {object} game contexte (spec 3.1) */
export function install(game) {
  const rng = makeRng(777);
  const heli = createHeli(game);
  const foot = createFootCops(game, rng);
  const search = newSearch();
  let graph = null, heat = 0, frame = 0, bustT = 0, lastCry = -99, blockT = 99, cooldown = 0, ambientDone = false;
  const cars = [];   // unités véhicule : { veh, role: 'chase'|'block', path, repath, stuck, rev, parked }
  const blocks = [];

  const sdt = (dt) => dt * (game.time.scale ?? 1);
  const pp = () => game.player?.position ?? { x: 0, y: 0, z: 0 };
  const playerVel = () => {
    const l = game.player?.vehicle?.chassis?.linvel?.();
    if (l) return l;
    return game.player?.velocity ?? { x: 0, z: 0 };
  };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  function setLevel(level, silent) {
    level = Math.max(0, Math.min(5, level | 0));
    const previous = police.level;
    if (previous === level) return;
    police.level = level;
    heat = level === 0 ? 0 : Math.max(heat, heatForLevel(level));
    if (level < previous && level > 0) heat = heatForLevel(level);
    if (previous === 0) search.unseen = 0;
    game.bus.emit('wanted:changed', { level, previous });
    if (level === 0 && !silent) game.bus.emit('notify', { text: 'Vous avez semé la police.', kind: 'success', duration: 4 });
  }

  /** Point de route aléatoire entre min et max mètres du joueur, hors du champ de la caméra si possible. */
  function roadPoint(min, max) {
    const p = pp();
    if (!graph?.arcs.length) {
      const a = rng() * 6.28, r = (min + max) / 2; return { x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, yaw: a };
    }
    for (let k = 0; k < 20; k++) {
      const arc = graph.arcs[(rng() * graph.arcs.length) | 0], t = rng() * arc.len, A = graph.nodes[arc.a];
      const x = A.x + arc.dx * t - arc.dz * 2, z = A.z + arc.dz * t + arc.dx * 2, d = dist({ x, z }, p);
      if (d < min || d > max) continue;
      return { x, z, yaw: yawOf(arc.dx, arc.dz) };
    }
    return null;
  }

  /** Obtient une voiture : patrouille ambiante reprise à la circulation, sinon nouvelle voiture. */
  function acquire(type = 'police') {
    const amb = (game.npc?.traffic ?? []).find((c) => c.veh.type === type && !cars.some((u) => u.veh === c.veh));
    let veh = amb?.veh;
    if (veh) game.npc.releaseVehicle(veh);
    else if (cars.length + blocks.length < CAP && game.vehicles?.spawn) {
      const s = roadPoint(110, 190); if (!s) return null;
      try { veh = game.vehicles.spawn(type, { x: s.x, y: 0.8, z: s.z }, s.yaw, { owner: 'police' }); } catch { return null; }
    }
    if (!veh) return null;
    veh.owner = 'police'; veh.siren = true; veh.engineOn = true;
    return veh;
  }

  function dismiss(u) {
    u.veh.setControls?.({ throttle: 0, brake: 0, steer: 0, handbrake: false });
    u.veh.siren = false;
    game.npc?.adoptVehicle?.(u.veh);
  }

  function ensureUnits() {
    const want = UNIT_TARGET[police.level];
    while (cars.length < want) {
      const veh = acquire(police.level >= 5 && cars.length % 3 === 2 ? 'suv' : 'police');
      if (!veh) break;
      cars.push({ veh, role: 'chase', path: null, repath: 0, stuck: 0, rev: 0 });
    }
    while (cars.length > want) dismiss(cars.pop());
  }

  function pitchOrDrive(u, target, desired, ram, t, dt) {
    const veh = u.veh, p = veh.object3d.position, h = headingOf(veh.object3d, fwd);
    const speed = (veh.speed ?? 0) * KMH;
    let tgt = target;
    const d = dist(p, target);
    if (!ram && d > 40 && game.world?.route) {
      u.repath -= dt;
      if (u.repath <= 0 || !u.path) {
        u.repath = 2;
        try { const r = game.world.route({ x: p.x, y: 0, z: p.z }, { x: target.x, y: 0, z: target.z }); u.path = r?.length > 2 ? new PolyPath(r) : null; } catch { u.path = null; }
      }
      if (u.path) { u.path.update(p); tgt = u.path.target(Math.max(8, speed), p); }
    }
    // marche arrière quand coincé
    if (speed < 0.6 && d > 8) u.stuck += dt; else u.stuck = 0;
    if (u.stuck > 2.5) { u.rev = 1.4; u.stuck = 0; }
    if (u.rev > 0) { u.rev -= dt; veh.setControls({ throttle: 0, brake: 1, steer: -steerTo(h.x, h.z, tgt.x - p.x, tgt.z - p.z), handbrake: false }); return; }
    const steer = steerTo(h.x, h.z, tgt.x - p.x, tgt.z - p.z);
    const turn = Math.min(1, Math.abs(steer));
    const cmd = speedCommand(speed, desired * (1 - 0.45 * turn));
    veh.setControls({ throttle: cmd.throttle, brake: cmd.brake, steer, handbrake: false });
    void t;
  }

  function placeBlocks() {
    for (const b of blocks.splice(0)) dismiss(b);
    const p = pp(), v = playerVel();
    let dx = v.x, dz = v.z; let l = Math.hypot(dx, dz);
    if (l < 2 && game.player?.vehicle) { const h = headingOf(game.player.vehicle.object3d, { x: 0, z: 1 }); dx = h.x; dz = h.z; l = 1; }
    if (l < 1 || !graph?.arcs.length) return;
    dx /= l; dz /= l;
    let best = null, bs = -1;
    for (const a of graph.arcs) {
      const A = graph.nodes[a.a];
      const mx = A.x + a.dx * a.len / 2 - p.x, mz = A.z + a.dz * a.len / 2 - p.z, d = Math.hypot(mx, mz);
      if (d < 130 || d > 230) continue;
      const s = (mx * dx + mz * dz) / d;
      if (s > 0.55 && s > bs) { bs = s; best = { a, A }; }
    }
    if (!best) return;
    const { a, A } = best, mx = A.x + a.dx * a.len / 2, mz = A.z + a.dz * a.len / 2;
    for (let i = 0; i < 2; i++) {
      const veh = acquire(); if (!veh) break;
      const off = (i ? 2.4 : -2.4);
      relocate(veh, { x: mx - a.dz * off, z: mz + a.dx * off }, yawOf(a.dx, a.dz) + Math.PI / 2 + (i ? 0.35 : -0.35));
      veh.setControls({ throttle: 0, brake: 1, steer: 0, handbrake: true });
      blocks.push({ veh, role: 'block' });
    }
    blockT = 0;
  }

  function seenByPolice(p) {
    for (const u of cars) if (dist(u.veh.object3d.position, p) < 55) return true;
    for (const u of blocks) if (dist(u.veh.object3d.position, p) < 40) return true;
    if (heli.active && dist(heli.position, p) < 90) return true;
    for (const c of foot.cops) if (c.active && !c.isDown && dist(c.position, p) < 35) return true;
    return false;
  }

  function nearestCop(p) {
    let d = 1e9;
    for (const u of cars) d = Math.min(d, dist(u.veh.object3d.position, p));
    for (const u of blocks) d = Math.min(d, dist(u.veh.object3d.position, p));
    for (const c of foot.cops) if (c.active) d = Math.min(d, dist(c.position, p));
    for (const c of game.npc?.traffic ?? []) if (c.veh.type === 'police') d = Math.min(d, dist(c.veh.object3d.position, p));
    return d;
  }

  function clearAll() {
    for (const u of cars.splice(0)) dismiss(u);
    for (const b of blocks.splice(0)) dismiss(b);
    for (const c of foot.cops) foot.recall(c);
    heli.set(false);
    heat = 0; Object.assign(search, newSearch());
    police.searchZone = null; police.searching = false;
  }

  function busted() {
    if (cooldown > 0) return;
    cooldown = 6;
    game.bus.emit('wanted:busted', {});
    clearAll();
    setLevel(0, true);
  }

  function update(dt) {
    frame++;
    dt = sdt(dt);
    cooldown -= dt;
    if (!graph) graph = normalizeGraph(game.world?.roads);
    const t = game.time.elapsed, p = pp();
    // patrouilles ambiantes (2) rendues à la circulation
    if (!ambientDone && frame > 90 && game.vehicles?.spawn && graph.arcs.length && game.npc?.adoptVehicle) {
      ambientDone = true;
      for (let i = 0; i < 2; i++) {
        const s = roadPoint(80, 220); if (!s) continue;
        try { const v = game.vehicles.spawn('police', { x: s.x, y: 0.8, z: s.z }, s.yaw, { owner: 'police' }); if (v) { v.owner = 'police'; v.engineOn = true; game.npc.adoptVehicle(v); } } catch { /* pas de véhicules */ }
      }
    }
    const lvl = police.level;
    const onFoot = game.player?.state === 'onFoot' || game.player?.state === 'ko' || game.player?.state === 'ragdoll';
    police.units = [...cars, ...blocks];
    police.footUnits = foot.cops.filter((c) => c.active);
    police.helicopter = heli.active ? heli : null;
    if (lvl <= 0) { heli.update(dt, p, p, t); foot.update(dt, p, false); return; }

    ensureUnits();
    // hélicoptère à partir de 4 étoiles
    heli.set(lvl >= 4, p);
    // barrages à partir de 3 étoiles, renouvelés régulièrement
    if (lvl >= 3) { blockT += dt; if (blockT > 25 && frame % 30 === 0) placeBlocks(); } else if (blocks.length) for (const b of blocks.splice(0)) dismiss(b);

    const seen = seenByPolice(p);
    const st = stepSearch(search, { dt, seen, pos: p, level: lvl });
    police.searching = st === 'searching';
    police.searchZone = search.zone;
    police.searchTimer = Math.max(0, search.timer); police.searchTotal = search.total;
    if (st === 'lost') { clearAll(); setLevel(0); return; }
    if (seen && t - lastCry > 25) { lastCry = t; game.bus.emit('subtitle', { speaker: 'Police', text: lvl >= 3 ? 'Suspect en vue ! Toutes les unités !' : 'Police ! Arrêtez-vous !', duration: 3 }); }

    // cible : le joueur s'il est vu, sinon dernière position connue, sinon un point de la zone
    const inVeh = !onFoot && game.player?.vehicle;
    const v = playerVel();
    const lk = search.lastKnown ?? p;
    let target = seen ? p : lk;
    for (let i = 0; i < cars.length; i++) {
      const u = cars[i];
      const q = u.veh.object3d.position, d = dist(q, p);
      let tg = target, desired = 24, ram = false;
      if (st === 'searching' && search.zone) {
        u.wander = (u.wander ?? 0) - dt;
        if (u.wander <= 0 || !u.wp) { u.wander = 9; const a = rng() * 6.28, r = rng() * search.zone.radius; u.wp = { x: search.zone.center.x + Math.cos(a) * r, z: search.zone.center.z + Math.sin(a) * r }; u.path = null; }
        tg = u.wp; desired = 15;
      } else if (seen && lvl >= 3 && inVeh && d < 26) {
        ram = true; tg = { x: p.x + v.x * 0.45, z: p.z + v.z * 0.45 }; desired = 32; // éperonnage
      }
      if (onFoot && seen && d < 14) {
        // s'arrête près du joueur à pied et fait sortir les policiers
        u.veh.setControls({ throttle: 0, brake: 1, steer: 0, handbrake: true });
        if (!u.deployed && (u.veh.speed ?? 0) < 8) { u.deployed = true; foot.deploy(q.x, q.z, lvl >= 3 ? 3 : 2); }
        continue;
      }
      u.deployed = false;
      pitchOrDrive(u, tg, desired, ram, t, dt);
    }

    // policiers à pied : arrestation
    const canArrest = (onFoot || (inVeh && (game.player.vehicle.speed ?? 0) < 4)) && game.player?.state !== 'enteringVehicle';
    const near = foot.update(dt, p, canArrest);
    if (!onFoot) for (const c of foot.cops) if (c.active && search.unseen > 8) foot.recall(c);
    const reach = inVeh ? 3 : 1.6;
    if (canArrest && near < reach) bustT += dt; else bustT = Math.max(0, bustT - dt * 1.5);
    police.arrestProgress = Math.min(1, bustT / (lvl >= 3 ? 1.1 : 1.8));
    if (bustT > (lvl >= 3 ? 1.1 : 1.8)) { bustT = 0; busted(); return; }

    // projecteur de l'hélicoptère
    heli.update(dt, seen || !search.zone ? p : search.zone.center, p, t);
  }

  // --- crimes : chaleur et témoins ---
  game.bus.on('crime', (c) => {
    if (!c || !c.position) return;
    const copD = Math.min(nearestCop(c.position), nearestCop(pp()));
    if (!isWitnessed(c, copD)) return;
    if (c.kind === 'shootCop') c.severity = Math.max(c.severity ?? 1, 1);
    police.report(c.kind, c.severity);
  });
  // changer de véhicule hors de vue fait baisser la recherche
  game.bus.on('player:enterVehicle', () => {
    if (police.level > 0 && search.mode === 'searching') { search.timer *= 0.45; game.bus.emit('notify', { text: 'Nouveau véhicule : la police perd votre trace.', kind: 'info', duration: 3 }); }
  });
  game.bus.on('vehicle:repainted', () => police.notifyRepaint());
  game.bus.on('player:respawn', () => { clearAll(); setLevel(0, true); });

  const police = game.police = {
    level: 0,
    units: [], footUnits: [], helicopter: null,
    /** Zone de recherche { center: {x,z}, radius } ou null. */
    searchZone: null,
    /** Vrai pendant la recherche (étoiles clignotantes). */
    searching: false, searchTimer: 0, searchTotal: 0, arrestProgress: 0,
    get heat() { return heat; },
    get blinking() { return police.searching; },
    setLevel,
    clear() { clearAll(); setLevel(0); },
    /** Ajoute de la chaleur pour un crime déjà jugé vu. */
    report(kind, severity = 1) {
      heat += heatFromCrime(kind, severity);
      search.unseen = 0;
      const l = levelFromHeat(heat);
      if (l > police.level) setLevel(l);
      else if (police.level > 0) { search.mode = 'hunting'; search.zone = null; search.timer = search.total; }
    },
    /** Appelé par le garage après une repeinture (ou l'événement 'vehicle:repainted'). */
    notifyRepaint() {
      if (police.level <= 0) return;
      if (search.mode === 'searching') { search.timer *= 0.3; game.bus.emit('notify', { text: 'Nouvelle peinture : la police ne vous reconnaît plus.', kind: 'success', duration: 3 }); }
      else if (police.level > 1 && !seenByPolice(pp())) setLevel(police.level - 1);
    },
  };
  game.onUpdate(update, 10);
}
