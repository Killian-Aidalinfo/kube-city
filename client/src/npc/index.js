// PNJ (spec 8) : piétons animés, circulation sur le RoadGraph, réactions et témoins. Tout est local au client.
import { createPeds } from './peds.js';
import { createTraffic } from './traffic.js';
import { makeRng } from './logic.js';

/** @param {object} game contexte (spec 3.1) */
export function install(game) {
  const rng = makeRng(20261118);
  const peds = createPeds(game, rng);
  const traffic = createTraffic(game, rng);

  /**
   * API publique.
   * - peds / traffic : piétons (avec receiveHit, isDown, position) et voitures gérées
   * - nearby(p, r) : piétons visibles à moins de r mètres
   * - witnesses(p, r) / startCall : témoins (utilisés en interne pour signaler les crimes)
   * - adoptVehicle / releaseVehicle : la police rend ou reprend des voitures à la circulation
   */
  const npc = game.npc = {
    peds: peds.peds,
    traffic: traffic.cars,
    maxPeds: 0, maxCars: 0,
    nearby: peds.nearby,
    witnesses: peds.witnesses,
    startCall: peds.startCall,
    spawnFleeing: peds.spawnFleeing,
    adoptVehicle: traffic.adopt,
    releaseVehicle: traffic.release,
  };

  // Crime vu par un piéton : il appelle la police après un délai (3 à 6 s) -> crime « witnessed ».
  game.bus.on('crime', (c) => {
    if (c.witnessed || !c.position) return;
    const w = npc.witnesses(c.position, 28);
    if (!w.length) return;
    const ped = w[(rng() * w.length) | 0];
    npc.startCall(ped, 3 + rng() * 3, () => {
      game.bus.emit('crime', { ...c, witnessed: true, reporter: 'ped' });
    });
  });

  game.onUpdate((dt) => { peds.update(dt); traffic.update(dt); }, 10);
}
