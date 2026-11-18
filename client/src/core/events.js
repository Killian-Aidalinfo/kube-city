// Catalogue des événements du bus (spec 3.2). Source de vérité pour les payloads.
// Utilisation : game.bus.emit(EVENTS.NOTIFY, { text: 'Salut', kind: 'info', duration: 3 })
/**
 * @typedef {{ x: number, y: number, z: number }} Vec3
 * @typedef {{ vehicle: object, seat: number }} SeatPayload
 */
export const EVENTS = Object.freeze({
  /** JOUEUR — { character } */
  PLAYER_SPAWNED: 'player:spawned',
  /** VÉHICULES — { vehicle, seat } */
  PLAYER_ENTER_VEHICLE: 'player:enterVehicle',
  /** VÉHICULES — { vehicle, seat } */
  PLAYER_EXIT_VEHICLE: 'player:exitVehicle',
  /** COMBAT — { amount, source } */
  PLAYER_DAMAGED: 'player:damaged',
  /** COMBAT — { cause } */
  PLAYER_KO: 'player:ko',
  /** GAMEPLAY — { where: 'hôpital'|'commissariat', cost } */
  PLAYER_RESPAWN: 'player:respawn',
  /** VÉHICULES — { vehicle } */
  VEHICLE_SPAWNED: 'vehicle:spawned',
  /** VÉHICULES — { vehicle } */
  VEHICLE_DESTROYED: 'vehicle:destroyed',
  /** VÉHICULES — { vehicle, other, impulse } */
  VEHICLE_COLLISION: 'vehicle:collision',
  /** tous — { kind: 'carjack'|'hitPed'|'assault'|'speedingNearCop'|'shootCop'|'vandalism', severity, position } */
  CRIME: 'crime',
  /** POLICE — { level, previous } */
  WANTED_CHANGED: 'wanted:changed',
  /** POLICE — {} */
  WANTED_BUSTED: 'wanted:busted',
  /** GAMEPLAY — { amount, delta, reason } */
  MONEY_CHANGED: 'money:changed',
  /** GAMEPLAY — { id, title, text } */
  MISSION_STARTED: 'mission:started',
  MISSION_OBJECTIVE: 'mission:objective',
  MISSION_PASSED: 'mission:passed',
  MISSION_FAILED: 'mission:failed',
  /** tous — { text, kind: 'info'|'success'|'warning'|'danger', duration } */
  NOTIFY: 'notify',
  /** tous — { speaker, text, duration } */
  SUBTITLE: 'subtitle',
  /** GAMEPLAY — { from, to } */
  CHARACTER_SWITCH: 'character:switch',
  /** RÉSEAU — { connected, pod, version, reconnects, ping, leader } */
  NET_STATUS: 'net:status',
  /** AUDIO — { name } */
  RADIO_STATION: 'radio:station',
  /** INTERFACE — { position } ou null */
  UI_WAYPOINT: 'ui:waypoint',
  /** FONDATION (ajout) — { loaded, total } pendant le chargement des assets */
  ASSETS_PROGRESS: 'assets:progress',
  /** FONDATION (ajout) — { from, to } quand game.state change */
  STATE_CHANGED: 'state:changed',
});
