// STUB VÉHICULES — à remplacer par le développeur VÉHICULES. Aucune voiture : l'API existe mais reste vide.

/** @param {object} game contexte (spec 3.1) */
export function install(game) {
  /** API publique (spec 3.7). */
  game.vehicles = {
    list: [],
    types: {},
    /** Crée un véhicule (stub : renvoie un objet minimal sans rendu). */
    spawn(type, position, rotation = 0, opts = {}) {
      const vehicle = {
        id: 'veh-' + game.vehicles.list.length, type, object3d: null, chassis: null,
        driver: null, passengers: [], speed: 0, health: 100, engineOn: false, lights: false, siren: false,
        owner: opts.owner ?? 'npc',
        setControls() {},
      };
      game.vehicles.list.push(vehicle);
      game.bus.emit('vehicle:spawned', { vehicle });
      return vehicle;
    },
    /** Véhicule à entrer le plus proche (stub : toujours null). */
    nearestEnterable: (position, radius) => null,
    enter(actor, vehicle, seat = 0) {},
    exit(actor) {},
  };
}
