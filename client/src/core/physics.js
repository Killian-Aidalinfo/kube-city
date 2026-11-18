// Physique Rapier : init du WASM, monde, pas fixe 60 Hz avec accumulateur.

export const FIXED_DT = 1 / 60;

export async function createPhysics() {
  // import dynamique : le WASM (gros chunk « rapier ») se charge à part, le reste du jeu n'attend pas son analyse
  const { default: RAPIER } = await import('@dimforge/rapier3d-compat');
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = FIXED_DT;
  const eventQueue = new RAPIER.EventQueue(true);
  let acc = 0;
  const physics = {
    world, RAPIER, eventQueue, fixedDt: FIXED_DT, alpha: 0,
    /** Callbacks appelés avant chaque pas fixe : fn(fixedDt). */
    preStep: [],
    /** Callbacks appelés après chaque pas fixe : fn(fixedDt, eventQueue). */
    postStep: [],
    /** Avance la simulation de dt secondes réelles (max 5 pas par image). */
    update(dt) {
      acc = Math.min(acc + dt, FIXED_DT * 5);
      while (acc >= FIXED_DT) {
        for (const f of physics.preStep) f(FIXED_DT);
        world.step(eventQueue);
        for (const f of physics.postStep) f(FIXED_DT, eventQueue);
        acc -= FIXED_DT;
      }
      physics.alpha = acc / FIXED_DT; // pour l'interpolation visuelle
    },
  };
  return physics;
}
