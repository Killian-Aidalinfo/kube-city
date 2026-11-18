// Playtest de conduite (headless, Rapier sous node, sol plat) : 0→100 km/h, freinage, rayon de braquage, retournement.
// Usage : node scripts/playtest/conduite.mjs [type ...]   (défaut : sedan race suv van moto bus)
import fs from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { specFor } from '../../client/src/vehicles/tuning.js';
import { buildGeometry, createPhysicsVehicle, driveStep } from '../../client/src/vehicles/drive.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../../client/public/assets/manifest.json', import.meta.url)));
await RAPIER.init();
const DT = 1 / 60;
function monde(type) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(3000, 0.5, 3000).setTranslation(0, -0.5, 0));
  const spec = specFor(type), geom = buildGeometry(manifest.vehicles.models[spec.model]);
  const pv = createPhysicsVehicle(RAPIER, world, spec, geom, { x: 0, y: 0.3, z: 0 }, 0);
  const step = (c) => { driveStep(pv, c, DT); world.step(); };
  for (let i = 0; i < 90; i++) step({});
  return { pv, step };
}
const types = process.argv.slice(2).length ? process.argv.slice(2) : ['sedan', 'race', 'suv', 'van', 'moto', 'bus'];
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
for (const type of types) {
  const spec = specFor(type);
  // 0→V km/h (V = 100, ou 85 % de la vitesse max pour les lents comme le bus)
  const V = Math.min(100, Math.round(spec.top * 0.85));
  let { pv, step } = monde(type);
  let t100 = null;
  for (let i = 0; i < 60 * 25 && t100 === null; i++) { step({ throttle: 1 }); if (pv.out.kmh >= V) t100 = (i + 1) * DT; }
  // freinage depuis 100 km/h
  ({ pv, step } = monde(type));
  for (let i = 0; i < 60 * 25 && pv.out.kmh < V; i++) step({ throttle: 1 });
  const z0 = pv.body.translation().z; let n = 0;
  while (pv.out.kmh > 2 && n++ < 60 * 10) step({ brake: 1 });
  const brakeDist = pv.body.translation().z - z0;
  // rayon de braquage à ~40 km/h (régime établi, braquage max) : cercle ajusté sur la trajectoire
  ({ pv, step } = monde(type));
  for (let i = 0; i < 60 * 25 && pv.out.kmh < 40; i++) step({ throttle: 1 });
  const pts = []; let vEnd = 0;
  for (let i = 0; i < 60 * 4; i++) { step({ throttle: 0.8, steer: 1 }); if (i > 90) { const p = pv.body.translation(); pts.push([p.x, p.z]); vEnd = pv.out.kmh; } }
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const radius = pts.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cz), 0) / pts.length;
  // virage serré à haute vitesse : ne doit pas se retourner
  ({ pv, step } = monde(type));
  for (let i = 0; i < 60 * 25 && pv.out.kmh < spec.top * 0.9; i++) step({ throttle: 1 });
  let minUp = 1;
  for (let i = 0; i < 60 * 3; i++) { step({ throttle: 1, steer: i < 90 ? 1 : -1, handbrake: i % 50 < 10 }); minUp = Math.min(minUp, pv.out.up); }
  for (let i = 0; i < 60 * 4; i++) step({ brake: 1 });
  // posé sur le toit : doit se remettre à l'endroit (la logique de jeu appelle flip après 5 s)
  const q = pv.body.rotation(); void q;
  pv.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true); pv.body.setTranslation({ x: 0, y: 1.5, z: 0 }, true);
  for (let i = 0; i < 60 * 3; i++) step({});
  const roofUp = pv.out.up;
  console.log(`${type.padEnd(16)} 0-${V}: ${t100?.toFixed(1) ?? '>25'} s | frein ${V}→0: ${brakeDist.toFixed(1)} m | rayon(braq. max, ${vEnd.toFixed(0)} km/h): ${radius.toFixed(1)} m | up min en virage rapide: ${minUp.toFixed(2)} | sur le toit: up=${roofUp.toFixed(2)}`);
  check(t100 !== null && t100 < (spec.mass > 3000 ? 22 : 14), `${type}: 0-${V} trop lent (${t100})`);
  const k2 = (V / 100) ** 2;
  check(brakeDist > 20 * k2 && brakeDist < 60, `${type}: distance de freinage ${brakeDist.toFixed(1)} m hors ${(20 * k2).toFixed(0)}..60`);
  check(radius > 4.5 && radius < 25, `${type}: rayon de braquage ${radius.toFixed(1)} m hors 4.5..25`);
  check(minUp > 0.5, `${type}: se retourne en virage rapide (up ${minUp.toFixed(2)})`);
  check(Math.abs(roofUp) <= 1.001, `${type}: état toit invalide`);
  // le jeu remet sur roues après 5 s quand flipT > 5 : on vérifie que le compteur croît bien sur le toit
  // moto : le rappel de roulis la redresse seule (pas de remise sur roues par le jeu) ; sinon flipT doit croître
  check(spec.twoWheel ? roofUp > 0.8 || pv.flipT > 2 : pv.flipT > 2, `${type}: flipT ne croît pas sur le toit (${pv.flipT.toFixed(1)}), pas de redressement auto`);
}
if (fails.length) { console.error('ÉCHECS :\n- ' + fails.join('\n- ')); process.exit(1); }
console.log('conduite : OK');
