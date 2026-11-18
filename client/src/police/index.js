// STUB POLICE — à remplacer par le développeur POLICE (niveau de recherche, IA, arrestation).

/** @param {object} game contexte (spec 3.1) */
export function install(game) {
  game.police = {
    /** Niveau de recherche 0..5. */
    level: 0,
    units: [],
    /** Zone de recherche { center, radius } ou null. */
    searchZone: null,
    /** Force le niveau (le vrai module émet 'wanted:changed'). */
    setLevel(level) {
      const previous = game.police.level;
      if (previous === level) return;
      game.police.level = level;
      game.bus.emit('wanted:changed', { level, previous });
    },
    clear() { game.police.setLevel(0); },
  };
}
