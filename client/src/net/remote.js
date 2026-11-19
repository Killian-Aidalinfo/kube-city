// Rendu des autres joueurs : mannequin colorié avec leur tenue, pseudo au-dessus, véhicule Kenney.
// Tout est tolérant : modèle absent ou module physique en stub => repli procédural (capsule, boîte).
import * as THREE from 'three';
import { DELAY, adaptiveDelay, pushSample, sampleAt } from './interp.js';

// Animation du protocole -> clip de la bibliothèque (animations/ual.glb)
const CLIPS = {
  idle: 'Idle_Loop', walk: 'Walk_Loop', run: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop', jump: 'Jump_Loop', fall: 'Jump_Loop',
  drive: 'Driving_Loop', swim: 'Swim_Fwd_Loop', ko: 'Death01', punch: 'Punch_Jab', crouch: 'Crouch_Idle_Loop', dance: 'Dance_Loop', danse: 'Dance_Loop', talk: 'Idle_Talking_Loop',
};
const EMOTE_MS = 3500;

function makeLabel(text, color = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 28px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(text, 128, 32);
  g.fillStyle = color; g.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(1.8, 0.45, 1);
  sprite.renderOrder = 999;
  return sprite;
}

const EMOTE_ICONS = { salut: '👋', danse: '💃', bravo: '👏', rire: '😂' };
/** Bulle d'emote (emoji) à poser au-dessus d'un personnage. */
export function makeBubble(icon) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.font = '88px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(icon, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(1.1, 1.1, 1);
  sprite.renderOrder = 1000;
  return sprite;
}

function disposeObject(o) {
  o.traverse((n) => {
    n.geometry?.dispose?.();
    n.skeleton?.dispose?.(); // libère la boneTexture (16×16 flottants) : sinon une par joueur parti reste en mémoire GPU
    const mats = Array.isArray(n.material) ? n.material : n.material ? [n.material] : [];
    for (const m of mats) { m.map?.dispose?.(); m.dispose?.(); }
  });
}

/** @param {object} game contexte (spec 3.1) @param {Map<string, object>} players table publique game.net.players */
export function createRemotes(game, players) {
  const group = new THREE.Group();
  group.name = 'net-remote';
  game.three.scene.add(group);
  const recs = new Map(); // id -> enregistrement interne
  const vehs = new Map(); // id véhicule -> { root, wheels, body, buf, ... }
  let mannequin = null;   // Promise du glb partagé

  const manifest = () => game.assets.manifest;
  const outfitOf = (e) => e.outfit || manifest()?.characters?.playable?.[e.character]?.outfit
    || (e.bot ? { skin: '#d8b08c', hair: '#222222', top: '#39ff88', bottom: '#222a33', shoes: '#eeeeee' } : { skin: '#e0ac8a', hair: '#2b1b14', top: '#d4513f', bottom: '#23283b', shoes: '#f2f2f2' });

  function loadMannequin() {
    if (!mannequin) mannequin = game.assets.loadGLTF('/assets/' + (manifest()?.characters?.model || 'animations/ual.glb')).catch(() => null);
    return mannequin;
  }

  function buildAvatar(rec) {
    const root = new THREE.Group();
    // repli visible tout de suite : capsule de la couleur du haut ; remplacée quand le mannequin est chargé
    const o = outfitOf(rec.entry);
    const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.2, 4, 8), new THREE.MeshStandardMaterial({ color: o.top }));
    cap.position.y = 0.9;
    root.add(cap);
    rec.placeholder = cap;
    group.add(root);
    rec.root = root;
    rec.label = makeLabel(rec.entry.name + (rec.entry.bot ? ' (IA)' : ''), rec.entry.bot ? '#7dffb0' : '#ffffff');
    rec.label.position.y = 2.2;
    root.add(rec.label);
    loadMannequin().then((gltf) => {
      if (!gltf || rec.dead) return;
      const model = game.assets.clone(gltf);
      game.assets.applyOutfit(model, outfitOf(rec.entry));
      root.remove(cap); disposeObject(cap); rec.placeholder = null;
      root.add(model);
      rec.model = model;
      rec.mixer = new THREE.AnimationMixer(model);
      rec.clips = new Map(gltf.animations.map((c) => [c.name, c]));
      rec.look = JSON.stringify([rec.entry.character, rec.entry.outfit]);
      play(rec, rec.anim || 'idle', true);
    }).catch(() => { /* on garde la capsule */ });
  }

  function play(rec, anim, force) {
    if (!rec.mixer) return;
    const clip = rec.clips.get(CLIPS[anim] || CLIPS.idle) || rec.clips.get(CLIPS.idle);
    if (!clip || (rec.clipName === clip.name && !force)) return;
    const next = rec.mixer.clipAction(clip);
    next.reset().play();
    if (rec.action && rec.action !== next) next.crossFadeFrom(rec.action, 0.2, false);
    rec.action = next; rec.clipName = clip.name;
  }

  function recolor(rec) {
    // la tenue ou le perso a changé : on reconstruit le mannequin
    if (!rec.model) return;
    rec.root.remove(rec.model); disposeObject(rec.model);
    rec.model = null; rec.mixer = null; rec.action = null; rec.clipName = null;
    loadMannequin().then((gltf) => {
      if (!gltf || rec.dead) return;
      const model = game.assets.clone(gltf);
      game.assets.applyOutfit(model, outfitOf(rec.entry));
      rec.root.add(model); rec.model = model;
      rec.mixer = new THREE.AnimationMixer(model);
      rec.clips = new Map(gltf.animations.map((c) => [c.name, c]));
      play(rec, rec.anim || 'idle', true);
    });
  }

  // ---------- Véhicules des autres joueurs ----------
  function buildVehicle(v) {
    // Module véhicules présent : vrai véhicule cinématique (owner 'remote') piloté par setRemoteState
    if (game.vehicles?.spawn) {
      try {
        const p = { x: v.p?.[0] ?? 0, y: (v.p?.[1] ?? 0), z: v.p?.[2] ?? 0 };
        const veh = game.vehicles.spawn(v.type || 'sedan', p, 0, { owner: 'remote', color: v.col });
        // le modèle local doit correspondre au type annoncé (un type inconnu retombe sur la berline)
        if (veh && v.type && veh.type !== v.type) console.warn(`[net] véhicule distant : type reçu « ${v.type} », modèle local « ${veh.type} »`);
        if (veh?.setRemoteState) return { id: v.id, veh, buf: [], dead: false, owner: null, type: v.type, color: v.col };
        if (veh) game.vehicles.remove?.(veh);
      } catch (e) { console.warn('[net] véhicule distant :', e.message); }
    }
    const root = new THREE.Group();
    const man = manifest()?.vehicles;
    const info = man?.models?.[v.type] || man?.models?.sedan;
    const rec = { id: v.id, root, buf: [], wheels: [], body: null, info, dead: false, owner: null };
    // boîte de repli tant que le modèle charge (ou s'il est absent)
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 4.2), new THREE.MeshStandardMaterial({ color: v.col || '#cccccc' }));
    box.position.y = 0.7;
    root.add(box); rec.placeholder = box;
    group.add(root);
    if (info) {
      game.assets.loadGLTF('/assets/' + info.file).then((gltf) => {
        if (rec.dead) return;
        const model = game.assets.clone(gltf, { materials: true });
        model.scale.setScalar(man.scale || 1);
        root.remove(box); disposeObject(box); rec.placeholder = null;
        root.add(model);
        for (const n of info.wheelNodes || []) { const w = model.getObjectByName(n); if (w) rec.wheels.push({ node: w, front: /front/.test(n) }); }
        rec.model = model;
        tint(model, rec.color);
      }).catch(() => {});
    }
    // corps cinématique : les véhicules de joueurs se heurtent (spec 14) ; sans physique réelle, on s'en passe
    try {
      const { world, RAPIER } = game.physics;
      if (world && RAPIER?.RigidBodyDesc?.kinematicPositionBased && info?.bodyBounds) {
        const s = man.scale || 1, b = info.bodyBounds;
        const half = [0, 1, 2].map((i) => Math.abs(b.max[i] - b.min[i]) * s / 2);
        rec.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
        rec.collider = world.createCollider(RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2]).setTranslation(0, (b.min[1] + b.max[1]) * s / 2, 0), rec.body);
        rec.world = world;
      }
    } catch { rec.body = null; }
    return rec;
  }

  // Teinte la carrosserie (matériaux dupliqués) quand une couleur est donnée
  function tint(model, col) {
    if (!col) return;
    model.traverse((o) => { if (o.material && /body|paint|main|colormap/i.test(o.material.name)) o.material.color?.set(col); });
  }

  function dropVehicle(rec) {
    rec.dead = true;
    if (rec.veh) { try { game.vehicles?.remove?.(rec.veh); } catch {} vehs.delete(rec.id); return; }
    group.remove(rec.root); disposeObject(rec.root);
    try { if (rec.body) rec.world.removeRigidBody(rec.body); } catch {}
    vehs.delete(rec.id);
  }

  // ---------- API ----------
  return {
    group,
    /** Reçoit une entrée de snapshot (champs rares présents ou non). */
    upsert(e, t) {
      let rec = recs.get(e.id);
      if (!rec) {
        rec = { id: e.id, buf: [], entry: { id: e.id, name: 'Joueur', character: 'ines', outfit: null, bot: false }, anim: 'idle', emoteUntil: 0, root: null };
        recs.set(e.id, rec);
        players.set(e.id, rec.entry);
      }
      const en = rec.entry;
      if (e.n != null) en.name = e.n;
      if (e.ch != null) en.character = e.ch;
      if ('o' in e || e.n != null) en.outfit = e.o || null;
      if (e.bot) en.bot = true;
      en.anim = e.a; en.stars = e.st || 0; en.vehicleId = e.veh || null; en.seat = e.seat || 0;
      rec.anim = e.a || 'idle';
      if (e.p) pushSample(rec.buf, t, { p: e.p, r: e.r, vel: e.vel });
      // véhicule piloté par ce joueur
      if (e.vh) {
        let v = vehs.get(e.vh.id);
        // le conducteur a changé de véhicule sous le même id (ou de type) : on reconstruit le bon modèle
        if (v && e.vh.type && v.type && v.type !== e.vh.type) { dropVehicle(v); v = null; }
        if (!v) { v = buildVehicle(e.vh); v.owner = e.id; vehs.set(e.vh.id, v); }
        if (v.veh && e.vh.col && v.color !== e.vh.col) v.veh.setColor?.(e.vh.col);
        v.type = e.vh.type; v.color = e.vh.col; v.sir = e.vh.sir; v.lastSeen = t; v.owner = e.id;
        pushSample(v.buf, t, { p: e.vh.p, q: e.vh.q, w: e.vh.w, vel: e.vel });
        en.vehicle = { id: e.vh.id, type: e.vh.type, color: e.vh.col, siren: !!e.vh.sir };
      } else en.vehicle = null;
      if (!rec.root) buildAvatar(rec);
      else if (rec.model && rec.look !== JSON.stringify([en.character, en.outfit])) { rec.look = JSON.stringify([en.character, en.outfit]); recolor(rec); }
    },
    emote(id, e) {
      const rec = recs.get(id);
      if (!rec) return;
      rec.emote = e; rec.emoteUntil = performance.now() + EMOTE_MS;
      if (rec.bubble) { rec.root.remove(rec.bubble); disposeObject(rec.bubble); rec.bubble = null; }
      if (EMOTE_ICONS[e] && rec.root) { rec.bubble = makeBubble(EMOTE_ICONS[e]); rec.root.add(rec.bubble); }
    },
    remove(id) {
      const rec = recs.get(id);
      if (!rec) return;
      rec.dead = true;
      group.remove(rec.root); disposeObject(rec.root);
      recs.delete(id); players.delete(id);
      for (const v of [...vehs.values()]) if (v.owner === id) dropVehicle(v);
    },
    /** Retire ceux qui ne figurent pas dans la liste complète (après une reconnexion par exemple). */
    prune(ids) { for (const id of [...recs.keys()]) if (!ids.has(id)) this.remove(id); },
    clear() { for (const id of [...recs.keys()]) this.remove(id); },
    /** Une image : interpolation à (maintenant - 100 ms) et animation. */
    update(dt, nowSec) {
      const t = nowSec - DELAY;
      for (const v of vehs.values()) {
        // véhicules : retard adaptatif (court à cadence stable) + extrapolation par la vitesse
        const s = sampleAt(v.buf, nowSec - adaptiveDelay(v.buf));
        if (!s) continue;
        if (v.veh) {
          const H0 = v.veh.geom?.H0 ?? 0, q = s.q ? { x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] } : undefined;
          const speed = s.vel ? Math.hypot(s.vel[0], s.vel[2]) * 3.6 : 0;
          v.veh.siren = !!v.sir;
          const gy = game.world?.groundHeight?.(s.p[0], s.p[2]) ?? -1e9; // agents IA : y = sol
          v.veh.setRemoteState({ x: s.p[0], y: Math.max(s.p[1] - H0, gy), z: s.p[2], quaternion: q, steer: s.w?.[0] || 0, speed });
          continue;
        }
        v.root.position.set(s.p[0], s.p[1], s.p[2]);
        if (s.q) v.root.quaternion.set(s.q[0], s.q[1], s.q[2], s.q[3]);
        if (v.model && s.w) for (const w of v.wheels) { w.node.rotation.x = s.w[1] || 0; if (w.front) w.node.rotation.y = s.w[0] || 0; }
        try { v.body?.setNextKinematicTranslation(v.root.position); v.body?.setNextKinematicRotation(v.root.quaternion); } catch {}
      }
      for (const rec of recs.values()) {
        const s = sampleAt(rec.buf, t);
        if (!s || !rec.root) continue;
        const en = rec.entry;
        en.position = { x: s.p[0], y: s.p[1], z: s.p[2] };
        en.rotation = s.r || 0;
        en.speed = s.vel ? Math.hypot(s.vel[0], s.vel[2]) : 0;
        // en véhicule (conducteur ou passager) : l'avatar est dans la voiture, seul le pseudo reste visible au-dessus
        const inCar = !!en.vehicleId;
        rec.root.position.set(s.p[0], s.p[1], s.p[2]);
        rec.root.rotation.y = s.r || 0;
        if (rec.model) rec.model.visible = !inCar;
        if (rec.placeholder) rec.placeholder.visible = !inCar;
        rec.label.visible = !inCar || !!en.vehicle; // un passager n'a pas de pseudo flottant
        rec.label.position.y = en.vehicle ? 2.6 : 2.2;
        if (rec.bubble) {
          rec.bubble.position.y = en.vehicle ? 3.3 : 2.9;
          if (performance.now() > rec.emoteUntil) { rec.root.remove(rec.bubble); disposeObject(rec.bubble); rec.bubble = null; }
        }
        if (rec.mixer) {
          const emoting = performance.now() < rec.emoteUntil;
          play(rec, emoting ? rec.emote : rec.anim);
          rec.mixer.update(dt);
        }
      }
      // véhicule sans nouvelles depuis 3 s (joueur sorti) : on le retire
      for (const v of [...vehs.values()]) if (nowSec - (v.lastSeen || 0) > 3) dropVehicle(v);
    },
    dispose() { this.clear(); for (const v of [...vehs.values()]) dropVehicle(v); game.three.scene.remove(group); },
    get count() { return recs.size; },
  };
}
