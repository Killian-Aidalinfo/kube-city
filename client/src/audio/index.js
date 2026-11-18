// STUB AUDIO — à remplacer par le développeur AUDIO (Web Audio : moteurs, sirènes, radio procédurale).

/** @param {object} game contexte (spec 3.1) */
export function install(game) {
  game.audio = {
    /** AudioContext (créé au premier geste utilisateur par le vrai module). */
    ctx: null,
    /** Joue un effet (stub : ne fait rien). */
    play(name, opts) {},
    setRadio(stationIndex) {},
    stations: [],
    /** Volume 0..1 par bus : 'music' | 'sfx' | 'ambient'. */
    setVolume(bus, v) {},
  };
}
