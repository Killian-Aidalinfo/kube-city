// STUB COMBAT — à remplacer par le développeur COMBAT (corps à corps, roue d'armes, armes non létales).

/** @param {object} game contexte (spec 3.1) */
export function install(game) {
  game.combat = {
    /** Arme courante : 'poings'|'batte'|'taser'|'paintball'. */
    weapon: 'poings',
    weapons: ['poings', 'batte', 'taser', 'paintball'],
    setWeapon(id) { if (game.combat.weapons.includes(id)) game.combat.weapon = id; },
    /** Inflige des dégâts non létaux à une cible (stub : sans effet). */
    hit(target, amount, source) {},
  };
}
