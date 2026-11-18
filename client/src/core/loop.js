// Boucle de rendu : requestAnimationFrame, dt borné, callbacks triés par ordre.
export function createLoop(game) {
  const subs = [];            // { fn, order }
  let last = 0, running = false, raf = 0;
  const MAX_DT = 0.1;         // évite les sauts après un onglet en pause

  game.onUpdate = (fn, order = 0) => {
    const s = { fn, order };
    subs.push(s);
    subs.sort((a, b) => a.order - b.order);
    return () => { const i = subs.indexOf(s); if (i >= 0) subs.splice(i, 1); };
  };

  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(MAX_DT, Math.max(0, (t - last) / 1000));
    last = t;
    const time = game.time;
    time.dt = dt; time.now = t / 1000; time.elapsed += dt;
    // 1 jour de jeu = 24 min réelles
    time.dayTime = (time.dayTime + dt * (24 / (24 * 60))) % 24;
    for (const s of [...subs]) {
      try { s.fn(dt); } catch (e) { console.error('[boucle]', e); }
    }
    game.input.endFrame?.();
  }

  return {
    start() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); },
    /** Avance d'une image à la main (tests). */
    step(dt) { for (const s of [...subs]) s.fn(dt); },
  };
}
