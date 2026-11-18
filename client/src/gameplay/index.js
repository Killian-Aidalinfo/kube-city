// STUB GAMEPLAY — à remplacer par le développeur GAMEPLAY (missions, activités, argent, persos).

/** @param {object} game contexte (spec 3.1) */
export function install(game) {
  game.gameplay = {
    money: 0,
    characters: ['ines', 'malik', 'jade'],
    currentCharacter: 'ines',
    missions: [],
    /** Ajoute (ou retire) de l'argent et émet 'money:changed'. */
    addMoney(delta, reason = '') {
      game.gameplay.money += delta;
      game.bus.emit('money:changed', { amount: game.gameplay.money, delta, reason });
    },
    switchCharacter(to) {
      const from = game.gameplay.currentCharacter;
      game.gameplay.currentCharacter = to;
      game.bus.emit('character:switch', { from, to });
    },
  };
}
