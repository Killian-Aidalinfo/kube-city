// Physique d'un véhicule : châssis Rapier + DynamicRayCastVehicleController, réglages « arcade ».
// Aucune dépendance à three : testable sous node. Repère : l'avant est +Z, la gauche est +X.
import { steerLimit, engineForce, rpmFor } from './tuning.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** Rotation d'un vecteur par un quaternion Rapier {x,y,z,w}. */
function rot(q, x, y, z) {
  const tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
  return { x: x + q.w * tx + (q.y * tz - q.z * ty), y: y + q.w * ty + (q.z * tx - q.x * tz), z: z + q.w * tz + (q.x * ty - q.y * tx) };
}
export const quatY = (yaw) => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });

/**
 * Géométrie d'un véhicule en mètres à partir de la taille du modèle (unités modèle) et de ses roues.
 * @param {{size:number[], wheelPositions?:object}} m entrée du manifest
 * @param {number} scale échelle du modèle (1.4)
 */
export function buildGeometry(m, scale = 1.4) {
  const size = m?.size ?? [1.5, 1.15, 2.55];
  const wp = m?.wheelPositions ?? {
    'wheel-front-left': [0.3, 0.3, 0.66], 'wheel-front-right': [-0.3, 0.3, 0.66],
    'wheel-back-left': [0.3, 0.3, -0.66], 'wheel-back-right': [-0.3, 0.3, -0.66],
  };
  const radius = (m?.wheelRadius ?? 0.3) * scale;
  const H0 = radius + 0.2;                 // hauteur de l'origine du châssis au repos
  const wheels = [];
  for (const [name, p] of Object.entries(wp)) {
    const mm = /^wheel-(front|back)-(left|right)$/.exec(name);
    if (!mm) continue;
    const sx = mm[2] === 'left' ? 1 : -1;
    // le centre visuel de la roue est décalé vers l'extérieur par rapport au nœud
    wheels.push({ name, front: mm[1] === 'front', left: sx > 0, x: sx * (Math.abs(p[0]) + 0.125) * scale, y: p[1] * scale - H0, z: p[2] * scale });
  }
  const hx = size[0] * scale / 2 * 0.94, hz = size[2] * scale / 2 * 0.97;
  const top = size[1] * scale * 0.93, bottom = 0.34;
  return { size, scale, radius, H0, wheels, halfW: hx, halfL: hz, hy: (top - bottom) / 2, cy: (top + bottom) / 2 - H0, rest: 0.32 };
}

/**
 * Crée le châssis, le collider et le contrôleur de roues.
 * @returns le « corps physique » du véhicule (pv)
 */
export function createPhysicsVehicle(RAPIER, world, spec, geom, pos, yaw = 0) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(pos.x, pos.y + geom.H0, pos.z).setRotation(quatY(yaw))
    .setLinearDamping(0.04).setAngularDamping(1.6).setCanSleep(true).setCcdEnabled(true));
  const m = spec.mass, w = geom.halfW * 2, h = geom.hy * 2, l = geom.halfL * 2;
  const k = 0.75; // moment d'inertie réduit : plus nerveux
  const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(geom.halfW, geom.hy, geom.halfL)
    .setTranslation(0, geom.cy, 0).setFriction(0.25).setRestitution(0.12)
    .setMassProperties(m, { x: 0, y: -0.25 - geom.cy, z: 0 }, // centre de gravité bas (stabilité)
      { x: m / 12 * (h * h + l * l) * k, y: m / 12 * (w * w + l * l) * k, z: m / 12 * (w * w + h * h) * k }, { x: 0, y: 0, z: 0, w: 1 }), body);
  const ctrl = world.createVehicleController(body);
  for (const wh of geom.wheels) {
    ctrl.addWheel({ x: wh.x, y: wh.y + geom.rest, z: wh.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, geom.rest, geom.radius);
  }
  const n = geom.wheels.length;
  for (let i = 0; i < n; i++) {
    ctrl.setWheelSuspensionStiffness(i, 30 + m / 140);
    ctrl.setWheelSuspensionCompression(i, 2.6);
    ctrl.setWheelSuspensionRelaxation(i, 3.0);
    ctrl.setWheelMaxSuspensionTravel(i, 0.3);
    ctrl.setWheelMaxSuspensionForce(i, m * 9.81 * 2.2 / n * 2);
    ctrl.setWheelFrictionSlip(i, 3.2 * spec.grip);
    ctrl.setWheelSideFrictionStiffness(i, 1.2);
  }
  return {
    body, collider, ctrl, spec, geom, n,
    steer: 0, steerVis: 0, spin: geom.wheels.map(() => 0), suspLen: geom.wheels.map(() => geom.rest),
    out: { forwardSpeed: 0, lateral: 0, speed: 0, kmh: 0, skid: 0, rpm: 0.2, grounded: false, up: 1, braking: false },
    flipT: 0, lastV: { x: 0, y: 0, z: 0 },
  };
}

/**
 * Un pas de simulation (à appeler avant world.step). controls : { throttle -1..1, brake 0..1, steer -1..1 (+1 = droite), handbrake }.
 * @param {number} wet 0..1 route mouillée (réduit l'adhérence)
 */
export function driveStep(pv, controls, dt, wet = 0) {
  const { body, ctrl, spec, geom, n, out } = pv;
  const q = body.rotation(), lv = body.linvel(), av = body.angvel();
  const f = rot(q, 0, 0, 1), r = rot(q, -1, 0, 0), up = rot(q, 0, 1, 0);
  const vF = lv.x * f.x + lv.z * f.z + lv.y * f.y, vR = lv.x * r.x + lv.z * r.z + lv.y * r.y;
  const speed = Math.hypot(lv.x, lv.z);
  let contacts = 0;
  for (let i = 0; i < n; i++) if (ctrl.wheelIsInContact(i)) contacts++;
  const grounded = contacts >= 2;

  let thr = clamp(controls.throttle ?? 0, -1, 1), brake = clamp(controls.brake ?? 0, 0, 1);
  const hb = !!controls.handbrake;
  // appuyer dans le sens opposé au mouvement = freiner d'abord
  if ((thr > 0 && vF < -1.5) || (thr < 0 && vF > 1.5)) { brake = Math.max(brake, Math.abs(thr)); thr = 0; }
  const grip = spec.grip * (1 - 0.28 * clamp(wet, 0, 1));

  // direction : braquage lissé, plus étroit à haute vitesse
  const steerIn = clamp(controls.steer ?? 0, -1, 1);
  const target = steerIn * steerLimit(spec.steer, speed);
  const rate = Math.abs(target) > Math.abs(pv.steer) ? 7 : 11;
  pv.steer += (target - pv.steer) * Math.min(1, rate * dt);
  // moteur
  const eng = engineForce(spec, thr, vF);
  const driven = spec.drive === 'awd' ? n : n / 2;
  for (let i = 0; i < n; i++) {
    const w = geom.wheels[i];
    const isDriven = spec.drive === 'awd' || (spec.drive === 'fwd' ? w.front : !w.front);
    ctrl.setWheelEngineForce(i, isDriven ? eng / driven : 0);
    // freins : à fond au frein, léger frein moteur au repos, frein à main sur l'arrière
    let b = brake * spec.mass * 0.38 / n * 4;
    if (thr === 0 && brake === 0) b = spec.mass * 0.03 + (speed < 1.2 ? spec.mass * 0.4 : 0);
    if (hb && !w.front) b = spec.mass * 3;
    ctrl.setWheelBrake(i, b);
    ctrl.setWheelSteering(i, w.front ? -pv.steer : 0);
    const slip = 3.2 * grip * (hb && !w.front ? 0.32 : 1);
    ctrl.setWheelFrictionSlip(i, slip);
  }
  ctrl.updateVehicle(dt);

  // --- aides arcade ---
  if (grounded) {
    // adhérence latérale : on annule une part du glissement (moins en frein à main = dérapage)
    const k = Math.min(1, (hb ? 0.9 : 7.5) * grip * dt);
    const imp = -vR * spec.mass * k * (hb ? 0.5 : 1);
    body.applyImpulse({ x: r.x * imp, y: r.y * imp, z: r.z * imp }, true);
    // frein à main : l'arrière décroche, l'avant mord, la voiture pivote dans le sens du volant
    if (hb && speed > 5) {
      const t = steerIn * clamp(speed / 14, 0, 1) * spec.mass * 1.1 * dt;
      body.applyTorqueImpulse({ x: 0, y: -t * (vF >= 0 ? 1 : -1), z: 0 }, true);
    }
    // appui aérodynamique (tient la route à haute vitesse)
    body.applyImpulse({ x: 0, y: -speed * speed * spec.mass * 0.0016 * dt, z: 0 }, true);
  } else {
    // en l'air : amortit les rotations pour retomber à peu près sur les roues
    const d = Math.max(0, 1 - 1.2 * dt);
    body.setAngvel({ x: av.x * d, y: av.y * d, z: av.z * d }, true);
  }
  // anti-roulis : freine la rotation autour de l'axe longitudinal
  const roll = av.x * f.x + av.y * f.y + av.z * f.z;
  body.applyTorqueImpulse({ x: -f.x * roll * spec.mass * 0.18 * dt, y: -f.y * roll * spec.mass * 0.18 * dt, z: -f.z * roll * spec.mass * 0.18 * dt }, true);

  // --- sorties ---
  for (let i = 0; i < n; i++) {
    pv.suspLen[i] = ctrl.wheelSuspensionLength(i) ?? geom.rest;
    const w = geom.wheels[i];
    const locked = hb && !w.front && Math.abs(vF) > 1;
    if (!locked) pv.spin[i] += (vF / geom.radius) * dt;
  }
  pv.steerVis = pv.steer;
  out.forwardSpeed = vF; out.lateral = vR; out.speed = speed; out.kmh = Math.hypot(lv.x, lv.y, lv.z) * 3.6;
  out.grounded = grounded; out.up = up.y; out.braking = brake > 0.05 || (hb && speed > 1);
  const slide = clamp((Math.abs(vR) - 2.2) / 5, 0, 1);
  out.skid = grounded ? Math.max(slide, hb && speed > 6 ? 0.8 : 0, brake > 0.6 && speed > 12 ? 0.5 : 0) : 0;
  out.rpm = rpmFor(speed, spec.top, thr);
  // retourné et à l'arrêt : compteur de remise sur roues
  pv.flipT = (up.y < 0.35 && speed < 2.5) ? pv.flipT + dt : 0;
  return out;
}

/** Remet le véhicule sur ses roues à sa position actuelle (cap conservé). */
export function flipUpright(pv) {
  const q = pv.body.rotation(), f = rot(q, 0, 0, 1), t = pv.body.translation();
  const yaw = Math.atan2(f.x, f.z);
  pv.body.setRotation(quatY(Number.isFinite(yaw) ? yaw : 0), true);
  pv.body.setTranslation({ x: t.x, y: t.y + 1.2, z: t.z }, true);
  pv.body.setLinvel({ x: 0, y: 0, z: 0 }, true); pv.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  pv.flipT = 0;
}
export { rot as rotateByQuat };
