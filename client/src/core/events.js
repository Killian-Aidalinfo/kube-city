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
  /** JOUEUR — { cause } émis une seule fois par player.knockOut (le combat ne le réémet pas) */
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
  /** RÉSEAU — { connected, pod, version, reconnects, ping, leader, sync, previousPod } */
  NET_STATUS: 'net:status',
  /** AUDIO — { name } */
  RADIO_STATION: 'radio:station',
  /** INTERFACE — { position } ou null */
  UI_WAYPOINT: 'ui:waypoint',
  /** FONDATION (ajout) — { loaded, total } pendant le chargement des assets */
  ASSETS_PROGRESS: 'assets:progress',
  /** FONDATION (ajout) — { from, to } quand game.state change */
  STATE_CHANGED: 'state:changed',

  // ---- ajouts des modules (intégration) ----
  /** JOUEUR — { id, key, text } de l'invite contextuelle courante, ou null */
  PLAYER_PROMPT: 'player:prompt',
  /** VÉHICULES — { vehicle, npc? } coup de klaxon (joueur ou PNJ) */
  VEHICLE_HORN: 'vehicle:horn',
  /** VÉHICULES — { vehicle, driver, position } conducteur PNJ éjecté (carjacking) */
  VEHICLE_DRIVER_EJECTED: 'vehicle:driverEjected',
  /** VÉHICULES — { vehicle, type, color } véhicule personnel livré */
  VEHICLE_PERSONAL: 'vehicle:personal',
  /** GAMEPLAY (garage) — { vehicle, color } ; la police appelle notifyRepaint() */
  VEHICLE_REPAINTED: 'vehicle:repainted',
  /** COMBAT — { weapon, kind, combo?, clip } */
  COMBAT_ATTACK: 'combat:attack',
  /** COMBAT — { weapon, kind } un coup a porté */
  COMBAT_HIT: 'combat:hit',
  /** COMBAT — { aiming } */
  COMBAT_AIM: 'combat:aim',
  /** COMBAT — { dir: { x, z } } */
  COMBAT_DODGE: 'combat:dodge',
  /** COMBAT — { weapon, previous } */
  COMBAT_WEAPON: 'combat:weapon',
  /** COMBAT — { open } roue d'armes (ralenti 0,2, caméra gelée) */
  COMBAT_WHEEL: 'combat:wheel',
  /** COMBAT — { npc, kind: 'ped'|'cop', cause, position } un PNJ est mis K.-O. */
  NPC_KO: 'npc:ko',
  /** GAMEPLAY — { id, name, duration } capacité spéciale (G) */
  ABILITY_USED: 'ability:used',
  /** GAMEPLAY — { character, outfit } */
  OUTFIT_CHANGED: 'outfit:changed',
  /** MONDE — { state: 'clair'|'nuageux'|'pluie'… } */
  WEATHER_CHANGED: 'weather:changed',
  /** GAMEPLAY — { id, text } invite de mission/activité (null text = effacer) */
  UI_PROMPT: 'ui:prompt',
  /** INTERFACE — { dataUrl, selfie } photo prise au téléphone */
  UI_PHOTO: 'ui:photo',
  /** GAMEPLAY → INTERFACE — { id } ouvrir une boutique */
  UI_SHOP: 'ui:shop',
  /** INTERFACE → AUDIO — { name, volume } son d'interface */
  UI_SOUND: 'ui:sound',
  /** RÉSEAU — { profile, reconnect } profil chargé depuis Redis */
  NET_PROFILE: 'net:profile',
  /** RÉSEAU — { name, text, at, history? } */
  NET_CHAT: 'net:chat',
  /** RÉSEAU — { id, e } emote d'un autre joueur */
  NET_EMOTE: 'net:emote',
  /** RÉSEAU — { from, kind, data } événement de jeu diffusé */
  NET_EVENT: 'net:event',
  /** RÉSEAU — { count } nombre de joueurs distants */
  NET_PLAYERS: 'net:players',
  /** RÉSEAU — message brut non reconnu */
  NET_MESSAGE: 'net:message',
});
