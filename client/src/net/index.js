// STUB RÉSEAU — à remplacer par le développeur RÉSEAU (WebSocket v2, autres joueurs, reconnexion).

/** @param {object} game contexte (spec 3.1) */
export function install(game) {
  game.net = {
    connected: false,
    /** Autres joueurs : Map id → { id, name, character, position, … }. */
    players: new Map(),
    status: { connected: false, pod: null, version: null, reconnects: 0, ping: 0, leader: false },
    send(type, payload) {},
    connect() {},
  };
}
