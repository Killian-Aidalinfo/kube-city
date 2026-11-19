// Caméras du joueur : 3e personne orbitale (à pied) et poursuite (véhicule, 3 modes avec V).
import * as THREE from 'three';
import { clamp, damp, dampAngle, angleDiff, orbitDirection, cameraHitDistance, sprintFactor } from './logic.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
// modes véhicule : 0 proche, 1 éloignée, 2 capot
const VEH_MODES = [
  { dist: 6.0, pitch: 0.2, height: 1.5 },
  { dist: 10.5, pitch: 0.3, height: 1.9 },
  { hood: true },
];

/** Lignes de vitesse : un seul div CSS (rayons irréguliers répétés, masqués au centre), seule l'opacité change. */
function speedLines() {
  if (typeof document === 'undefined' || !document.body) return null;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;z-index:5;pointer-events:none;opacity:0;will-change:opacity;'
    + 'background:repeating-conic-gradient(from 3deg at 50% 52%,rgba(255,255,255,0) 0deg 2.6deg,rgba(255,255,255,.9) 2.9deg 3.6deg,rgba(255,255,255,0) 3.9deg 9.3deg,rgba(255,255,255,.7) 9.5deg 9.9deg,rgba(255,255,255,0) 10.2deg 16.6deg,rgba(255,255,255,.85) 16.9deg 17.5deg,rgba(255,255,255,0) 17.8deg 24deg);'
    + '-webkit-mask-image:radial-gradient(ellipse at 50% 52%,transparent 52%,#000 100%);mask-image:radial-gradient(ellipse at 50% 52%,transparent 52%,#000 100%)';
  document.body.appendChild(el);
  return el;
}

/**
 * @param {object} game contexte
 * @param {object} player API joueur (position, state, vehicle, heading, aiming…)
 */
export function createCameraRig(game, player) {
  const { camera } = game.three;
  const { world, RAPIER } = game.physics;
  const rig = {
    yaw: 0, pitch: 0.3, mode: 0, aiming: false,
    _idle: 0, _chaseYaw: 0, _userYaw: 0, _userPitch: 0, _dist: 4.2, _fov: 60, _blend: 0,
    _pivot: new THREE.Vector3(), _wasVeh: false, _init: false, _lead: 0, _lines: null, _linesA: 0, _shake: 0,
  };

  /** Lance un rayon contre le décor (hors joueur/véhicule) ; renvoie la distance de touche ou null. */
  function castDist(origin, dir, maxDist, excludeBody) {
    try {
      const ray = new RAPIER.Ray(origin, dir);
      const hit = world.castRay(ray, maxDist, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, excludeBody);
      return hit ? hit.timeOfImpact ?? hit.toi : null;
    } catch { return null; }
  }

  rig.setMode = (m) => { rig.mode = ((m % VEH_MODES.length) + VEH_MODES.length) % VEH_MODES.length; };
  rig.nextMode = () => rig.setMode(rig.mode + 1);
  /** Oriente la caméra (ex. après un téléport ou un changement de perso). */
  rig.setYaw = (y) => { rig.yaw = y; rig._chaseYaw = y; rig._init = false; };

  /** Rayon de visée au centre de l'écran. */
  rig.aimRay = () => {
    camera.getWorldDirection(_v);
    return { origin: camera.position.clone(), direction: _v.clone() };
  };

  rig.update = function update(dt) {
    // caméra gelée pendant la roue d'armes : la souris sert à choisir l'arme
    const playing = game.state === 'playing' && !game.combat?.wheelOpen;
    const lx = playing ? game.input.axis('lookX') : 0;
    const ly = playing ? game.input.axis('lookY') : 0;
    const veh = player.state === 'inVehicle' ? player.vehicle : null;
    const vObj = veh?.object3d;
    if (!!vObj !== rig._wasVeh) { rig._blend = 0.9; rig._wasVeh = !!vObj; if (vObj) { rig._chaseYaw = rig.yaw; rig._userYaw = rig._userPitch = 0; } }
    if (!rig._init) { rig._pivot.set(player.position.x, player.position.y + 1.55, player.position.z); rig._init = true; }
    if (rig._blend > 0) rig._blend = Math.max(0, rig._blend - dt);

    let camPos, lookDir, fovT = 60, hide = false, sfe = 0;
    if (veh && vObj) {
      // ---- poursuite de véhicule ----
      const m = VEH_MODES[rig.mode];
      const f = _v.set(0, 0, 1).applyQuaternion(vObj.quaternion);
      const heading = Math.atan2(f.x, f.z);
      const lv = veh.chassis?.linvel?.() ?? { x: 0, y: 0, z: 0 };
      const sp = Math.hypot(lv.x, lv.z), kmh = veh.speed ?? sp * 3.6;
      const fwdSpeed = lv.x * f.x + lv.z * f.z;
      if (lx || ly) { rig._idle = 0; rig._userYaw -= lx; rig._userPitch = clamp(rig._userPitch + ly, -0.5, 0.9); } else rig._idle += dt;
      if (rig._idle > 1.4) { rig._userYaw = damp(rig._userYaw, 0, 2.2, dt); rig._userPitch = damp(rig._userPitch, 0, 2.2, dt); }
      // la caméra se place derrière la trajectoire (un peu de dérapage visible), derrière le nez en marche arrière
      let target = heading;
      if (sp > 5 && fwdSpeed > 0) target = heading + clamp(angleDiff(heading, Math.atan2(lv.x, lv.z)), -0.7, 0.7) * 0.6;
      // regarde dans le virage : vitesse de lacet réelle (le braquage en rad est minuscule à haute vitesse), lissée ; gauche = cap croissant
      const yawRate = veh.chassis?.angvel?.().y ?? 0;
      const leadT = m.hood ? 0 : clamp(yawRate * 0.5, -0.55, 0.55) * clamp(sp / 10, 0, 1) * (fwdSpeed > 0 ? 1 : 0);
      rig._lead = damp(rig._lead, leadT, 2.6, dt);
      target += rig._lead;
      // suivi plus souple à basse vitesse, plus ferme quand ça va vite (pas d'à-coups, pas de retard)
      rig._chaseYaw = dampAngle(rig._chaseYaw, target, m.hood ? 9 : 2.8 + clamp(kmh / 120, 0, 1) * 1.6, dt);
      rig.yaw = rig._chaseYaw + rig._userYaw;
      const pitchBase = m.hood ? 0.04 : m.pitch;
      rig.pitch = clamp(pitchBase + rig._userPitch, -0.4, 1.2);
      const dir = orbitDirection(rig.yaw, rig.pitch);
      const sf = clamp(kmh / 200, 0, 1); sfe = sf * sf * (3 - 2 * sf);   // 0..1 progressif
      fovT = 62 + sfe * 22;
      if (m.hood) {
        hide = true;
        camPos = _v2.set(0, 0.8, 0.5 + (veh.geom?.halfL ?? 1.8) * 0.1).applyQuaternion(vObj.quaternion).add(vObj.position);
        camPos.y += 0.35;
      } else {
        const pivotT = _v2.copy(vObj.position); pivotT.y += m.height;
        rig._pivot.x = damp(rig._pivot.x, pivotT.x, 30, dt); rig._pivot.z = damp(rig._pivot.z, pivotT.z, 30, dt);
        rig._pivot.y = damp(rig._pivot.y, pivotT.y, 14, dt);
        const want = m.dist + sfe * 3.5;   // la caméra recule avec la vitesse
        const hit = castDist(rig._pivot, { x: -dir.x, y: -dir.y, z: -dir.z }, want, veh.chassis);
        const d = cameraHitDistance(hit, want, 0.3, 1.5);
        rig._dist = d < rig._dist ? d : damp(rig._dist, d, 5, dt);
        camPos = _v2.set(rig._pivot.x - dir.x * rig._dist, rig._pivot.y - dir.y * rig._dist, rig._pivot.z - dir.z * rig._dist);
      }
      lookDir = dir;
    } else {
      // ---- 3e personne à pied ----
      rig.aiming = playing && game.input.isDown('aim') && (player.state === 'onFoot');
      if (lx || ly) { rig._idle = 0; rig.yaw -= lx; rig.pitch = clamp(rig.pitch + ly, -0.4, 1.25); } else rig._idle += dt;
      // recentrage doux derrière le perso quand il avance
      if (rig._idle > 0.9 && player.state === 'onFoot' && !rig.aiming && player.speed2d > 2.5) {
        const diff = angleDiff(rig.yaw, player.heading);
        if (Math.abs(diff) < 2.0) rig.yaw = dampAngle(rig.yaw, player.heading, 1.1, dt);
      }
      const swim = player.state === 'swimming';
      const dir = orbitDirection(rig.yaw, rig.pitch);
      const sk = rig.aiming ? 0 : sprintFactor(player.speed2d); // sprint : caméra plus proche et plus basse
      rig._sk = damp(rig._sk ?? 0, sk, 5, dt);
      const wantDist = rig.aiming ? 2.2 : 4.2 + clamp(player.speed2d * 0.05, 0, 0.5) - rig._sk * 0.5;
      const shoulder = rig.aiming ? 0.8 : 0;
      const pt = _v2.set(player.position.x, player.position.y + (swim ? 1.2 : 1.55) - (rig._sk ?? 0) * 0.15, player.position.z);
      rig._pivot.x = damp(rig._pivot.x, pt.x, 22, dt); rig._pivot.z = damp(rig._pivot.z, pt.z, 22, dt);
      rig._pivot.y = damp(rig._pivot.y, pt.y, 12, dt);
      // épaule droite : décalage latéral du pivot
      const rx = -Math.cos(rig.yaw), rz = Math.sin(rig.yaw);
      rig._shoulder = damp(rig._shoulder ?? 0, shoulder, 10, dt);
      const o = _v.set(rig._pivot.x + rx * rig._shoulder, rig._pivot.y, rig._pivot.z + rz * rig._shoulder);
      const hit = castDist(o, { x: -dir.x, y: -dir.y, z: -dir.z }, wantDist, player.body);
      const d = cameraHitDistance(hit, wantDist, 0.25, 0.45);
      rig._dist = d < rig._dist ? d : damp(rig._dist, d, 6, dt);
      camPos = _v2.set(o.x - dir.x * rig._dist, o.y - dir.y * rig._dist, o.z - dir.z * rig._dist);
      // jamais sous le sol
      const gh = game.world?.groundHeight?.(camPos.x, camPos.z);
      if (typeof gh === 'number' && camPos.y < gh + 0.3) camPos.y = gh + 0.3;
      lookDir = dir;
      fovT = rig.aiming ? 50 : 60 + rig._sk * 9;
      // secousse de foulée en sprint
      if (rig._sk > 0.02) { rig._bob = (rig._bob ?? 0) + dt * 14; camPos.y += Math.sin(rig._bob) * 0.03 * rig._sk; camPos.x += Math.cos(rig._bob * 0.5) * 0.02 * rig._sk; }
    }

    // tremblement léger à haute vitesse + lignes de vitesse discrètes (véhicule seulement)
    const kmhNow = veh && vObj ? (veh.speed ?? 0) : 0;
    const hi = clamp((kmhNow - 110) / 110, 0, 1);
    rig._shake = damp(rig._shake, hi, 3, dt);
    if (rig._shake > 0.01) {
      const t = (game.time?.elapsed ?? 0), a = rig._shake * (veh?.pv?.out.grounded === false ? 0.01 : 0.03);
      camPos.x += (Math.sin(t * 43) + Math.sin(t * 71)) * 0.5 * a; camPos.y += (Math.sin(t * 57) + Math.sin(t * 29)) * 0.5 * a;
    }
    const lineT = clamp((kmhNow - 120) / 100, 0, 1) * (VEH_MODES[rig.mode].hood ? 0.3 : 0.5);
    rig._linesA = damp(rig._linesA, lineT, 4, dt);
    if (rig._linesA > 0.004 || rig._lines) {
      rig._lines ??= speedLines();
      if (rig._lines) rig._lines.style.opacity = rig._linesA < 0.004 ? '0' : rig._linesA.toFixed(3);
    }

    if (rig._blend > 0) camera.position.x = damp(camera.position.x, camPos.x, 9, dt), camera.position.y = damp(camera.position.y, camPos.y, 9, dt), camera.position.z = damp(camera.position.z, camPos.z, 9, dt);
    else camera.position.copy(camPos);
    _q.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), new THREE.Vector3(lookDir.x, lookDir.y, lookDir.z), new THREE.Vector3(0, 1, 0)));
    camera.quaternion.copy(_q);
    rig._fov = damp(rig._fov, fovT, 4, dt);
    if (Math.abs(camera.fov - rig._fov) > 0.01) { camera.fov = rig._fov; camera.updateProjectionMatrix(); }
    player.setHidden?.(hide);
  };
  return rig;
}
