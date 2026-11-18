// Combat non létal (spec 10) : corps à corps, esquive, roue d'armes avec ralenti, taser, paintball, santé/armure.
import * as THREE from 'three';
import { WEAPONS, WEAPON_ORDER, PAINT_COLORS, MAX_HEALTH, COMBO_WINDOW, comboNext, splitDamage, regen, stepBallistic, wheelSector, distToSegment, inCone } from './logic.js';
import { createCombatUI } from './wheel.js';

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** @param {object} game contexte (spec 3.1) */
export function install(game) {
  const { scene, camera } = game.three;
  const ui = createCombatUI();
  const ammo = { paintball: WEAPONS.paintball.ammo };
  const cd = { poings: 0, batte: 0, taser: 0, paintball: 0 };
  let weapon = 'poings', combo = { index: -1, last: -99 };
  let aiming = false, wheelOpen = false, wheelVec = { x: 0, y: 0 }, wheelSel = -1, scale = 1;
  let sinceDamage = 99, ko = false, dodgeT = 0, dodgeCd = 0, dodgeDir = v3(), colorIdx = 0, copAimAt = -99, lockedTarget = null;
  const pending = [];      // coups différés : { t, fn }
  const props = {};        // accessoires procéduraux par arme
  let propHost = null;
  const dodgePressed = { v: false };

  const player = () => game.player;
  const pPos = () => game.player?.position ?? v3();
  const isOnFoot = () => (game.player?.state ?? 'onFoot') === 'onFoot';

  function playerDir(out = v3()) {
    const o = player()?.object3d;
    if (o) { o.getWorldDirection(out); out.y = 0; if (out.lengthSq() > 1e-6) return out.normalize(); }
    camera.getWorldDirection(out); out.y = 0; return out.normalize();
  }

  /** Cibles possibles : piétons et policiers à pied (tout objet exposant position, isDown, receiveHit). */
  function targets(p, r) {
    const out = [...(game.npc?.nearby?.(p, r) ?? [])];
    for (const c of game.police?.footUnits ?? []) if (Math.hypot(c.position.x - p.x, c.position.z - p.z) < r) out.push(c);
    return out;
  }

  // ---------- santé / armure ----------
  function damagePlayer(amount, source = 'inconnu') {
    const pl = player(); if (!pl || ko || dodgeT > 0 || amount <= 0) return 0;
    const r = splitDamage(pl.health ?? MAX_HEALTH, pl.armor ?? 0, amount);
    pl.health = r.health; pl.armor = r.armor;
    sinceDamage = 0;
    game.bus.emit('player:damaged', { amount: r.taken, source });
    if (pl.health <= 0) {
      ko = true; pl.health = 0;
      if (typeof pl.knockOut === 'function') pl.knockOut(source); else pl.state = 'ko';
      game.bus.emit('player:ko', { cause: source });
    }
    return r.taken;
  }
  // Les autres modules (chute, voiture…) passent par player.applyDamage : on les centralise ici.
  if (game.player) game.player.applyDamage = (n, source) => damagePlayer(n, source);
  game.bus.on('player:respawn', () => {
    ko = false; sinceDamage = 99;
    const pl = player(); if (pl) { pl.health = MAX_HEALTH; if (pl.state === 'ko') pl.state = 'onFoot'; }
  });

  // ---------- coups ----------
  function playClip(clip) {
    const pl = player();
    if (typeof pl?.playAction === 'function') pl.playAction(clip); else if (typeof pl?.playAnimation === 'function') pl.playAnimation(clip);
  }

  function crimeFor(t, severity = 1) {
    const p = t.position;
    game.bus.emit('crime', { kind: t.kind === 'cop' ? 'shootCop' : 'assault', severity: t.kind === 'cop' ? 0.8 : severity, position: { x: p.x, y: p.y, z: p.z } });
  }

  function melee(mult, push, kind) {
    const o = pPos(), d = playerDir(), def = WEAPONS[weapon];
    let hit = false;
    for (const t of targets(o, def.range + 1)) {
      if (t.isDown || !inCone(o, d, t.position, def.range)) continue;
      const dir = { x: d.x * push, z: d.z * push };
      if (t.receiveHit({ amount: def.damage * mult, kind, from: { x: o.x, z: o.z }, dir, source: 'player' })) { hit = true; crimeFor(t); }
    }
    if (hit) { ui.hitMarker(); game.bus.emit('combat:hit', { weapon, kind }); }
    return hit;
  }

  function attackMelee(now) {
    if (weapon === 'poings') {
      const r = comboNext(combo, now); combo = r.state;
      const s = r.step;
      playClip(s.clip);
      game.bus.emit('combat:attack', { weapon, kind: s.kind, combo: combo.index, clip: s.clip });
      pending.push({ t: 0.16, fn: () => melee(s.mult, s.push, s.kind) });
      cd.poings = s.kind === 'kick' ? 0.55 : WEAPONS.poings.cooldown;
    } else {
      playClip('Sword_Attack');
      game.bus.emit('combat:attack', { weapon, kind: 'bat', clip: 'Sword_Attack' });
      pending.push({ t: 0.22, fn: () => melee(1, 1.6, 'bat') });
      cd.batte = WEAPONS.batte.cooldown;
    }
  }

  // ---------- visée ----------
  const ray = { o: v3(), d: v3() };
  function aimPoint(maxD = 80) {
    camera.getWorldDirection(ray.d);
    ray.o.copy(camera.position);
    // verrouillage doux (manette) : cible la plus proche du réticule
    lockedTarget = null;
    if (!game.input?.pointerLocked) {
      let best = 0.12;
      for (const t of targets(pPos(), 40)) {
        if (t.isDown) continue;
        const to = v3(t.position.x, t.position.y + 1.1, t.position.z).sub(ray.o), l = to.length();
        const ang = Math.acos(Math.min(1, to.normalize().dot(ray.d)));
        if (l > 3 && ang < best) { best = ang; lockedTarget = t; }
      }
      if (lockedTarget) return v3(lockedTarget.position.x, lockedTarget.position.y + 1.1, lockedTarget.position.z);
    }
    const start = ray.o.clone().addScaledVector(ray.d, 3.5); // saute le joueur derrière la caméra
    const hit = castRay(start, ray.d, maxD);
    return hit ? hit.point : start.clone().addScaledVector(ray.d, maxD);
  }

  function castRay(o, d, maxD) {
    const { world, RAPIER } = game.physics;
    try {
      const r = new RAPIER.Ray({ x: o.x, y: o.y, z: o.z }, { x: d.x, y: d.y, z: d.z });
      const ex = game.player?.vehicle?.chassis ?? game.player?.body ?? undefined;
      const h = world.castRayAndGetNormal(r, maxD, true, undefined, undefined, undefined, ex);
      if (!h) return null;
      const toi = h.timeOfImpact ?? h.toi;
      return { point: v3(o.x + d.x * toi, o.y + d.y * toi, o.z + d.z * toi), normal: v3(h.normal.x, h.normal.y, h.normal.z), toi };
    } catch { return null; }
  }

  function muzzle() {
    const p = pPos(), d = playerDir();
    return v3(p.x + d.x * 0.6 - d.z * 0.25, p.y + (p.y < 0.5 ? 1.45 : 0.6), p.z + d.z * 0.6 + d.x * 0.25);
  }

  // ---------- taser ----------
  const arcs = [];
  function fireTaser() {
    const from = muzzle(), to = aimPoint(WEAPONS.taser.range * 2);
    const dir = to.clone().sub(from).normalize();
    const end = from.clone().addScaledVector(dir, WEAPONS.taser.range);
    let best = null, bd = 0.8;
    for (const t of targets(from, WEAPONS.taser.range + 2)) {
      if (t.isDown) continue;
      const c = { x: t.position.x, y: t.position.y + 0.9, z: t.position.z };
      const r = distToSegment(c, from, end);
      if (r.d < bd) { bd = r.d; best = t; }
    }
    if (best) {
      end.set(best.position.x, best.position.y + 1, best.position.z);
      best.receiveHit({ amount: 0, kind: 'taser', from: { x: from.x, z: from.z }, source: 'player' });
      crimeFor(best, 1); ui.hitMarker();
    }
    // éclair visuel court
    const pts = []; const n = 8;
    for (let i = 0; i <= n; i++) { const k = i / n; pts.push(from.clone().lerp(end, k).add(i && i < n ? v3((Math.random() - .5) * .3, (Math.random() - .5) * .3, (Math.random() - .5) * .3) : v3())); }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x9fd8ff }));
    scene.add(line); arcs.push({ line, t: 0.14 });
    playClip('Pistol_Shoot');
    game.bus.emit('combat:attack', { weapon: 'taser', kind: 'taser', clip: 'Pistol_Shoot' });
    cd.taser = WEAPONS.taser.cooldown;
  }

  // ---------- paintball : projectiles balistiques + taches ----------
  const shots = [];
  const splats = [];
  const SPLAT_MAX = 70;
  const ballGeo = new THREE.SphereGeometry(0.09, 8, 6);
  const splatGeo = new THREE.CircleGeometry(0.5, 14);

  function firePaint() {
    if ((ammo.paintball ?? 0) < 1) return;
    ammo.paintball--;
    const from = muzzle(), to = aimPoint(70);
    const dir = to.clone().sub(from).normalize();
    const color = PAINT_COLORS[colorIdx++ % PAINT_COLORS.length];
    const mesh = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color }));
    mesh.position.copy(from); scene.add(mesh);
    shots.push({ mesh, p: from.clone(), v: dir.multiplyScalar(42), life: 3, color });
    playClip('Pistol_Shoot');
    game.bus.emit('combat:attack', { weapon: 'paintball', kind: 'paint', clip: 'Pistol_Shoot' });
    cd.paintball = WEAPONS.paintball.cooldown;
  }

  function splat(point, normal, color) {
    let m;
    if (splats.length >= SPLAT_MAX) { m = splats.shift(); m.material.color.set(color); }
    else { m = new THREE.Mesh(splatGeo, new THREE.MeshBasicMaterial({ color, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false, transparent: true, opacity: 0.92 })); scene.add(m); }
    splats.push(m);
    m.position.copy(point).addScaledVector(normal, 0.03);
    m.quaternion.setFromUnitVectors(v3(0, 0, 1), normal);
    m.rotateZ(Math.random() * 6.28);
    const s = 0.5 + Math.random() * 0.5; m.scale.set(s * (0.8 + Math.random() * 0.5), s, 1);
  }

  function updateShots(dt) {
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i], prev = s.p.clone();
      stepBallistic(s.p, s.v, dt);
      s.life -= dt;
      let done = s.life <= 0;
      // cibles vivantes
      for (const t of targets(s.p, 6)) {
        const c = { x: t.position.x, y: t.position.y + 0.9, z: t.position.z };
        if (distToSegment(c, prev, s.p).d < 0.6) {
          t.receiveHit({ amount: 0, kind: 'paint', color: s.color, from: { x: prev.x, z: prev.z }, source: 'player' });
          crimeFor(t, 0.6); ui.hitMarker(); done = true; break;
        }
      }
      if (!done) {
        const seg = s.p.clone().sub(prev), l = seg.length();
        if (l > 1e-4) {
          const h = castRay(prev, seg.clone().divideScalar(l), l);
          if (h) { splat(h.point, h.normal, s.color); done = true; }
        }
        const gy = game.world?.groundHeight?.(s.p.x, s.p.z) ?? 0;
        if (!done && s.p.y <= gy + 0.02) { splat(v3(s.p.x, gy, s.p.z), v3(0, 1, 0), s.color); done = true; }
      }
      s.mesh.position.copy(s.p);
      if (done) { s.mesh.removeFromParent(); s.mesh.material.dispose(); shots.splice(i, 1); }
    }
  }

  // ---------- accessoires tenus en main ----------
  function buildProps() {
    const foam = new THREE.MeshStandardMaterial({ color: 0xf5c518 }), dark = new THREE.MeshStandardMaterial({ color: 0x2b3245 }), neon = new THREE.MeshStandardMaterial({ color: 0xff4fa3, emissive: 0x551133 });
    const bat = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, 0.85, 10), foam); bat.position.set(0, 0.28, 0.05);
    const taser = new THREE.Group(); const tb = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.22), dark); const tt = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.08), new THREE.MeshBasicMaterial({ color: 0x7df9ff })); tt.position.z = 0.14; taser.add(tb, tt);
    const gun = new THREE.Group(); const gb = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.35), dark); const gt = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), neon); gt.position.set(0, 0.1, -0.02); const gm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8), dark); gm.rotation.x = Math.PI / 2; gm.position.z = 0.25; gun.add(gb, gt, gm);
    props.batte = bat; props.taser = taser; props.paintball = gun;
    for (const k of Object.keys(props)) { props[k].visible = false; props[k].traverse((o) => { o.castShadow = true; }); }
  }
  buildProps();

  function syncProps() {
    const obj = player()?.object3d;
    if (!obj) return;
    if (propHost !== obj) {
      propHost = obj;
      let hand = null;
      obj.traverse((o) => { if (!hand && o.isBone && /hand[._-]?r$/i.test(o.name)) hand = o; });
      const host = hand ?? obj;
      for (const k of Object.keys(props)) {
        host.add(props[k]);
        props[k].position.set(hand ? 0 : 0.3, hand ? 0.05 : 1, hand ? 0 : 0.3);
        if (hand) props[k].scale.setScalar(1 / (hand.getWorldScale(v3()).x || 1));
      }
      props.batte.position.y = hand ? 0.2 : 1.2;
    }
    for (const k of Object.keys(props)) props[k].visible = k === weapon && isOnFoot() && !ko;
  }

  // ---------- esquive ----------
  function startDodge() {
    if (dodgeCd > 0 || !isOnFoot() || ko) return;
    camera.getWorldDirection(ray.d); const f = v3(ray.d.x, 0, ray.d.z).normalize(), r = v3(-f.z, 0, f.x);
    const inp = game.input;
    const d = v3();
    if (inp.isDown('left')) d.addScaledVector(r, -1);
    if (inp.isDown('right')) d.addScaledVector(r, 1);
    if (inp.isDown('back')) d.addScaledVector(f, -1);
    if (inp.isDown('forward')) d.addScaledVector(f, 1);
    if (d.lengthSq() < 0.01) d.copy(playerDir()).negate();
    dodgeDir.copy(d.normalize()); dodgeT = 0.4; dodgeCd = 0.9;
    playClip('Roll');
    game.bus.emit('combat:dodge', { dir: { x: d.x, z: d.z } });
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyC') dodgePressed.v = true;
      const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (n >= 0 && game.state === 'playing') combat.setWeapon(WEAPON_ORDER[n]);
    });
    window.addEventListener('wheel', (e) => {
      if (game.state !== 'playing' || wheelOpen) return;
      const i = WEAPON_ORDER.indexOf(weapon);
      combat.setWeapon(WEAPON_ORDER[(i + (e.deltaY > 0 ? 1 : WEAPON_ORDER.length - 1)) % WEAPON_ORDER.length]);
    }, { passive: true });
  }

  // ---------- boucle ----------
  function update(realDt) {
    const inp = game.input, pl = player();
    const now = game.time.elapsed;
    if (!pl) return;
    const active = game.state === 'playing';
    // roue d'armes + ralenti
    const wantWheel = active && inp.isDown('weaponWheel') && !ko;
    if (wantWheel && !wheelOpen) { wheelOpen = true; wheelVec = { x: 0, y: 0 }; wheelSel = -1; game.bus.emit('combat:wheel', { open: true }); }
    if (wheelOpen) {
      wheelVec.x += (inp.axis('lookX') || 0) * 8; wheelVec.y += (inp.axis('lookY') || 0) * 8;
      const l = Math.hypot(wheelVec.x, wheelVec.y); if (l > 1.2) { wheelVec.x *= 1.2 / l; wheelVec.y *= 1.2 / l; }
      wheelSel = wheelSector(wheelVec.x, wheelVec.y, WEAPON_ORDER.length);
      ui.show(wheelSel);
      if (!wantWheel) {
        wheelOpen = false; ui.hide();
        if (wheelSel >= 0) combat.setWeapon(WEAPON_ORDER[wheelSel]);
        game.bus.emit('combat:wheel', { open: false });
      }
    }
    const goal = wheelOpen ? 0.2 : 1;
    scale += (goal - scale) * Math.min(1, realDt * 10);
    if (game.state === 'playing' || scale < 0.99) game.time.scale = Math.abs(scale - 1) < 0.01 ? 1 : scale;
    const dt = realDt * (game.time.scale ?? 1);

    for (const k in cd) cd[k] = Math.max(0, cd[k] - dt);
    dodgeCd = Math.max(0, dodgeCd - dt);
    for (let i = pending.length - 1; i >= 0; i--) { pending[i].t -= dt; if (pending[i].t <= 0) { pending.splice(i, 1)[0].fn(); } }
    for (let i = arcs.length - 1; i >= 0; i--) { arcs[i].t -= dt; if (arcs[i].t <= 0) { arcs[i].line.removeFromParent(); arcs[i].line.geometry.dispose(); arcs.splice(i, 1); } }
    updateShots(dt);
    if (ammo.paintball < WEAPONS.paintball.ammo) ammo.paintball = Math.min(WEAPONS.paintball.ammo, ammo.paintball + dt * 1.2);

    // santé : régénération hors combat
    sinceDamage += dt;
    if (!ko && pl.health != null) pl.health = regen(pl.health, dt, sinceDamage);

    syncProps();
    const canAct = active && isOnFoot() && !ko && !wheelOpen;

    // visée à l'épaule
    const wantAim = canAct && inp.isDown('aim');
    if (wantAim !== aiming) {
      aiming = wantAim;
      ui.reticle(aiming);
      pl.setAiming?.(aiming);
      game.bus.emit('combat:aim', { aiming });
    }
    if (aiming) {
      // viser un policier = crime grave
      if (now - copAimAt > 6 && (game.police?.footUnits?.length || game.police?.units?.length)) {
        camera.getWorldDirection(ray.d);
        const a = camera.position, b = a.clone().addScaledVector(ray.d, 35);
        const cops = [...(game.police.footUnits ?? []).map((c) => c.position), ...(game.police.units ?? []).map((u) => u.veh?.object3d?.position)].filter(Boolean);
        for (const c of cops) if (distToSegment({ x: c.x, y: c.y + 1, z: c.z }, a, b).d < 1.6) {
          copAimAt = now; game.bus.emit('crime', { kind: 'shootCop', severity: 0.4, position: { x: c.x, y: c.y, z: c.z } }); break;
        }
      }
    }

    // esquive
    if (dodgePressed.v) { dodgePressed.v = false; if (canAct) startDodge(); }
    if (dodgeT > 0) {
      dodgeT -= dt;
      const sp = 9 * dt, p = pPos();
      if (typeof pl.dash === 'function') { if (dodgeT + dt >= 0.4) pl.dash(dodgeDir, 3.6, 0.4); }
      else pl.teleport?.({ x: p.x + dodgeDir.x * sp, y: p.y, z: p.z + dodgeDir.z * sp });
    }

    // attaques
    if (canAct && dodgeT <= 0) {
      const def = WEAPONS[weapon];
      if (weapon === 'paintball') { if (inp.isDown('attack') && cd.paintball <= 0 && (aiming || true)) firePaint(); }
      else if (inp.pressed('attack') && cd[weapon] <= 0) {
        if (weapon === 'taser') fireTaser(); else attackMelee(now);
      }
      void def;
    }
  }

  const combat = game.combat = {
    weapons: [...WEAPON_ORDER],
    /** Fiches des armes : { id, label, cooldown, range, damage, icon }. */
    defs: WEAPONS,
    /** Munitions restantes (paintball). */
    ammo,
    /** Temps de recharge restant (s) par arme. */
    cooldowns: cd,
    get current() { return weapon; },
    get weapon() { return weapon; },
    set weapon(id) { combat.setWeapon(id); },
    get aiming() { return aiming; },
    get wheelOpen() { return wheelOpen; },
    get dodging() { return dodgeT > 0; },
    get lockedTarget() { return lockedTarget; },
    get ko() { return ko; },
    setWeapon(id) {
      if (!WEAPONS[id] || id === weapon) return;
      const previous = weapon; weapon = id; combo = { index: -1, last: -99 };
      game.bus.emit('combat:weapon', { weapon: id, previous });
    },
    /** Inflige un coup à une cible (piéton, policier) ; renvoie vrai si pris en compte. */
    hit(target, amount, source = 'player', kind = 'punch') {
      if (!target?.receiveHit) return false;
      const ok = target.receiveHit({ amount, kind, from: { x: pPos().x, z: pPos().z }, source });
      if (ok) crimeFor(target);
      return ok;
    },
    damagePlayer,
    heal(n) { const pl = player(); if (pl && !ko) pl.health = Math.min(MAX_HEALTH, (pl.health ?? 0) + n); },
    /** Armure achetée en boutique (0..100). */
    giveArmor(n = 100) { const pl = player(); if (pl) pl.armor = Math.min(100, (pl.armor ?? 0) + n); },
    targets,
    COMBO_WINDOW,
  };
  game.onUpdate(update, 12);
}
