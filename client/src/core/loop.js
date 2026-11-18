// Boucle de rendu : requestAnimationFrame, dt borné, callbacks triés par ordre.
// Temps de jeu : chaque source de ralenti pose son facteur via game.time.setScale(source, k) ;
// le facteur appliqué est le PLUS FORT ralenti (minimum) : la roue d'armes (0,2) l'emporte sur Focus (0,5).
// Les callbacks reçoivent le dt de jeu (ralenti) ; ceux enregistrés avec { real: true } (entrées, caméra,
// interface, audio, rendu) reçoivent le dt réel, disponible aussi dans game.time.realDt.
export const MAX_DT = 0.1; // évite les sauts après un onglet en pause

/** Facteur effectif : minimum des ralentis actifs, borné à [0,05 ; 1]. */
export function effectiveScale(scales) {
  let k = 1;
  for (const v of Object.values(scales)) if (typeof v === 'number' && v < k) k = v;
  return Math.max(0.05, k);
}

export function createLoop(game) {
  const subs = [];            // { fn, order, real }
  let last = 0, running = false, raf = 0;
  const time = game.time;
  time.scale = 1; time.realDt = 0;
  time.scales = {};
  /** Pose (ou retire avec k = 1 / null) le ralenti d'une source : 'focus', 'wheel'… */
  time.setScale = (source, k) => {
    if (k == null || k >= 0.999) delete time.scales[source]; else time.scales[source] = k;
    time.scale = effectiveScale(time.scales);
  };

  game.onUpdate = (fn, order = 0, opts = {}) => {
    const s = { fn, order, real: !!opts.real };
    subs.push(s);
    subs.sort((a, b) => a.order - b.order);
    return () => { const i = subs.indexOf(s); if (i >= 0) subs.splice(i, 1); };
  };

  function tick(realDt) {
    time.scale = effectiveScale(time.scales);
    const dt = realDt * time.scale;
    time.realDt = realDt; time.dt = dt; time.elapsed += dt;
    // 1 jour de jeu = 24 min réelles
    time.dayTime = (time.dayTime + dt * (24 / (24 * 60))) % 24;
    for (const s of [...subs]) {
      try { s.fn(s.real ? realDt : dt); } catch (e) { console.error('[boucle]', e); }
    }
    game.input?.endFrame?.();
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    const realDt = Math.min(MAX_DT, Math.max(0, (t - last) / 1000));
    last = t;
    time.now = t / 1000;
    tick(realDt);
  }

  return {
    start() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); },
    /** Avance d'une image à la main (tests) avec le ralenti courant. */
    step(dt) { tick(dt); },
  };
}
