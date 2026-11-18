// STUB PNJ — à remplacer par le développeur PNJ (piétons, circulation, feux).

/** @param {object} game contexte (spec 3.1) */
export function install(game) {
  game.npc = {
    peds: [],
    traffic: [],
    /** Nombre max de PNJ (suit la qualité). */
    maxPeds: 0,
    /** Renvoie les PNJ à moins de `radius` mètres de p. */
    nearby: (p, radius) => [],
  };
}
