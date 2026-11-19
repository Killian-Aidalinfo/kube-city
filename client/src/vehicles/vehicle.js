// Un véhicule : physique (drive.js) + habillage three (modèle Kenney, roues, feux, gyrophares).
import * as THREE from 'three';
import { createPhysicsVehicle, driveStep, flipUpright, buildGeometry, quatY, rotateByQuat } from './drive.js';
import { damageLevel } from './tuning.js';
import { PROCEDURAL } from './procedural.js';

const SCALE = 1.4;
const _q = new THREE.Quaternion(), _v = new THREE.Vector3();
const DARK = new THREE.Color(0x3a3a3a);

/** Boîte émissive (feux, gyrophares). */
function lamp(w, h, d, color) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color }));
  m.userData.dispose = true;
  return m;
}

export class Vehicle {
  /**
   * @param {object} ctx { game, spec, geom, id, glow } contexte du gestionnaire
   * @param {object} opts { position, rotation, owner, color, driver }
   */
  constructor(ctx, opts) {
    const { game, spec, geom } = ctx;
    this._entry = ctx.entry; this.game = game; this.id = ctx.id; this.type = spec.id; this.spec = spec; this.geom = geom;
    this.category = spec.category; this.label = spec.label;
    this.owner = opts.owner ?? 'npc';
    this.driver = null; this.passengers = []; this.seats = spec.seats ?? 4;
    this.health = 100; this.engineOn = false; this.lights = false; this.siren = false;
    this.horn = false; this.speed = 0; this.rpm = 0.2; this.skid = 0; this.throttle = 0; this.braking = false;
    this.wrecked = false; this.burn = 0; this.color = opts.color ?? null; this.onGround = true;
    this.controls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.remote = this.owner === 'remote';
    this._t = 0; this._sleepT = 0; this._cool = 0; this._hist = []; this._age = 0; this._turn = 0;
    this.createdAt = game.time?.elapsed ?? 0;

    const { RAPIER, world } = game.physics;
    const pos = opts.position ?? { x: 0, y: 0, z: 0 };
    if (this.remote) {
      // véhicule d'un autre joueur : corps cinématique piloté par setRemoteState
      this.pv = null;
      this.chassis = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(pos.x, pos.y + geom.H0, pos.z).setRotation(quatY(opts.rotation ?? 0)));
      this.collider = world.createCollider(RAPIER.ColliderDesc.cuboid(geom.halfW, geom.hy, geom.halfL).setTranslation(0, geom.cy, 0), this.chassis);
      this.remoteWheels = { spin: 0, steer: 0 };
    } else {
      this.pv = createPhysicsVehicle(RAPIER, world, spec, geom, pos, opts.rotation ?? 0);
      this.chassis = this.pv.body; this.collider = this.pv.collider;
    }

    // habillage : racine = pose du châssis ; inner = décalé au niveau du sol
    this.object3d = new THREE.Group();
    this.object3d.name = 'vehicle-' + this.id;
    this.inner = new THREE.Group();
    this.inner.position.y = -geom.H0;
    this.object3d.add(this.inner);
    this.model = new THREE.Group(); this.model.scale.setScalar(SCALE);
    this.inner.add(this.model);
    this.wheelNodes = []; this.bodyMats = [];
    const p = this.chassis.translation(), q = this.chassis.rotation();
    this.object3d.position.set(p.x, p.y, p.z); this.object3d.quaternion.set(q.x, q.y, q.z, q.w);
    this._prevP = new THREE.Vector3(p.x, p.y, p.z); this._curP = this._prevP.clone();
    this._prevQ = this.object3d.quaternion.clone(); this._curQ = this._prevQ.clone();
    this._buildLamps(ctx.glow);
    this._loadModel(ctx.url);
    if (opts.driver) { this.driver = opts.driver; this.engineOn = true; }
  }

  // ----- habillage -----
  async _loadModel(url) {
    const { assets } = this.game;
    try {
      let m;
      if (this.spec.procedural) m = PROCEDURAL[this.spec.model](this.game.assets.manifest?.vehicles?.models?.[this.spec.model] ?? this._entry);
      else {
        const gltf = await assets.loadGLTF(url);
        if (this._disposed) return;
        m = assets.clone(gltf, { materials: true });
      }
      this.riderNode = m.getObjectByName('rider') ?? null;
      this.model.add(m);
      const names = new Set(this.geom.wheels.map((w) => w.name));
      this.wheelNodes = this.geom.wheels.map((w) => {
        const n = m.getObjectByName(w.name);
        if (n) { n.rotation.order = 'YXZ'; n.userData.baseX = n.position.x; n.userData.baseZ = n.position.z; }
        return n;
      });
      m.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true; o.receiveShadow = false;
          if (!names.has(o.name) && !names.has(o.parent?.name) && !(o.parent?.name === 'rider') && !o.material?.userData?.noTint) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((mt) => this.bodyMats.push(mt)); }
        }
      });
      this.bodyMats.forEach((mt) => { mt.userData.base = mt.color.clone(); });
      if (this.color) this.setColor(this.color);
      this._applyTint();
      this._lod = undefined; // modèle arrivé après le premier setLod : réappliquer le niveau de détail
    } catch {
      this._fallbackModel();
    }
  }
  /** Repli procédural si le glb est introuvable. */
  _fallbackModel() {
    const g = this.geom, mat = new THREE.MeshStandardMaterial({ color: this.color ?? 0xb04030 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(g.halfW * 2, g.hy * 2, g.halfL * 2), mat);
    body.position.set(0, (g.cy + g.H0) / SCALE, 0); body.scale.setScalar(1 / SCALE); body.castShadow = true;
    this.model.add(body); this.bodyMats.push(mat); mat.userData.base = mat.color.clone();
    const wm = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
    this.wheelNodes = g.wheels.map((w) => {
      const n = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.25, 12), wm);
      n.rotation.order = 'YXZ'; n.userData.baseX = w.x / SCALE; n.userData.baseZ = w.z / SCALE; n.userData.fallback = true;
      n.geometry.rotateZ(Math.PI / 2);
      this.model.add(n); return n;
    });
    this._lod = undefined;
  }
  _buildLamps(glowTex) {
    const g = this.geom, h = Math.min(0.72, g.size[1] * SCALE * 0.42), dx = this.spec.twoWheel ? 0.11 : g.halfW * 0.68;
    this.head = [lamp(0.34, 0.17, 0.06, 0x8a8a78), lamp(0.34, 0.17, 0.06, 0x8a8a78)];
    this.tail = [lamp(0.3, 0.14, 0.06, 0x4a0808), lamp(0.3, 0.14, 0.06, 0x4a0808)];
    this.head[0].position.set(dx, h, g.halfL + 0.02); this.head[1].position.set(-dx, h, g.halfL + 0.02);
    this.tail[0].position.set(dx, h, -g.halfL - 0.02); this.tail[1].position.set(-dx, h, -g.halfL - 0.02);
    this.blink = [lamp(0.16, 0.1, 0.06, 0x553300), lamp(0.16, 0.1, 0.06, 0x553300)]; // clignotants arrière G/D
    this.blink[0].position.set(dx + 0.3, h, -g.halfL - 0.02); this.blink[1].position.set(-dx - 0.3, h, -g.halfL - 0.02);
    for (const m of [...this.head, ...this.tail, ...this.blink]) this.inner.add(m);
    // gyrophares (police, ambulance, pompiers)
    if (this.spec.siren) {
      const top = g.size[1] * SCALE * (this.type === 'police' ? 1.02 : 1.06);
      this.bar = [lamp(0.34, 0.12, 0.2, 0x300000), lamp(0.34, 0.12, 0.2, 0x000030)];
      this.bar[0].position.set(0.22, top, 0.1); this.bar[1].position.set(-0.22, top, 0.1);
      this.inner.add(this.bar[0], this.bar[1]);
      this.glow = [0, 1].map((i) => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: i ? 0x3050ff : 0xff2010, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
        s.scale.setScalar(1.8); s.position.copy(this.bar[i].position); s.position.y += 0.1; s.userData.dispose = true;
        this.inner.add(s); return s;
      });
    }
  }
  /** Peint la carrosserie (teinte multipliée sur la texture d'origine). */
  setColor(c) {
    this.color = c;
    this.bodyMats.forEach((mt) => { mt.userData.base = new THREE.Color(c); });
    this._applyTint();
  }
  _applyTint() {
    // plus le véhicule est abîmé, plus la carrosserie est sombre/sale
    const k = this.wrecked ? 0.82 : Math.max(0, (60 - this.health) / 60) * 0.5;
    this.bodyMats.forEach((mt) => { if (mt.userData.base) mt.color.copy(mt.userData.base).lerp(DARK, k); });
  }

  // ----- API publique -----
  /** Commandes (IA, joueur) : { throttle -1..1, brake 0..1, steer -1..1 (+1 = droite), handbrake }. */
  setControls(c) {
    Object.assign(this.controls, c);
    if (this.pv && (c.throttle || c.steer || c.handbrake === false)) this.chassis.wakeUp();
  }
  get position() { return this.object3d.position; }
  get heading() { const f = _v.set(0, 0, 1).applyQuaternion(this.object3d.quaternion); return Math.atan2(f.x, f.z); }
  /** Position monde d'un point local (m, repère du châssis au sol). */
  localToWorld(x, y, z, out = new THREE.Vector3()) {
    out.set(x, y - this.geom.H0, z).applyQuaternion(this.object3d.quaternion).add(this.object3d.position);
    return out;
  }
  damage(amount, source = 'choc') {
    if (this.wrecked || amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this._applyTint();
    if (this.health <= 0) this._wreck(source);
  }
  repair() {
    this.health = 100; this.wrecked = false; this.burn = 0; this._applyTint();
  }
  /** Remet le véhicule sur ses roues. */
  flip() { if (this.pv) flipUpright(this.pv); this._hist.length = 0; }
  _wreck(source) {
    this.wrecked = true; this.engineOn = false; this.siren = false; this.lights = false;
    this.controls.throttle = 0; this.wreckedAt = this.game.time?.elapsed ?? 0;
    this._applyTint();
    this.game.vehicles?._onWreck(this, source);
  }
  /** Mise à jour d'un véhicule distant (réseau) : position, cap (rad), vitesse, roues. */
  setRemoteState({ x, y, z, rotation = 0, quaternion, steer = 0, speed = 0 }) {
    if (!this.remote) return;
    this.chassis.setNextKinematicTranslation({ x, y: y + this.geom.H0, z });
    this.chassis.setNextKinematicRotation(quaternion ?? quatY(rotation));
    this.remoteWheels.steer = steer; this.speed = speed;
  }

  // ----- pas physique (préstep) -----
  physicsStep(fdt, wet) {
    if (!this.pv) return;
    const pv = this.pv, body = this.chassis;
    // un conducteur qui accélère ou braque réveille toujours le châssis (l'endormissement peut suivre l'entrée)
    if (this.driver && body.isSleeping() && (this.controls.throttle || this.controls.steer)) body.wakeUp();
    const asleep = body.isSleeping();
    this._prevP.copy(this._curP); this._prevQ.copy(this._curQ);
    if (!asleep) {
      let c = this.controls;
      if (!this.engineOn) c = { throttle: 0, brake: this.driver ? 0.15 : 0.35, steer: 0, handbrake: !this.driver && !this.wrecked };
      else if (this.wrecked) c = { throttle: 0, brake: 0.3, steer: 0, handbrake: false };
      pv.assist = this.driver === this.game.player; // aides de conduite réservées au joueur (IA inchangée)
      driveStep(pv, c, fdt, wet);
      this.speed = pv.out.kmh; this.rpm = this.engineOn ? pv.out.rpm : 0; this.skid = pv.out.skid;
      this.throttle = c.throttle; this.braking = pv.out.braking; this.onGround = pv.out.grounded;
      // un véhicule vide et immobile s'endort (économie de calcul)
      if (!this.driver && pv.out.speed < 0.25 && pv.out.grounded) { this._sleepT += fdt; if (this._sleepT > 1.2) { body.sleep(); this._sleepT = 0; } }
      else this._sleepT = 0;
    } else { this.speed = 0; this.rpm = 0; this.skid = 0; this.braking = false; }
    const p = body.translation(), q = body.rotation();
    this._curP.set(p.x, p.y, p.z); this._curQ.set(q.x, q.y, q.z, q.w);
  }

  // ----- image : pose interpolée, roues, feux -----
  update(dt, alpha) {
    this._t += dt;
    if (this.remote) {
      const p = this.chassis.translation(), q = this.chassis.rotation();
      this.object3d.position.lerp(_v.set(p.x, p.y, p.z), Math.min(1, dt * 12));
      this.object3d.quaternion.slerp(_q.set(q.x, q.y, q.z, q.w), Math.min(1, dt * 12));
      this.remoteWheels.spin += (this.speed / 3.6 / this.geom.radius) * dt;
    } else if (!this.chassis.isSleeping() || this._dirty) {
      this.object3d.position.lerpVectors(this._prevP, this._curP, alpha);
      this.object3d.quaternion.slerpQuaternions(this._prevQ, this._curQ, alpha);
    } else { this.object3d.position.copy(this._curP); this.object3d.quaternion.copy(this._curQ); }
    this._wheels();
    this._lamps();
    if (this.spec.twoWheel) {
      // inclinaison dans les virages (autour de la ligne de contact au sol) ; pilote PNJ visible
      this.inner.rotation.z = this.pv ? this.pv.out.lean : 0;
      if (this.riderNode) this.riderNode.visible = !!this.driver && !this.driver.isPlayer && this.driver !== this.game.player;
    }
  }
  _wheels() {
    const g = this.geom;
    for (let i = 0; i < this.wheelNodes.length; i++) {
      const n = this.wheelNodes[i]; if (!n) continue;
      const w = g.wheels[i];
      const susp = this.pv ? this.pv.suspLen[i] : g.rest;
      const spin = this.pv ? this.pv.spin[i] : this.remoteWheels.spin;
      const steer = w.front ? -(this.pv ? this.pv.steerVis : this.remoteWheels.steer) : 0;
      n.position.y = (w.y + g.rest - susp + g.H0) / SCALE;
      n.rotation.set(spin, steer, 0);
    }
  }
  _lamps() {
    const night = !!this.lights;
    const hOn = night && !this.wrecked;
    for (const l of this.head) l.material.color.setHex(hOn ? 0xfff2c4 : 0x8a8a78);
    const stop = this.braking && !this.wrecked;
    for (const l of this.tail) l.material.color.setHex(stop ? 0xff2a1a : hOn ? 0xa81410 : 0x4a0808);
    // clignotants automatiques : braquage marqué à faible vitesse
    const s = this.pv ? this.pv.steer : 0;
    const on = Math.abs(s) > 0.28 && this.speed < 45 && this.driver && !this.wrecked && (Math.floor(this._t * 3) % 2 === 0);
    // blink[0] = côté gauche (+X) : braquage à gauche (s < 0) ; blink[1] = droite
    this.blink[0].material.color.setHex(on && s < 0 ? 0xffb020 : 0x553300);
    this.blink[1].material.color.setHex(on && s > 0 ? 0xffb020 : 0x553300);
    if (this.bar) {
      const ph = this.siren && !this.wrecked ? Math.floor(this._t * 7) % 2 : -1;
      this.bar[0].material.color.setHex(ph === 0 ? 0xff2010 : 0x300000); this.bar[1].material.color.setHex(ph === 1 ? 0x3050ff : 0x000030);
      this.glow[0].material.opacity = ph === 0 ? 0.9 : 0; this.glow[1].material.opacity = ph === 1 ? 0.9 : 0;
    }
  }
  /**
   * Niveau de détail selon la distance à la caméra (m) : 0 = complet, 1 = sans ombres de roues ni feux éteints,
   * 2 = carrosserie seule sans ombre (roues et feux masqués sauf phares allumés). Économise les draw calls.
   */
  setLod(d) {
    const lod = d < 35 ? 0 : d < 85 ? 1 : 2;
    if (lod === this._lod && lod !== 2) return;
    const lit = !!this.lights || !!this.siren || this.braking;
    if (lod === this._lod && lit === this._lodLit) return;
    this._lod = lod; this._lodLit = lit;
    const wheels = new Set(this.wheelNodes.filter(Boolean));
    for (const n of wheels) { n.visible = lod < 2; n.traverse?.((o) => { if (o.isMesh) o.castShadow = lod === 0; }); }
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      let w = false; for (let q = o; q && q !== this.model; q = q.parent) if (wheels.has(q)) { w = true; break; }
      if (!w) o.castShadow = lod < 2;
    });
    const lamps = [...(this.head ?? []), ...(this.tail ?? []), ...(this.blink ?? [])];
    for (const l of lamps) l.visible = lod < 2 || lit;
    for (const l of this.blink ?? []) l.visible = lod === 0;
  }
  /** Libère la physique et le rendu. */
  dispose() {
    this._disposed = true;
    const { world } = this.game.physics;
    try { if (this.pv) this.pv.ctrl.free?.(); world.removeRigidBody(this.chassis); } catch { /* déjà retiré */ }
    this.object3d.removeFromParent();
    this.object3d.traverse((o) => {
      if (o.userData?.dispose) { o.geometry?.dispose?.(); o.material?.dispose?.(); }
    });
    this.bodyMats.forEach((m) => m.dispose?.());
  }
}
export { damageLevel, buildGeometry, rotateByQuat };
