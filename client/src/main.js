// Amorçage : crée le contexte `game` (spec 3.1) puis installe chaque module dans l'ordre.
import { Bus } from './core/bus.js';
import { createSettings } from './core/settings.js';
import { createRenderer } from './core/renderer.js';
import { createInput } from './core/input.js';
import { createPhysics } from './core/physics.js';
import { createAssets } from './core/assets.js';
import { createLoop } from './core/loop.js';

import { install as installWorld } from './world/index.js';
import { install as installPlayer } from './player/index.js';
import { install as installVehicles } from './vehicles/index.js';
import { install as installNpc } from './npc/index.js';
import { install as installPolice } from './police/index.js';
import { install as installCombat } from './combat/index.js';
import { install as installAudio } from './audio/index.js';
import { install as installGameplay } from './gameplay/index.js';
import { install as installNet } from './net/index.js';
import { install as installUi } from './ui/index.js';

// Ordre d'installation imposé par la spec (core est déjà fait ci-dessous).
export const MODULES = [
  ['world', installWorld], ['player', installPlayer], ['vehicles', installVehicles], ['npc', installNpc],
  ['police', installPolice], ['combat', installCombat], ['audio', installAudio], ['gameplay', installGameplay],
  ['net', installNet], ['ui', installUi],
];

export async function boot() {
  const canvas = document.getElementById('game');
  const bus = new Bus();
  const settings = createSettings();
  const { scene, camera, renderer } = createRenderer(canvas, settings);
  const physics = await createPhysics();
  const input = createInput({ settings });
  const assets = createAssets(bus);

  const game = {
    three: { scene, camera, renderer },
    physics: { world: physics.world, RAPIER: physics.RAPIER, step: physics },
    bus, input, assets, settings, canvas,
    time: { now: 0, dt: 0, elapsed: 0, dayTime: 10 },
    world: null, player: null, vehicles: null, npc: null, police: null, combat: null, audio: null, gameplay: null, net: null, ui: null,
    onUpdate: null, // posé par createLoop
    state: 'menu',
    /** Change l'état global et prévient le bus. */
    setState(next) {
      const from = game.state;
      if (from === next) return;
      game.state = next;
      bus.emit('state:changed', { from, to: next });
    },
  };

  const loop = createLoop(game);
  game.loop = loop;
  game.onUpdate((dt) => input.poll(dt), -100, { real: true });
  game.onUpdate((dt) => { if (game.state !== 'paused') physics.update(dt); }, 0);
  game.onUpdate(() => renderer.render(scene, camera), 1000, { real: true });

  // Le manifest décrit les assets (chemins, échelles, animations) ; absent => replis procéduraux.
  await assets.loadManifest();

  for (const [name, install] of MODULES) {
    try { await install(game); } catch (e) { console.error(`[main] installation de « ${name} » :`, e); throw e; }
  }

  window.__game = game; // utile au débogage et au smoke test
  document.getElementById('boot')?.classList.add('hidden');
  loop.start();
  return game;
}

boot().catch((e) => {
  console.error('[main] démarrage impossible :', e);
  const b = document.getElementById('boot');
  if (b) b.textContent = 'Erreur au démarrage : ' + e.message;
});
