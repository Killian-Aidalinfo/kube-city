// Piétons : trottoirs, traversées, réactions, K.O., répliques, LOD et pool.
import * as THREE from 'three';
import { createCharacter, loadKit, pedOutfits } from './character.js';
import { normalizeGraph, nextArc } from './graph.js';
import { pedTarget, QUALITY_PEDS } from './logic.js';

const LINES_BUMP = ['Hé ! Regardez où vous allez !', 'Non mais oh, ça va pas ?', 'Pardon, hein !', 'Vous avez cru que c’était un circuit ?', 'Aïe, mon café !', 'Quel manque de savoir-vivre.'];
const LINES_FLEE = ['Au secours !', 'Appelez la police !', 'Sauve qui peut !', 'Il est fou !'];
const LINES_BRAVE = ['Tu veux te battre ? Viens !', 'Je vais t’apprendre les bonnes manières !'];
const LINES_CAR = ['Attention, le trottoir !', 'Eh ! On est sur le trottoir !', 'Vous êtes fou, ralentissez !', 'Pousse-toi, il arrive !'];
const LINES_RAIN = ['Quelle averse !', 'Vite, à l’abri !', 'Il pleut des cordes…'];
const LINES_CHEER = ['Bravo ! Quelle cascade !', 'Waouh, il a volé !', 'Encore, encore !'];
const WALK = 1.4, RUN = 4.6;
const tmp = new THREE.Vector3();

export function createPeds(game, rng) {
  const { scene, camera } = game.three;
  const peds = [];
  let rainy = false, dry = true, boxes = null, shelterBudget = 0, fast = [], stuntAt = null;
  let kit = null, kitReady = false, outfits = pedOutfits(game), graph = null, lastSubtitle = -99, frame = 0;
  loadKit(game).then((k) => { kit = k; kitReady = true; });

  const sdt = (dt) => dt; // la boucle applique déjà game.time.scale
  const quality = () => game.settings.get('quality');
  const maxPeds = () => Math.round((QUALITY_PEDS[quality()] ?? 45) * game.settings.get('pedDensity'));
  const playerPos = () => game.player?.position ?? { x: 0, y: 0, z: 0 };
  const groundY = (x, z) => game.world?.groundHeight?.(x, z) ?? 0;

  function say(ped, list, force = false) {
    const now = game.time.elapsed;
    if (!force && now - lastSubtitle < 4) return;
    lastSubtitle = now;
    game.bus.emit('subtitle', { speaker: 'Passant', text: list[(rng() * list.length) | 0], duration: 2.5 });
  }

  /** Point de départ sur un trottoir (ou autour du joueur sans graphe), hors champ si possible. */
  function pickSpawn() {
    const pp = playerPos();
    const g = graph;
    for (let k = 0; k < 14; k++) {
      let x, z, arc = null;
      if (g?.arcs.length) {
        arc = g.arcs[(rng() * g.arcs.length) | 0];
        const t = rng() * arc.len, A = g.nodes[arc.a];
        x = A.x + arc.dx * t; z = A.z + arc.dz * t;
      } else {
        const a = rng() * Math.PI * 2, r = 35 + rng() * 90;
        x = pp.x + Math.cos(a) * r; z = pp.z + Math.sin(a) * r;
        if (game.world?.isRoad?.(x, z)) continue;
      }
      const d = Math.hypot(x - pp.x, z - pp.z);
      if (d < 25 || d > 150) continue;
      tmp.set(x - camera.position.x, 0, z - camera.position.z).normalize();
      const fwd = camera.getWorldDirection(new THREE.Vector3()); fwd.y = 0; fwd.normalize();
      if (d < 70 && tmp.dot(fwd) > 0.4) continue; // pas devant le nez du joueur
      return { x, z, arc };
    }
    return null;
  }

  function makePed(i) {
    const outfit = outfits[i % outfits.length];
    const ch = createCharacter(game, kit, outfit);
    ch.root.visible = false;
    scene.add(ch.root);
    const ped = {
      kind: 'ped', id: i, ch, root: ch.root, position: ch.root.position, radius: 0.4, height: 1.8,
      active: false, state: 'walk', t: 0, yaw: 0, speed: WALK, arc: null, hp: 40, brave: rng() < 0.15, shelterer: rng() < 0.7,
      threat: null, callCb: null, lodAcc: 0, vis: false, side: rng() < 0.5 ? 1.6 : -1.6, cooldown: 0,
      get isDown() { return this.state === 'ko' || this.state === 'stun'; },
      receiveHit(hit) { return onHit(ped, hit); },
    };
    return ped;
  }

  function place(ped, s) {
    ped.active = true; ped.state = 'walk'; ped.hp = 40; ped.t = 0; ped.threat = null; ped.callCb = null;
    ped.arc = s.arc; ped.speed = WALK * (0.8 + rng() * 0.5);
    ped.position.set(s.x, groundY(s.x, s.z), s.z);
    if (s.arc) ped.yaw = Math.atan2(s.arc.dx, s.arc.dz); else ped.yaw = rng() * 6.28;
    ped.root.rotation.y = ped.yaw;
    ped.root.visible = true;
    for (const c of [...ped.root.children]) if (c.userData.paint) ped.root.remove(c); // taches de peinture
    ped.ch.play('Idle_Loop', { fade: 0 });
  }

  function onHit(ped, hit) {
    if (!ped.active || ped.state === 'ko') return false;
    const from = hit.from ?? playerPos();
    if (hit.kind === 'taser') { setState(ped, 'stun', 4.5); return true; }
    if (hit.kind === 'paint') {
      const blob = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: hit.color ?? 0xff3399 }));
      blob.scale.z = 0.4; blob.position.set((rng() - 0.5) * 0.3, 0.9 + rng() * 0.7, 0.18); blob.userData.paint = true;
      ped.root.add(blob);
    } else {
      ped.hp -= hit.amount ?? 10;
      ped.root.position.x += (hit.dir?.x ?? 0) * 0.35; ped.root.position.z += (hit.dir?.z ?? 0) * 0.35;
    }
    if (ped.hp <= 0) { setState(ped, 'ko', 14 + rng() * 8); return true; }
    ped.threat = { x: from.x, z: from.z };
    if (ped.brave && hit.kind !== 'paint') { setState(ped, 'fight', 12); say(ped, LINES_BRAVE, true); }
    else { setState(ped, 'flee', 7 + rng() * 4); say(ped, LINES_FLEE, true); }
    return true;
  }

  function setState(ped, s, dur = 0) {
    ped.state = s; ped.t = dur;
    switch (s) {
      case 'ko': ped.ch.play('Death01', { loop: false, fade: 0.1 }); break;
      case 'stun': ped.ch.play('Death01', { loop: false, fade: 0.05 }); break;
      case 'flee': ped.ch.play('Sprint_Loop', { speed: 1 }); break;
      case 'fight': ped.ch.play('Jog_Fwd_Loop'); break;
      case 'call': ped.ch.play('Idle_Talking_Loop'); break;
      case 'cheer': ped.ch.play('Idle_Talking_Loop', { speed: 2.6 }); break;
      case 'idle': ped.ch.play('Idle_Loop'); break;
      default: ped.ch.play('Walk_Loop', { speed: ped.speed / WALK });
    }
  }

  function faceMove(ped, dx, dz, dt, rate = 8) {
    const want = Math.atan2(dx, dz);
    let d = want - ped.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    ped.yaw += d * Math.min(1, rate * dt);
    ped.root.rotation.y = ped.yaw;
  }

  /** Marche le long du graphe de trottoirs, ou erre sans graphe en évitant les routes. */
  function walk(ped, dt) {
    let dx, dz;
    if (ped.arc && graph) {
      const A = graph.nodes[ped.arc.a], B = graph.nodes[ped.arc.b];
      const tx = B.x - ped.arc.dz * ped.side * 0.1, tz = B.z + ped.arc.dx * ped.side * 0.1;
      dx = tx - ped.position.x; dz = tz - ped.position.z;
      if (Math.hypot(B.x - ped.position.x, B.z - ped.position.z) < 1.5) {
        ped.arc = nextArc(graph, ped.arc, rng);
        if (!ped.arc) { setState(ped, 'idle', 2 + rng() * 3); return; }
        if (rng() < 0.12) setState(ped, 'idle', 2 + rng() * 4); // petite pause
      }
      void A;
    } else {
      dx = Math.sin(ped.yaw); dz = Math.cos(ped.yaw);
      ped.wander = (ped.wander ?? 0) - dt;
      if (ped.wander <= 0) { ped.yaw += (rng() - 0.5) * 1.6; ped.wander = 1 + rng() * 3; }
      const nx = ped.position.x + dx * 1.5, nz = ped.position.z + dz * 1.5;
      if (game.world?.isRoad?.(nx, nz)) ped.yaw += Math.PI * 0.6;
    }
    const l = Math.hypot(dx, dz) || 1;
    faceMove(ped, dx, dz, dt);
    moveBy(ped, Math.sin(ped.yaw) * ped.speed * dt, Math.cos(ped.yaw) * ped.speed * dt);
    void l;
  }

  function moveBy(ped, mx, mz) {
    const p = ped.position;
    p.x += mx; p.z += mz; p.y = groundY(p.x, p.z);
  }

  function nearestVehicle(ped, r) {
    let best = null, bd = r;
    for (const v of game.vehicles?.list ?? []) {
      const q = v.object3d?.position; if (!q) continue;
      const d = Math.hypot(q.x - ped.position.x, q.z - ped.position.z);
      if (d < bd) { bd = d; best = v; }
    }
    return best ? { v: best, d: bd } : null;
  }

  function update(dt) {
    frame++;
    dt = sdt(dt);
    if (!kitReady) return;
    if (!graph) {
      const sw = normalizeGraph(game.world?.sidewalks);
      graph = sw.arcs.length ? sw : normalizeGraph(game.world?.roads);
    }
    const pp = playerPos();
    const hour = game.time.dayTime;
    const dist = game.world?.district?.(pp.x, pp.z)?.name ?? '';
    const target = Math.min(maxPeds(), pedTarget({ quality: quality(), density: game.settings.get('pedDensity'), district: dist, hour }));
    game.npc.maxPeds = maxPeds();
    // création progressive du pool (2 par image) puis activation jusqu'à la cible
    if (peds.length < Math.min(maxPeds(), target + 4)) peds.push(makePed(peds.length));
    let activeCount = 0;
    for (const p of peds) if (p.active) activeCount++;
    const driver = game.player?.vehicle ?? null;
    const pv = driver?.speed ?? 0;
    shelterBudget = 2;
    rainy = (game.world?.weather?.rain ?? 0) > 0.45;
    dry = (game.world?.weather?.rain ?? 0) < 0.15;
    fast.length = 0;
    for (const v of game.vehicles?.list ?? []) {
      if (!v.object3d || v.wrecked || Math.abs(v.speed) < (v === driver ? 10 : 22)) continue; // la voiture du joueur effraie dès 10 km/h
      const q = v.object3d.position;
      if (Math.abs(q.x - pp.x) < 80 && Math.abs(q.z - pp.z) < 80) fast.push(v);
    }

    for (const ped of peds) {
      if (!ped.active) {
        if (activeCount < target && frame % 4 === ped.id % 4) {
          const s = pickSpawn(); if (s) { place(ped, s); activeCount++; }
        }
        continue;
      }
      const d = Math.hypot(ped.position.x - pp.x, ped.position.z - pp.z);
      // LOD : masqué au-delà de 120 m, recyclé au-delà de 170 m
      if (d > 170 || (activeCount > target + 3 && d > 60)) { ped.active = false; ped.root.visible = false; activeCount--; continue; }
      const show = d < 120;
      if (show !== ped.vis) { ped.vis = show; ped.root.visible = show; }
      // ombres portées seulement près du joueur (draw calls de la passe d'ombre)
      const sh = d < 30;
      if (show && sh !== ped.shadow) { ped.shadow = sh; ped.root.traverse((o) => { if (o.isSkinnedMesh || o.isMesh) o.castShadow = sh; }); }
      ped.cooldown -= dt;
      if (show) think(ped, dt, d, pp, driver, pv);
      // animation : tous les 3 images au loin
      ped.lodAcc += dt;
      if (show && (d < 55 || frame % 3 === ped.id % 3)) { ped.ch.update(ped.lodAcc); ped.lodAcc = 0; }
    }
  }

  function think(ped, dt, d, pp, driver, pv) {
    switch (ped.state) {
      case 'ko': ped.t -= dt; if (ped.t <= 0) { ped.hp = 25; setState(ped, 'walk'); } return;
      case 'stun': ped.t -= dt; if (ped.t <= 0) { ped.hp = Math.max(ped.hp, 15); setState(ped, 'walk'); } return;
      case 'idle': ped.t -= dt; if (ped.t <= 0) setState(ped, 'walk'); break;
      case 'cheer':
        ped.t -= dt;
        if (stuntAt) faceMove(ped, stuntAt.x - ped.position.x, stuntAt.z - ped.position.z, dt);
        if (ped.t <= 0) setState(ped, 'walk');
        return;
      case 'shelter': {
        const g = ped.goal;
        if (!g) { setState(ped, 'walk'); return; }
        const dx = g.x - ped.position.x, dz = g.z - ped.position.z, dd = Math.hypot(dx, dz);
        if (dd > 0.7 && !ped.arrived) { faceMove(ped, dx, dz, dt, 10); moveBy(ped, (dx / dd) * 3.4 * dt, (dz / dd) * 3.4 * dt); }
        else if (!ped.arrived) { ped.arrived = true; ped.ch.play('Idle_Torch_Loop'); }
        if (dry) { ped.shelterer = rng() < 0.7; ped.goal = null; setState(ped, 'walk'); }
        break;
      }
      case 'call':
        ped.t -= dt; faceMove(ped, pp.x - ped.position.x, pp.z - ped.position.z, dt);
        if (ped.t <= 0) { const cb = ped.callCb; ped.callCb = null; cb?.(); setState(ped, 'flee', 5); } return;
      case 'flee': {
        ped.t -= dt;
        const th = ped.threat ?? pp;
        let fx = ped.position.x - th.x, fz = ped.position.z - th.z; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
        faceMove(ped, fx, fz, dt, 12);
        if (!game.world?.isRoad?.(ped.position.x + fx * 2, ped.position.z + fz * 2) || rng() < 0.02) moveBy(ped, fx * RUN * dt, fz * RUN * dt);
        else moveBy(ped, -fz * RUN * dt, fx * RUN * dt); // longe la route
        if (ped.t <= 0) setState(ped, 'walk');
        return;
      }
      case 'fight': {
        ped.t -= dt;
        const dx = pp.x - ped.position.x, dz = pp.z - ped.position.z, dd = Math.hypot(dx, dz);
        faceMove(ped, dx, dz, dt, 12);
        if (dd > 1.3) moveBy(ped, (dx / dd) * 3.6 * dt, (dz / dd) * 3.6 * dt);
        else {
          ped.ch.play('Punch_Jab');
          if (ped.cooldown <= 0) { ped.cooldown = 1.3; game.combat?.damagePlayer?.(5, 'ped'); }
        }
        if (ped.t <= 0 || dd > 25) setState(ped, 'walk');
        return;
      }
      default: break;
    }
    if (ped.state === 'walk') walk(ped, dt);
    // un véhicule fonce sur le trottoir : on s'écarte en criant
    if ((ped.state === 'walk' || ped.state === 'idle' || ped.state === 'shelter') && fast.length && d < 70) {
      for (const v of fast) {
        const q = v.object3d.position, dx = ped.position.x - q.x, dz = ped.position.z - q.z, dd = Math.hypot(dx, dz);
        if (dd > 9 || dd < 0.01) continue;
        const h = v.heading;
        if ((dx * Math.sin(h) + dz * Math.cos(h)) / dd < 0.45) continue; // ne vient pas vers lui
        if (game.world?.isRoad?.(q.x, q.z)) continue;                      // sur la chaussée : il traverse à ses risques
        ped.threat = { x: q.x, z: q.z }; setState(ped, 'flee', 3 + rng() * 2); say(ped, LINES_CAR);
        return;
      }
    }
    // la pluie : on file se coller à la façade la plus proche
    if (rainy && ped.shelterer && ped.state === 'walk' && shelterBudget > 0 && d < 80) {
      shelterBudget--;
      const g = shelterPoint(ped.position.x, ped.position.z);
      if (g) { ped.goal = g; ped.arrived = false; setState(ped, 'shelter'); if (rng() < 0.3) say(ped, LINES_RAIN); }
      else ped.shelterer = false;
    }
    // réactions au voisinage du joueur
    if (d < 12 && ped.state !== 'flee') {
      if (driver) {
        const dv = nearestVehicle(ped, 2.2);
        if (dv && dv.v === driver && pv > 12) {
          const dir = { x: Math.sin(ped.yaw), z: Math.cos(ped.yaw) };
          if (pv > 28 && dv.d < 1.6) { hitByVehicle(ped, driver, dir); return; }
          ped.threat = { x: pp.x, z: pp.z }; setState(ped, 'flee', 5); say(ped, LINES_FLEE);
        }
      } else if (d < 0.9 && game.player?.state === 'onFoot' && (game.player.velocity?.length?.() ?? 0) > 1 && ped.cooldown <= 0) {
        ped.cooldown = 3; say(ped, LINES_BUMP);
        setState(ped, 'idle', 1.2);
      }
    }
  }

  /** Point devant la façade la plus proche (≤ 45 m), ou null. Boîtes alignées sur les axes seulement. */
  function shelterPoint(x, z) {
    if (!boxes) {
      boxes = [];
      for (const b of game.world?.buildings ?? []) for (const p of b.parts ?? []) {
        if (p.t === 'box' && !p.rot && p.y1 - p.y0 > 4 && p.w > 4 && p.d > 4) boxes.push(p.cx, p.cz, p.w / 2, p.d / 2);
      }
    }
    let best = null, bd = 45;
    for (let i = 0; i < boxes.length; i += 4) {
      const cx = boxes[i], cz = boxes[i + 1], hw = boxes[i + 2], hd = boxes[i + 3];
      const nx = Math.max(cx - hw, Math.min(cx + hw, x)), nz = Math.max(cz - hd, Math.min(cz + hd, z));
      const d = Math.hypot(nx - x, nz - z);
      if (d > 0.3 && d < bd) { bd = d; best = { nx, nz, d }; }
    }
    if (!best) return null;
    const ux = (x - best.nx) / best.d, uz = (z - best.nz) / best.d;
    return { x: best.nx + ux * 0.8, z: best.nz + uz * 0.8 };
  }

  // cascade réussie : les piétons proches applaudissent quelques secondes
  game.bus.on('stunt', ({ position }) => {
    if (!position) return;
    stuntAt = { x: position.x, z: position.z };
    let n = 0;
    for (const ped of peds) {
      if (!ped.active || !ped.vis || (ped.state !== 'walk' && ped.state !== 'idle')) continue;
      if (Math.hypot(ped.position.x - position.x, ped.position.z - position.z) > 40) continue;
      setState(ped, 'cheer', 3.5 + rng() * 2);
      if (n++ === 0) say(ped, LINES_CHEER, true);
    }
  });

  function hitByVehicle(ped, veh, dir) {
    const p = ped.position;
    setState(ped, 'ko', 12);
    ped.hp = 0;
    game.bus.emit('crime', { kind: 'hitPed', severity: 1, position: { x: p.x, y: p.y, z: p.z }, ped });
    void dir; void veh;
  }

  /** Piétons conscients pouvant témoigner à moins de r mètres de p. */
  function witnesses(p, r) {
    const out = [];
    for (const ped of peds) {
      if (!ped.active || ped.isDown || ped.state === 'call' || !ped.vis) continue;
      if (Math.hypot(ped.position.x - p.x, ped.position.z - p.z) < r) out.push(ped);
    }
    return out;
  }

  /** Un témoin passe un appel ; `cb` est appelée après `delay` s s'il n'a pas été mis hors d'état. */
  function startCall(ped, delay, cb) {
    ped.threat = { x: playerPos().x, z: playerPos().z };
    setState(ped, 'call', delay);
    ped.callCb = cb;
  }

  /** Pose un piéton (éjecté d'une voiture, par exemple) qui fuit. */
  function spawnFleeing(p, threat) {
    const ped = peds.find((q) => !q.active) ?? (peds.length ? peds[0] : null);
    if (!ped) return null;
    place(ped, { x: p.x, z: p.z, arc: null });
    ped.vis = true; ped.threat = threat; setState(ped, 'flee', 8);
    return ped;
  }

  return { peds, update, witnesses, startCall, spawnFleeing, hitByVehicle,
    nearby(p, r) { return peds.filter((q) => q.active && q.vis && Math.hypot(q.position.x - p.x, q.position.z - p.z) < r); } };
}
