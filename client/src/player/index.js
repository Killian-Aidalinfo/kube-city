// JOUEUR : contrôleur cinématique Rapier, animations, ragdoll, caméra, invites contextuelles (spec 3.6 et 6).
import * as THREE from 'three';
import { PLAYER as P, clamp, damp, dampAngle, updateStamina, fallDamage, targetSpeed, locomotionKey, locomotionTimeScale } from './logic.js';
import { createCameraRig } from './camera.js';

const FALLBACK_OUTFIT = { skin: '#e0ac8a', hair: '#2b1b14', top: '#d4513f', bottom: '#23283b', shoes: '#f2f2f2' };
const HALF_H = P.height / 2;         // centre de la capsule au-dessus des pieds
const CAPSULE_HALF = HALF_H - P.radius; // demi-hauteur du segment central

/** @param {object} game contexte (spec 3.1) */
export async function install(game) {
  const { scene } = game.three;
  const { world, RAPIER, step } = game.physics;
  const manifest = game.assets.manifest;
  const chars = manifest?.characters?.playable ?? {};
  const suggested = manifest?.animations?.suggested ?? {};

  // ---------- hiérarchie visuelle : root (pieds, cap) > pivot (centre, ragdoll) > modèle ----------
  const root = new THREE.Group();
  root.name = 'player';
  const pivot = new THREE.Group();
  pivot.position.y = HALF_H;
  root.add(pivot);
  scene.add(root);

  // ---------- modèle animé (repli : capsule simple) ----------
  let gltf = null;
  try { gltf = await game.assets.loadGLTF('/assets/' + (manifest?.characters?.model ?? 'animations/ual.glb')); } catch { gltf = null; }
  const clips = new Map((gltf?.animations ?? []).map((c) => [c.name, c]));
  let model = null, mixer = null;
  const actions = new Map();

  function disposeModel() {
    if (!model) return;
    pivot.remove(model);
    model.traverse((o) => { if (o.isSkinnedMesh) { o.geometry?.dispose(); o.material?.dispose?.(); } });
    mixer?.stopAllAction(); actions.clear(); anim.current = null; anim.key = null;
  }
  function buildModel(id) {
    disposeModel();
    const outfit = chars[id]?.outfit ?? FALLBACK_OUTFIT;
    if (gltf) {
      model = game.assets.clone(gltf);
      game.assets.applyOutfit(model, outfit);
      // on ne garde que le mannequin (le glb d'animations peut contenir d'autres nœuds)
      mixer = new THREE.AnimationMixer(model);
    } else {
      model = new THREE.Group();
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(P.radius, P.height - 2 * P.radius, 4, 8), new THREE.MeshStandardMaterial({ color: outfit.top }));
      m.position.y = HALF_H; m.castShadow = true; model.add(m);
      mixer = null;
    }
    model.position.y = -HALF_H;
    pivot.add(model);
  }

  // ---------- animations ----------
  const anim = { current: null, key: null, lock: 0, onDone: null };
  const clipName = (key) => {
    const s = suggested[key];
    const n = Array.isArray(s) ? s[Math.floor(Math.random() * s.length)] : s;
    return clips.has(n) ? n : clips.has(key) ? key : null;
  };
  function actionFor(name) {
    let a = actions.get(name);
    if (!a && mixer && clips.has(name)) { a = mixer.clipAction(clips.get(name)); actions.set(name, a); }
    return a;
  }
  /** Joue une animation (clé du manifest ou nom de clip) avec fondu. Renvoie la durée (s) ou 0. */
  function playAnim(key, { once = false, fade = 0.2, timeScale = 1, lock = false, restart = false } = {}) {
    const name = clipName(key);
    const a = name && actionFor(name);
    if (!a) return 0;
    const same = anim.current === a;
    if (same && !restart) { a.timeScale = timeScale; return a.getClip().duration; }
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    a.timeScale = timeScale;
    a.enabled = true;
    a.setEffectiveWeight(1);
    a.play();
    if (anim.current && anim.current !== a) a.crossFadeFrom(anim.current, fade, false);
    anim.current = a; anim.key = key;
    anim.lock = lock ? a.getClip().duration / Math.abs(timeScale || 1) : 0;
    return a.getClip().duration;
  }

  // ---------- corps physique ----------
  const spawn = game.world?.spawnPoints?.player ?? { x: 0, y: 1, z: 0, rotation: 0 };
  const ground0 = game.world?.groundHeight?.(spawn.x, spawn.z);
  const start = new THREE.Vector3(spawn.x, (typeof spawn.y === 'number' ? spawn.y : (ground0 ?? 0)) + 0.1, spawn.z);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, start.y + HALF_H, start.z));
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(CAPSULE_HALF, P.radius).setFriction(0.1), body);
  const ctrl = world.createCharacterController(0.02);
  ctrl.setUp({ x: 0, y: 1, z: 0 });
  ctrl.enableAutostep(0.4, 0.15, false);           // marches et trottoirs (jamais les voitures)
  ctrl.enableSnapToGround(0.35);
  ctrl.setMaxSlopeClimbAngle(52 * Math.PI / 180);
  ctrl.setMinSlopeSlideAngle(58 * Math.PI / 180);
  ctrl.setSlideEnabled(true);
  ctrl.setApplyImpulsesToDynamicBodies(true);
  ctrl.setCharacterMass(70);

  // ---------- état ----------
  const cur = start.clone(), prev = start.clone();   // pieds, pas physique courant / précédent
  const vel = new THREE.Vector3();
  const st = { stamina: P.staminaMax, delay: 0, exhausted: false };
  const mv = { ix: 0, iy: 0, sprint: false, aim: false, jump: 0 };
  const motion = { grounded: true, coyote: 0, peak: start.y, air: false, landTimer: 0, jumpAnim: 0, inv: 0 };
  let heading = spawn.rotation ?? 0;
  let ragdoll = null;           // { body, t, mid }
  let hidden = false;
  const providers = [];

  /** API publique (spec 3.6). */
  const player = game.player = {
    object3d: root, body, collider, character: 'ines',
    state: 'onFoot', health: 100, armor: 0,
    vehicle: null, position: root.position, velocity: vel,
    heading, speed2d: 0, aiming: false, aimAnim: null, grounded: true,
    prompt: null, camera: null, controlsLocked: false,
    setCharacter(id) {
      if (!chars[id]) id = Object.keys(chars)[0] ?? id;
      player.character = id; buildModel(id);
      if (player.state === 'inVehicle') playAnim('drive');
    },
    teleport(p) {
      const y = typeof p.y === 'number' ? p.y : (game.world?.groundHeight?.(p.x, p.z) ?? 0) + 0.1;
      endRagdoll(false);
      if (player.state === 'ragdoll' || player.state === 'swimming') player.state = 'onFoot';
      player.setPose(p.x, y, p.z, p.rotation);
      vel.set(0, 0, 0); motion.peak = y; motion.air = false;
      player.camera?.setYaw(player.heading);
    },
    /** Place le perso sans collision (entrée/sortie de véhicule, cinématiques). */
    setPose(x, y, z, yaw) {
      cur.set(x, y, z); prev.copy(cur);
      body.setTranslation({ x, y: y + HALF_H, z }, true);
      if (typeof yaw === 'number') { heading = yaw; player.heading = yaw; }
    },
    /** Active/désactive la collision du perso (véhicule, ragdoll). */
    setCollidable(on) { collider.setEnabled(on); },
    setHidden(h) { if (h !== hidden) { hidden = h; root.visible = !h; } },
    playAnim,
    /** Fait réapparaître/relève le perso (santé pleine par défaut). */
    revive(health = 100) {
      player.health = health; player.state = 'onFoot'; vel.set(0, 0, 0); motion.landTimer = 0;
      collider.setEnabled(true); playAnim('idle', { fade: 0.3 });
    },
    applyDamage(n, source) {
      if (n <= 0 || player.state === 'ko') return;
      const toArmor = Math.min(player.armor, n * 0.6);
      player.armor -= toArmor;
      player.health = Math.max(0, player.health - (n - toArmor));
      game.bus.emit('player:damaged', { amount: n, source });
      if (player.health <= 0) knockOut(source);
    },
    /** Projette le perso au sol (percuté, chute) : capsule physique qui roule puis se relève. */
    ragdoll(impulse = { x: 0, y: 3, z: 0 }, damage = 0, source = 'choc') {
      if (player.state === 'ko' || player.state === 'ragdoll') return;
      if (player.state === 'inVehicle') return;
      startRagdoll(impulse);
      if (damage > 0) player.applyDamage(damage, source);
    },
    /** Ajoute un fournisseur d'invite : fn(player) → { id, key, text, priority, onTrigger } | null. Renvoie un retrait. */
    addPromptProvider(fn) { providers.push(fn); return () => { const i = providers.indexOf(fn); if (i >= 0) providers.splice(i, 1); }; },
    /** Endurance (0-100), modifiable par le gameplay. */
    get stamina() { return st.stamina; }, set stamina(v) { st.stamina = v; },
  };
  player.camera = createCameraRig(game, player);
  buildModel('ines');
  playAnim('idle', { fade: 0 });
  root.position.copy(cur);
  root.rotation.y = heading;
  player.camera.setYaw(heading); // caméra derrière le perso

  function knockOut(cause) {
    if (ragdoll) endRagdoll(false);
    player.state = 'ko'; vel.set(0, 0, 0);
    root.rotation.set(0, heading, 0); pivot.quaternion.identity();
    playAnim('ko', { once: true, fade: 0.15 });
    game.bus.emit('player:ko', { cause: typeof cause === 'string' ? cause : (cause?.kind ?? 'inconnue') });
  }

  // ---------- ragdoll ----------
  function startRagdoll(impulse) {
    if (player.state === 'enteringVehicle' || player.state === 'exitingVehicle') return;
    player.state = 'ragdoll';
    const c = cur;
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(c.x, c.y + HALF_H, c.z).setLinearDamping(0.35).setAngularDamping(1.4).setCcdEnabled(true));
    world.createCollider(RAPIER.ColliderDesc.capsule(0.3, 0.3).setFriction(0.9).setRestitution(0.15).setDensity(1.0), b);
    b.setLinvel({ x: impulse.x + vel.x * 0.5, y: impulse.y, z: impulse.z + vel.z * 0.5 }, true);
    b.setAngvel({ x: (Math.random() - 0.5) * 8 + impulse.z * 0.4, y: (Math.random() - 0.5) * 3, z: (Math.random() - 0.5) * 8 - impulse.x * 0.4 }, true);
    collider.setEnabled(false);
    ragdoll = { body: b, t: 0 };
    playAnim('ko', { fade: 0.12 });
  }
  function endRagdoll(standUp) {
    if (!ragdoll) return;
    const t = ragdoll.body.translation();
    const hit = rayDown(t.x, t.y + 0.5, t.z, ragdoll.body);
    world.removeRigidBody(ragdoll.body);
    ragdoll = null;
    root.rotation.set(0, heading, 0); pivot.quaternion.identity();
    if (!standUp) return;
    const gy = hit ?? t.y - 0.6;
    player.setPose(t.x, gy + 0.05, t.z, heading);
    collider.setEnabled(true);
    player.state = 'onFoot'; vel.set(0, 0, 0); motion.peak = gy; motion.air = false; motion.inv = 0.8;
    playAnim('idle', { fade: 0.35 });
  }
  function rayDown(x, y, z, exclude) {
    try {
      const h = world.castRay(new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 }), 4, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, exclude);
      return h ? y - (h.timeOfImpact ?? h.toi) : null;
    } catch { return null; }
  }
  function updateRagdoll(dt) {
    ragdoll.t += dt;
    const b = ragdoll.body, t = b.translation(), q = b.rotation(), lv = b.linvel();
    root.position.set(t.x, t.y - HALF_H, t.z);
    root.rotation.set(0, 0, 0);
    pivot.quaternion.set(q.x, q.y, q.z, q.w);
    cur.set(t.x, t.y - HALF_H, t.z); prev.copy(cur);
    vel.set(lv.x, lv.y, lv.z);
    const slow = Math.hypot(lv.x, lv.y, lv.z) < 0.9;
    if ((ragdoll.t > 1.8 && slow) || ragdoll.t > 4.5) {
      // se relève dans la direction de la dernière vitesse horizontale
      if (Math.hypot(lv.x, lv.z) > 0.2) heading = Math.atan2(lv.x, lv.z);
      player.heading = heading;
      endRagdoll(true);
    }
  }

  // ---------- eau ----------
  function waterLevelAt(x, z) {
    const w = game.world;
    if (!w) return null;
    if (typeof w.waterLevelAt === 'function') { const l = w.waterLevelAt(x, z); return typeof l === 'number' ? l : null; }
    if (typeof w.isWater === 'function' && w.isWater(x, z)) return typeof w.waterLevel === 'number' ? w.waterLevel : 0;
    return null;
  }

  // ---------- déplacement à pied : pas physique fixe ----------
  const QF = RAPIER.QueryFilterFlags;
  function physicsStep(fdt) {
    prev.copy(cur);
    if (player.state !== 'onFoot' && player.state !== 'swimming') {
      if (ragdoll) updateRagdoll(0); // pose cohérente après le pas
      return;
    }
    const playing = game.state === 'playing' && !player.controlsLocked;
    const yawCam = player.camera.yaw;
    const mag = playing ? Math.min(1, Math.hypot(mv.ix, mv.iy)) : 0;
    // direction relative à la caméra
    const fx = Math.sin(yawCam), fz = Math.cos(yawCam), rx = -Math.cos(yawCam), rz = Math.sin(yawCam);
    let dx = fx * mv.iy + rx * mv.ix, dz = fz * mv.iy + rz * mv.ix;
    const dl = Math.hypot(dx, dz);
    if (dl > 0) { dx /= dl; dz /= dl; }
    const swimming = player.state === 'swimming';
    const wl = waterLevelAt(cur.x, cur.z);
    const sprinting = playing && mv.sprint && mag > 0.55 && !st.exhausted && !swimming && !anim.lock;
    updateStamina(st, fdt, { sprinting: sprinting && dl > 0, swimming: swimming && mag > 0.05 });
    let ts = playing ? targetSpeed({ magnitude: mag, sprint: mv.sprint, exhausted: st.exhausted, swimming }) : 0;
    if (anim.lock > 0 && !swimming) ts *= 0.45; // action en cours (coup…) : on ralentit
    if (mv.aim && !swimming) ts = Math.min(ts, P.run * 0.7);
    // accélération douce
    const tvx = dx * ts, tvz = dz * ts;
    const grounded = motion.grounded;
    const accel = ts === 0 ? P.decel : (grounded || swimming ? P.accelGround : P.accelAir);
    const ex = tvx - vel.x, ez = tvz - vel.z, el = Math.hypot(ex, ez);
    if (el > 1e-4) { const k = Math.min(1, accel * fdt / el); vel.x += ex * k; vel.z += ez * k; }
    // vertical
    let desiredY;
    if (swimming) {
      const target = (wl ?? cur.y + 1.1) - 1.15;
      vel.y = clamp((target - cur.y) * 5, -3, 3);
      desiredY = vel.y * fdt;
      motion.peak = cur.y; motion.air = false;
      if (st.stamina <= 0 && game.time && (game.time.elapsed * 2) % 1 < fdt) player.applyDamage(3, 'noyade');
    } else {
      if (grounded) { if (vel.y < 0) vel.y = -1.5; motion.coyote = 0.1; } else motion.coyote -= fdt;
      if (mv.jump > 0) {
        mv.jump -= fdt; // saut « mis en tampon » 0,15 s
        if (playing && (grounded || motion.coyote > 0) && !anim.lock) {
          vel.y = P.jump; motion.coyote = 0; motion.grounded = false; motion.jumpAnim = 0.28; motion.peak = cur.y; mv.jump = 0;
        }
      }
      vel.y = Math.max(-P.terminalFall, vel.y - P.gravity * fdt);
      desiredY = vel.y * fdt;
    }
    ctrl.computeColliderMovement(collider, { x: vel.x * fdt, y: desiredY, z: vel.z * fdt }, QF.EXCLUDE_SENSORS);
    const mvmt = ctrl.computedMovement();
    const wasGrounded = motion.grounded;
    motion.grounded = ctrl.computedGrounded();
    // si on est bloqué horizontalement, la vitesse retombe
    if (Math.abs(mvmt.x) < Math.abs(vel.x * fdt) * 0.3) vel.x *= 0.5;
    if (Math.abs(mvmt.z) < Math.abs(vel.z * fdt) * 0.3) vel.z *= 0.5;
    if (vel.y > 0 && mvmt.y < desiredY * 0.3) vel.y = 0; // plafond
    cur.x += mvmt.x; cur.y += mvmt.y; cur.z += mvmt.z;
    body.setNextKinematicTranslation({ x: cur.x, y: cur.y + HALF_H, z: cur.z });

    // chute : on mémorise le point le plus haut, dégâts à l'atterrissage
    if (!swimming) {
      if (!motion.grounded) { if (!motion.air) { motion.air = true; motion.peak = cur.y; } motion.peak = Math.max(motion.peak, cur.y); }
      else if (motion.air) {
        motion.air = false;
        const drop = motion.peak - cur.y;
        const dmg = fallDamage(drop);
        if (drop > 2.2) motion.landTimer = drop > 5 ? 0.5 : 0.28;
        if (dmg > 0) {
          if (drop > 12) { startRagdoll({ x: vel.x, y: 2, z: vel.z }); }
          player.applyDamage(dmg, 'chute');
        }
      }
    }
    // entrée / sortie de l'eau
    if (wl != null && !swimming && cur.y < wl - 0.9) { player.state = 'swimming'; vel.y = 0; motion.air = false; }
    else if (swimming) {
      const gh = game.world?.groundHeight?.(cur.x, cur.z);
      const shallow = typeof gh === 'number' ? gh > (wl ?? 0) - 1.35 : wl == null;
      if (wl == null || shallow) { player.state = 'onFoot'; vel.y = 0.5; motion.peak = cur.y; }
    }
    // filet de sécurité : tombé sous le monde (sol pas encore construit…) → remonté au sol connu
    const gh0 = game.world?.groundHeight?.(cur.x, cur.z);
    if (cur.y < (typeof gh0 === 'number' ? gh0 : 0) - 8 && player.state === 'onFoot') {
      const fy = typeof gh0 === 'number' ? gh0 + 0.3 : 1;
      player.setPose(cur.x, fy, cur.z); vel.set(0, 0, 0); motion.peak = fy; motion.air = false;
    }
    // cap
    const sp2 = Math.hypot(vel.x, vel.z);
    if (mv.aim && !swimming && playing) heading = dampAngle(heading, yawCam, 16, fdt);
    else if (sp2 > 0.5) heading = dampAngle(heading, Math.atan2(vel.x, vel.z), 12, fdt);
    player.speed2d = sp2;
    player.grounded = motion.grounded;
    void wasGrounded;
  }
  step.preStep.push(physicsStep);

  // ---------- image : entrées, visuel, animations, invites ----------
  game.onUpdate((dt) => {
    const playing = game.state === 'playing' && !player.controlsLocked;
    mv.ix = playing ? game.input.axis('moveX') : 0;
    mv.iy = playing ? game.input.axis('moveY') : 0;
    mv.sprint = game.input.isDown('sprint');
    mv.aim = playing && game.input.isDown('aim') && player.state === 'onFoot';
    if (playing && game.input.pressed('jump') && player.state !== 'inVehicle') mv.jump = 0.15;
    player.aiming = mv.aim;
    player.heading = heading;
    player.stamina = st.stamina;
    if (player.state === 'ko' && player.health > 0) player.revive(player.health);

    mixer?.update(dt);
    if (anim.lock > 0) anim.lock -= dt;
    if (motion.landTimer > 0) motion.landTimer -= dt;
    if (motion.jumpAnim > 0) motion.jumpAnim -= dt;
    if (motion.inv > 0) motion.inv -= dt;

    switch (player.state) {
      case 'ragdoll': if (ragdoll) updateRagdoll(dt); break;
      case 'onFoot': case 'swimming': {
        const a = clamp(game.physics.step.alpha ?? 1, 0, 1);
        root.position.set(prev.x + (cur.x - prev.x) * a, prev.y + (cur.y - prev.y) * a, prev.z + (cur.z - prev.z) * a);
        root.rotation.set(0, heading, 0); pivot.quaternion.identity();
        footAnimation();
        break;
      }
      case 'enteringVehicle': case 'exitingVehicle':
        root.position.copy(cur); root.rotation.set(0, heading, 0); pivot.quaternion.identity(); break;
      default: break; // ko, en véhicule : pose gérée ailleurs (véhicules, animation)
    }
    updatePrompt();
    if (playing && game.input.pressed('interact') && player.prompt?.onTrigger) player.prompt.onTrigger(player);
  }, 5);
  // la caméra suit après toutes les autres mises à jour de pose (ordre 90, spec 3.1)
  game.onUpdate((dt) => player.camera.update(dt), 90);

  function footAnimation() {
    if (anim.lock > 0) return;
    const sp = player.speed2d;
    if (player.state === 'swimming') { playAnim(sp > 0.5 ? 'swim' : 'swimIdle', { timeScale: 1 }); return; }
    if (!motion.grounded) {
      if (motion.jumpAnim > 0) playAnim('jumpStart', { once: true, fade: 0.08 });
      else if (vel.y < -2 || motion.jumpAnim <= 0) playAnim('jumpLoop', { fade: 0.15 });
      return;
    }
    if (motion.landTimer > 0) { playAnim('land', { once: true, fade: 0.08 }); return; }
    if (mv.aim && player.aimAnim && sp < 0.4) { playAnim(player.aimAnim, { fade: 0.15 }); return; }
    const key = locomotionKey(sp);
    const clip = key === 'idle' ? 'idle' : key;
    playAnim(clip, { timeScale: locomotionTimeScale(key, sp), fade: key === 'idle' ? 0.25 : 0.18 });
  }

  // ---------- invites contextuelles ----------
  let lastPromptKey = null;
  function updatePrompt() {
    let best = null;
    if (player.state === 'onFoot') {
      for (const f of providers) {
        let p = null;
        try { p = f(player); } catch { p = null; }
        if (p && (!best || (p.priority ?? 0) > (best.priority ?? 0))) best = p;
      }
    }
    player.prompt = best;
    const k = best ? best.key + best.text : null;
    if (k !== lastPromptKey) {
      lastPromptKey = k;
      game.bus.emit('player:prompt', best ? { id: best.id, key: best.key, text: best.text } : null);
    }
  }

  // ---------- réapparition ----------
  game.bus.on('player:respawn', ({ where } = {}) => {
    const places = game.world?.places ?? {};
    const keys = where === 'commissariat' ? ['commissariat', 'police'] : ['hopital', 'hôpital', 'hospital'];
    const pl = keys.map((k) => places[k]).find(Boolean);
    if (pl?.position) player.teleport(pl.position);
    player.revive(100);
  });

  game.bus.emit('player:spawned', { character: player.character });
}
