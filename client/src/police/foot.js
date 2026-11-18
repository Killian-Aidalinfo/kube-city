// Policiers à pied : sortent des voitures et tentent d'arrêter le joueur (aucun sang : K.O. temporaire).
import * as THREE from 'three';
import { createCharacter, loadKit } from '../npc/character.js';

const COP_OUTFIT = { skin: '#d9a07e', hair: '#222222', top: '#233a6b', bottom: '#1b2540', shoes: '#111111' };

export function createFootCops(game, rng) {
  const cops = [];
  let kit, ready = false;
  loadKit(game).then((k) => { kit = k; ready = true; });

  function make() {
    const ch = createCharacter(game, kit, COP_OUTFIT);
    game.three.scene.add(ch.root); ch.root.visible = false;
    const cop = {
      kind: 'cop', ch, root: ch.root, position: ch.root.position, radius: 0.4, height: 1.8,
      active: false, state: 'run', t: 0, yaw: 0, hp: 60, lastUnit: null, cooldown: 0,
      get isDown() { return this.state === 'ko' || this.state === 'stun'; },
      receiveHit(hit) {
        if (!cop.active || cop.state === 'ko') return false;
        if (hit.kind === 'taser') { cop.state = 'stun'; cop.t = 3.5; cop.ch.play('Death01', { loop: false }); return true; }
        if (hit.kind === 'paint') return true;
        cop.hp -= hit.amount ?? 10;
        if (cop.hp <= 0) { cop.state = 'ko'; cop.t = 7; cop.ch.play('Death01', { loop: false }); }
        else cop.ch.play('Hit_Chest', { loop: false });
        return true;
      },
    };
    cops.push(cop);
    return cop;
  }

  /** Fait sortir `n` policiers à côté de (x, z). */
  function deploy(x, z, n = 2) {
    if (!ready) return;
    for (let i = 0; i < n; i++) {
      let c = cops.find((q) => !q.active);
      if (!c && cops.length < 6) c = make();
      if (!c) return;
      c.active = true; c.state = 'run'; c.hp = 60; c.t = 0;
      c.position.set(x + (i ? -1.6 : 1.6), game.world?.groundHeight?.(x, z) ?? 0, z + 1);
      c.root.visible = true; c.ch.play('Sprint_Loop');
    }
  }
  function recall(c) { c.active = false; c.root.visible = false; }

  /** Mise à jour : renvoie la durée d'arrestation cumulée du policier le plus proche. */
  function update(dt, pp, canArrest) {
    let near = 99;
    for (const c of cops) {
      if (!c.active) continue;
      c.ch.update(dt);
      if (c.state === 'ko' || c.state === 'stun') { c.t -= dt; if (c.t <= 0) { c.state = 'run'; c.hp = Math.max(c.hp, 30); c.ch.play('Sprint_Loop'); } continue; }
      const dx = pp.x - c.position.x, dz = pp.z - c.position.z, d = Math.hypot(dx, dz);
      near = Math.min(near, d);
      const want = Math.atan2(dx, dz); let a = want - c.yaw; a = Math.atan2(Math.sin(a), Math.cos(a));
      c.yaw += a * Math.min(1, 10 * dt); c.root.rotation.y = c.yaw;
      if (d > 1.3) {
        const v = canArrest ? 5.2 : 3;
        c.position.x += Math.sin(c.yaw) * v * dt; c.position.z += Math.cos(c.yaw) * v * dt;
        c.position.y = game.world?.groundHeight?.(c.position.x, c.position.z) ?? 0;
        c.ch.play(canArrest ? 'Sprint_Loop' : 'Walk_Loop');
      } else c.ch.play('Idle_Talking_Loop');
    }
    return near;
  }

  return { cops, deploy, recall, update, get ready() { return ready; } };
}
