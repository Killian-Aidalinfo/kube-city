// Lecture tolérante de l'état du joueur local (game.player, game.vehicles, game.police) pour les messages v2.
// Les API des autres modules peuvent encore être des stubs : tout champ absent a une valeur par défaut.
const arr = (v) => (v ? [+v.x || 0, +v.y || 0, +v.z || 0] : [0, 0, 0]);
const charId = (c) => (typeof c === 'string' ? c : c?.id || c?.key || undefined);

/** Animation du protocole déduite de l'état du joueur (ou fournie par le module JOUEUR dans `anim`). */
export function animOf(pl, speed) {
  if (typeof pl.anim === 'string' && pl.anim) return pl.anim;
  switch (pl.state) {
    case 'inVehicle': case 'enteringVehicle': case 'exitingVehicle': return 'drive';
    case 'swimming': return 'swim';
    case 'ko': case 'ragdoll': return 'ko';
    default: return speed < 0.5 ? 'idle' : speed < 3.5 ? 'walk' : speed < 6.5 ? 'run' : 'sprint';
  }
}

export function readState(game) {
  const pl = game.player;
  if (!pl) return null;
  const pos = pl.position || pl.object3d?.position;
  if (!pos) return null;
  // en voiture : vitesse du châssis (extrapolation et vitesse des roues chez les autres)
  const lv = pl.vehicle?.chassis?.linvel?.();
  const vel = lv || pl.velocity || { x: 0, y: 0, z: 0 };
  const speed = Math.hypot(vel.x || 0, vel.z || 0);
  const veh = pl.vehicle || null;
  const seat = veh ? (veh.driver === pl || veh.driver === pl.character ? 0 : Math.max(1, (veh.passengers?.indexOf?.(pl) ?? 0) + 1)) : 0;
  return {
    t: 'state',
    p: arr(pos), r: pl.object3d?.rotation?.y ?? pl.yaw ?? 0, vel: arr(vel),
    a: animOf(pl, speed),
    veh: veh?.id ?? null, seat,
    st: game.police?.level ?? game.police?.wanted ?? 0,
  };
}

/** Message `vehicle` : seulement si le joueur est le conducteur d'un véhicule avec un modèle 3D. */
export function readVehicle(game) {
  const pl = game.player;
  const v = pl?.vehicle;
  if (!v || !v.object3d) return null;
  const driver = v.driver === pl || v.driver === pl.character || v.driver === 'player';
  if (!driver) return null;
  const o = v.object3d, q = o.quaternion;
  return {
    t: 'vehicle', id: String(v.id), type: String(v.type || 'sedan'),
    p: arr(o.position), q: [q.x, q.y, q.z, q.w],
    w: [v.controls?.steer ?? v.steer ?? 0, v.wheelSpin ?? 0],
    col: typeof v.color === 'string' ? v.color : undefined,
    sir: v.siren ? 1 : 0, li: v.lights ? 1 : 0,
  };
}

/** Perso et tenue courants (pour hello / look). */
export function readLook(game) {
  const ch = charId(game.player?.character) || charId(game.gameplay?.character) || 'ines';
  const outfit = game.player?.outfit || game.gameplay?.outfit || game.gameplay?.profile?.outfits?.[ch]
    || game.assets?.manifest?.characters?.playable?.[ch]?.outfit;
  return { ch, outfit };
}
