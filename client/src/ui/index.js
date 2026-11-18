// STUB INTERFACE — à remplacer par le développeur UI (HUD, minimap, carte, téléphone, menus).
// Le stub passe directement en état 'playing' et verrouille la souris au clic.

/** @param {object} game contexte (spec 3.1) */
export function install(game) {
  const root = document.getElementById('ui-root');
  game.ui = {
    root,
    /** Affiche un message court (stub : console). */
    notify(text, kind = 'info', duration = 3) { game.bus.emit('notify', { text, kind, duration }); },
    showScreen(name) {},
    hideScreen(name) {},
  };
  game.canvas.addEventListener('click', () => { if (game.state === 'playing') game.input.requestPointerLock(game.canvas); });
  game.setState('playing');
}
