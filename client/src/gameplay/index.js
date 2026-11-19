// GAMEPLAY (spec 11) : persos jouables, argent, missions et activités data-driven, boutiques, respawn, sauvegarde.
import { PolyPath, headingOf, steerTo, speedCommand } from '../npc/driver.js';
import { seatMonkey } from './monkey.js';
import * as THREE from 'three';
import { CHARACTERS, CHARACTER_IDS, gainStat, checkAchievements } from './characters.js';
import { MISSIONS, availableMissions } from './missions.js';
import { SIDE_MISSIONS, buildSideMission } from './sidemissions.js';
import { createRunner } from './runner.js';
import { createAirTracker, dist2d, kubePositions, raceReward, taxiFare, taxiTip, deliveryTime, deliveryReward } from './activities.js';
import { defaultProfile, loadProfile, saveProfile, saveLocal } from './save.js';

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Lieux logiques → motif de recherche dans game.world.places (clé ou libellé, sans accents)
const PLACE_PATTERNS = {
  garage: /garage|\blou\b/, port: /(^|[^a-z])port($|[^a-z])|dock/, jetee: /jetee|pier/, phare: /phare|lighthouse/, stade: /stade|stadium/,
  belvedere: /belvedere|viewpoint/, aeroport: /aeroport|airport/, mairie: /mairie|hotel.de.ville|town.?hall/, commissariat: /commissariat|police/,
  hopital: /hopital|hospital/, vetements: /vetement|boutique|clothes|mode/, datacenter: /datacenter|data.?center/,
};
const PALETTE = ['#d4513f', '#2f6fb3', '#e8b949', '#7bbf6a', '#c94c8f', '#2a2a2a', '#f2f2f2', '#6b3fa0'];
const PAINTS = ['#d4513f', '#2f6fb3', '#e8b949', '#2a2a2a', '#f2f2f2', '#7bbf6a', '#ff4fa3', '#38e8ff'];

/** @param {object} game contexte (spec 3.1) */
export function install(game) {
  const bus = game.bus;
  let profile = defaultProfile();
  let ready = null;
  let active = null; // { kind: 'mission'|'activity', def, runner, retry }
  let respawning = false;
  const rng = Math.random;
  const kubeList = kubePositions(50, game.world?.size || 1200);
  let kubeMesh = null;
  const kubeDummy = new THREE.Object3D();
  const photos = { count: 0, last: null };
  let koCounter = 0;
  const air = createAirTracker();

  // ---------- lieux ----------
  const spawn = () => game.world?.spawnPoints?.player || { x: 0, y: 1, z: 0 };
  const groundY = (x, z) => { try { return game.world?.groundHeight?.(x, z) ?? 0; } catch { return 0; } };
  /** Résout un lieu logique ('garage', {place, dx, dz}, {x, z}) en point {x, y, z}. */
  function place(ref) {
    if (ref && typeof ref === 'object' && 'x' in ref) return { x: ref.x, y: ref.y ?? 0, z: ref.z };
    const key = typeof ref === 'string' ? ref : ref.place;
    const off = typeof ref === 'object' ? ref : {};
    let base = null;
    const places = game.world?.places || {};
    const pat = PLACE_PATTERNS[key] || new RegExp(norm(key));
    for (const [k, v] of Object.entries(places)) {
      if (pat.test(norm(k)) || pat.test(norm(v?.label || ''))) { base = v.position; break; }
    }
    if (!base) { // repli déterministe : couronne autour du point d'apparition
      const names = Object.keys(PLACE_PATTERNS), i = Math.max(0, names.indexOf(key)), s = spawn();
      const a = (i / names.length) * Math.PI * 2;
      base = { x: s.x + Math.cos(a) * 160, y: 0, z: s.z + Math.sin(a) * 160 };
    }
    return { x: base.x + (off.dx || 0), y: base.y ?? 0, z: base.z + (off.dz || 0) };
  }
  const hideout = (id) => {
    for (const [k, v] of Object.entries(game.world?.places || {})) if (/planque|hideout|safehouse/.test(norm(k + (v.label || ''))) && CHARACTERS[id].hideout.test(norm(k + (v.label || '')))) return v.position;
    const s = spawn(), o = CHARACTERS[id].offset;
    return { x: s.x + o.x, y: 0, z: s.z + o.z };
  };

  // ---------- API publique ----------
  const cur = () => profile.chars[profile.current];
  const gp = game.gameplay = {
    characters: CHARACTER_IDS,
    charData: CHARACTERS,
    get currentCharacter() { return profile.current; },
    get money() { return cur().money; },
    set money(v) { cur().money = Math.max(0, Math.floor(v)); },
    get profile() { return profile; },
    get stats() { return cur().stats; },
    missions: [],
    get active() { return active ? { kind: active.kind, id: active.def.id, title: active.def.title, text: active.runner.text, type: active.runner.step?.type, target: active.runner.target, timeLeft: active.runner.timeLeft } : null; },
    markers: [],
    ability: { id: '', name: '', gauge: 1, active: 0, cost: 0.5 },
    kubes: { total: 50, get found() { return profile.kubes.length; } },
    place, hideout,
    /** Ajoute (ou retire) de l'argent et émet 'money:changed'. */
    addMoney(delta, reason = '') {
      const c = cur();
      c.money = Math.max(0, Math.floor(c.money + delta));
      bus.emit('money:changed', { amount: c.money, delta, reason });
      scheduleSave();
    },
    /** Dépense si le solde le permet. */
    spend(n, reason = '') {
      if (cur().money < n) { bus.emit('notify', { text: 'Fonds insuffisants.', kind: 'danger', duration: 2.5 }); return false; }
      gp.addMoney(-n, reason); return true;
    },
    getOutfit: (id = profile.current) => ({ ...profile.chars[id].outfit }),
    /** Choix initial du perso (écran de sélection) : charge sa position et le fait apparaître. */
    async chooseCharacter(id) {
      await gp.ensureReady();
      if (!CHARACTERS[id]) id = CHARACTER_IDS[0];
      profile.current = id;
      const c = cur();
      const p = c.pos ? { x: c.pos.x, z: c.pos.z } : hideout(id);
      applyCharacter(id, p);
      if (c.armor && game.player) game.player.armor = c.armor;
      bus.emit('money:changed', { amount: c.money, delta: 0, reason: 'chargement' });
      bus.emit('notify', { text: `Bienvenue, ${CHARACTERS[id].short} !`, kind: 'info', duration: 3 });
      refreshMissions();
    },
    /** Changement de perso avec transition caméra aérienne. */
    switchCharacter(to, opts = {}) {
      if (!CHARACTERS[to] || to === profile.current || game.state === 'cutscene') return false;
      if (active?.def.id === 'finale' && !opts.forced) { bus.emit('notify', { text: 'Le casse impose les changements de perso.', kind: 'warning', duration: 2.5 }); return false; }
      beginSwitch(to);
      return true;
    },
    startMission(id) {
      const def = MISSIONS.find((m) => m.id === id);
      if (!def) return false;
      if (!availableMissions(profile.missions, profile.current).some((m) => m.id === id)) { bus.emit('notify', { text: 'Mission indisponible pour ce perso.', kind: 'warning', duration: 2.5 }); return false; }
      return begin('mission', def);
    },
    /** Lance une activité : 'taxi' | 'delivery' | 'race' (cascades et kubes sont permanents). */
    startActivity(kind) {
      const def = buildActivity(kind);
      return def ? begin('activity', def) : false;
    },
    abandon() { if (!active) return; bus.emit('notify', { text: 'Activité abandonnée.', kind: 'info', duration: 2 }); end(); },
    useAbility,
    /** Phone : un taxi PNJ se range près du joueur. */
    callTaxi() {
      const p = game.player?.position; if (!p || !game.vehicles?.spawn) return false;
      const a = (game.player.object3d?.rotation?.y ?? 0);
      game.vehicles.spawn('taxi', { x: p.x + Math.sin(a) * 18 + 4, y: p.y + 1, z: p.z + Math.cos(a) * 18 }, a, { owner: 'npc' });
      bus.emit('notify', { text: 'Un taxi arrive.', kind: 'success', duration: 3 }); return true;
    },
    /** Phone : le garage livre le véhicule personnel (ou un véhicule de prêt). */
    callGarage() {
      if (game.vehicles?.deliverPersonal?.()) return true;
      const p = game.player?.position; if (!p || !game.vehicles?.spawn) return false;
      if (!gp.spend(50, 'livraison garage')) return false;
      game.vehicles.spawn('sedan', { x: p.x + 6, y: p.y + 1, z: p.z + 6 }, 0, { owner: 'player' });
      bus.emit('notify', { text: 'Chez Lou vous livre un véhicule.', kind: 'success', duration: 3 }); return true;
    },
    shopCatalog, buy,
    openShop(id) { bus.emit('ui:shop', { id }); },
    save: () => doSave(),
  };
  // Le réseau est installé après le gameplay : le profil n'est lu qu'au premier besoin (game.net existe alors).
  let loaded = false;
  gp.ensureReady = () => {
    if (!ready) ready = loadProfile(game.net).then((p) => { profile = p; }).catch(() => {}).then(() => { loaded = true; refreshMissions(); });
    return ready;
  };

  // ---------- missions ----------
  function refreshMissions() {
    const avail = availableMissions(profile.missions, profile.current);
    gp.missions = MISSIONS.map((m) => ({
      id: m.id, title: m.title, char: m.char, summary: m.summary, reward: m.reward,
      status: profile.missions[m.id]?.done ? 'done' : avail.includes(m) ? 'available' : 'locked',
    }));
    gp.activities = [
      { id: 'taxi', title: 'Course de taxi', summary: 'Prenez un client et déposez-le vite et sans casse.' },
      { id: 'delivery', title: 'Livraison chronométrée', summary: 'Livrez un colis avant la fin du temps.' },
      { id: 'race', title: 'Course de rue', summary: 'Affrontez des rivaux sur un circuit de points de passage.' },
      ...SIDE_MISSIONS,
    ];
  }
  const env = {
    pos: () => game.player?.position || spawn(),
    inVehicle: () => !!game.player?.vehicle,
    speed: () => (game.player?.vehicle?.speed ?? 0) / 3.6,
    wanted: () => game.police?.level ?? 0,
    setWanted: (n) => { if (game.police?.setLevel) game.police.setLevel(n); },
    place,
    say: (speaker, text, dur) => bus.emit('subtitle', { speaker, text, duration: dur }),
    notify: (text, kind = 'info', duration = 3) => bus.emit('notify', { text, kind, duration }),
    spawnVehicle(spec) {
      const at = spec.at || env.pos();
      const v = game.vehicles?.spawn?.(spec.type || 'sedan', { x: at.x, y: groundY(at.x, at.z) + 1, z: at.z }, spec.rotation || 0, { owner: 'player' });
      return { vehicle: v, pos: () => v?.object3d?.position ?? at };
    },
    switchTo: (id) => gp.switchCharacter(id, { forced: true }),
    currentChar: () => profile.current,
    koCount: () => koCounter,
    photoCount: () => photos.count,
    photoNear: (p, r) => !photos.last || dist2d(photos.last, p) <= r,
    route: (a, b) => { try { return game.world?.route?.(a, b); } catch { return null; } },
    /** Fait rouler un véhicule sans conducteur le long de `pts` (IA de la police) ; renvoie la distance restante. */
    driveVehicle(h, pts, desired, dt) {
      const v = h?.vehicle; if (!v || v.driver) return null;
      const p = v.object3d.position, hd = headingOf(v.object3d, { x: 0, z: 1 }), speed = (v.speed ?? 0) / 3.6;
      if (h.ptsRef !== pts) { h.ptsRef = pts; h.path = new PolyPath(pts); }
      const left = h.path.update(p), tgt = h.path.target(Math.max(8, speed), p);
      h.stuck = speed < 0.6 ? (h.stuck || 0) + dt : 0;
      if (h.stuck > 2.5) { h.rev = 1.4; h.stuck = 0; }
      v.engineOn = true;
      if (h.rev > 0) { h.rev -= dt; v.setControls({ throttle: 0, brake: 1, steer: -steerTo(hd.x, hd.z, tgt.x - p.x, tgt.z - p.z), handbrake: false }); return left; }
      const steer = steerTo(hd.x, hd.z, tgt.x - p.x, tgt.z - p.z);
      const cmd = speedCommand(speed, desired * (1 - 0.45 * Math.min(1, Math.abs(steer))));
      v.setControls({ throttle: cmd.throttle, brake: cmd.brake, steer, handbrake: false });
      return left;
    },
    /** Position réelle d'un véhicule piloté. */
    vehiclePos: (h) => h?.vehicle?.object3d?.position ?? null,
    /** Pose un singe au volant. */
    seatMonkey(h) { if (h?.vehicle && !h.unseat) h.unseat = seatMonkey(h.vehicle); },
    /** Fin de poursuite : arrête la voiture et enlève le singe. */
    releaseVehicle(h) {
      const v = h?.vehicle; if (!v) return;
      h.unseat?.(); h.unseat = null;
      v.setControls?.({ throttle: 0, brake: 1, steer: 0, handbrake: true }); v.siren = false;
    },
    moveVehicle(h, p, heading) {
      const v = h?.vehicle; if (!v || v.driver) return;
      try { game.vehicles.teleport(v, { x: p.x, y: groundY(p.x, p.z), z: p.z }, heading); } catch { /* véhicule retiré */ }
    },
    vehicleDamage: () => 100 - (game.player?.vehicle?.health ?? 100),
    onStep(runner) {
      if (!active || active.runner !== runner) return;
      const d = active.def;
      bus.emit('mission:objective', { id: d.id, title: d.title, text: runner.text });
    },
  };

  function begin(kind, def) {
    if (game.state !== 'playing') return false;
    if (active) { bus.emit('notify', { text: 'Terminez ou abandonnez d\'abord l\'activité en cours.', kind: 'warning', duration: 3 }); return false; }
    const runner = createRunner(def, env);
    active = { kind, def, runner, retry: 0, lastText: '', startMoney: cur().money };
    active.runner = runner;
    bus.emit('mission:started', { id: def.id, title: def.title, text: def.summary || '' });
    if (runner.step) env.onStep(runner);
    return true;
  }
  function end() {
    active?.runner?.dispose?.();
    active = null;
    game.ui?.setWaypoint?.(null, { auto: true });
    refreshMissions();
  }
  function finish() {
    const { def, runner, kind } = active;
    let reward = def.reward || 0;
    let extra = '';
    if (def.onPass) { const r = def.onPass(runner) || {}; reward += r.reward || 0; extra = r.text || ''; }
    if (kind === 'mission') profile.missions[def.id] = { done: true };
    if (reward) gp.addMoney(reward, def.title);
    bus.emit('mission:passed', { id: def.id, title: def.title, text: extra || def.outro || def.summary || '', reward });
    if (kind === 'mission') bus.emit('notify', { text: `${def.reward} € versés à ${CHARACTERS[profile.current].short}.`, kind: 'success', duration: 3.5 });
    for (const a of checkAchievements(profile)) bus.emit('notify', { text: `Succès : ${a.title}`, kind: 'success', duration: 4 });
    end(); doSave();
  }
  function updateActive(dt) {
    if (!active) return;
    const r = active.runner;
    if (active.retry > 0) {
      // reprise au dernier point de passage une fois le joueur de nouveau en jeu
      if (game.state === 'playing' && game.player?.state !== 'ko' && !respawning) {
        active.retry -= dt;
        if (active.retry <= 0) { r.restartStep(); env.notify('Reprise au dernier point de passage.', 'info', 3); env.onStep(r); }
      }
      return;
    }
    if (game.state !== 'playing') return;
    const st = r.update(dt);
    if (r.text !== active.lastText) { active.lastText = r.text; bus.emit('mission:objective', { id: active.def.id, title: active.def.title, text: r.text }); }
    const t = r.target;
    if (t) game.ui?.setWaypoint?.({ x: t.x, y: 0, z: t.z }, { auto: true, quiet: true });
    else game.ui?.setWaypoint?.(null, { auto: true });
    if (st === 'passed') finish();
    else if (st === 'failed') {
      bus.emit('mission:failed', { id: active.def.id, title: active.def.title, text: r.failReason });
      active.retry = 3.5;
    }
  }

  // ---------- activités ----------
  function randomPlace(near, minD, maxD) {
    const places = Object.values(game.world?.places || {}).map((p) => p.position).filter(Boolean);
    const cands = places.filter((p) => { const d = dist2d(p, near); return d >= minD && d <= maxD; });
    if (cands.length) return cands[(rng() * cands.length) | 0];
    const a = rng() * Math.PI * 2, d = minD + rng() * (maxD - minD);
    const q = { x: near.x + Math.cos(a) * d, z: near.z + Math.sin(a) * d };
    try { return game.world?.nearestRoadPoint?.(q) || q; } catch { return q; }
  }
  function buildActivity(kind) {
    const me = env.pos();
    if (SIDE_MISSIONS.some((m) => m.id === kind)) return buildSideMission(kind, { me, place, pick: randomPlace, dist: dist2d, time: deliveryTime });
    if (kind === 'taxi') {
      const a = randomPlace(me, 60, 200), b = randomPlace(a, 200, 500);
      const len = dist2d(a, b), allowed = deliveryTime(len) + 20, fare = taxiFare(len);
      return {
        id: 'taxi', title: 'Course de taxi', summary: 'Un client attend.', reward: 0,
        steps: [
          { type: 'goto', text: 'Récupérez le client (en voiture).', to: a, vehicle: true, radius: 9, say: [{ speaker: 'Central taxi', text: 'Un client vous attend au point indiqué. Il a dit « vite », puis « pas trop vite ».', dur: 4 }] },
          { type: 'goto', text: 'Déposez le client à destination.', to: b, vehicle: true, radius: 10, timeLimit: allowed, say: [{ speaker: 'Client', text: 'Bonjour ! Pas trop vite… enfin si, je suis en retard.', dur: 4 }] },
        ],
        onPass(r) {
          const tip = taxiTip(fare, r.elapsed, allowed, Math.max(0, env.vehicleDamage()));
          profile.stats.taxiRides++;
          return { reward: fare + tip, text: `Course : ${fare} € · pourboire : ${tip} €` };
        },
      };
    }
    if (kind === 'delivery') {
      const a = randomPlace(me, 40, 180), b = randomPlace(a, 250, 600);
      const len = dist2d(a, b), limit = deliveryTime(len);
      let timeLeft = 0;
      return {
        id: 'delivery', title: 'Livraison chronométrée', summary: 'Livrez le colis à temps.', reward: 0,
        steps: [
          { type: 'goto', text: 'Récupérez le colis (en voiture).', to: a, vehicle: true, radius: 9, say: [{ speaker: 'Lou', text: 'Un colis t\'attend. Ne regarde pas ce qu\'il y a dedans, il paraît que ça clignote.', dur: 4 }] },
          { type: 'goto', text: 'Livrez le colis à temps.', to: b, vehicle: true, radius: 10, timeLimit: limit, say: [{ speaker: 'Lou', text: `Colis récupéré. Le chrono tourne : ${limit} secondes, pas une de plus.`, dur: 4 }] },
        ],
        onPass(r) { timeLeft = Math.max(0, limit - r.stepTime); const g = deliveryReward(len, timeLeft, limit); return { reward: g, text: `Livraison : ${g} €` }; },
      };
    }
    if (kind === 'race') {
      const pts = [];
      let from = me;
      for (let i = 0; i < 5; i++) { from = randomPlace(from, 120, 300); pts.push({ x: from.x, z: from.z }); }
      return {
        id: 'race', title: 'Course de rue', summary: 'Terminez dans le trio de tête.', reward: 0,
        steps: [
          { type: 'enterVehicle', text: 'Montez dans un véhicule pour courir.' },
          { type: 'race', text: 'Franchissez tous les points de passage.', checkpoints: pts, rivals: [{ name: 'Fanny', speed: 20 }, { name: 'Gégé', speed: 18 }, { name: 'Zoé', speed: 16 }] },
        ],
        onPass(r) { profile.stats.races++; const g = raceReward(r.result.place); return { reward: g, text: `Place ${r.result.place} : ${g} €` }; },
      };
    }
    return null;
  }

  // ---------- changement de perso ----------
  let cut = null;
  function applyCharacter(id, p) {
    const pl = game.player;
    if (!pl) return;
    const y = groundY(p.x, p.z) + 1;
    pl.setCharacter?.(id);
    pl.teleport?.({ x: p.x, y, z: p.z });
    if (pl.state === 'ko') pl.state = 'onFoot';
    pl.armor = profile.chars[id].armor || 0;
    pl.health = 100;
    bus.emit('outfit:changed', { character: id, outfit: { ...profile.chars[id].outfit } });
    game.player.setOutfit?.({ ...profile.chars[id].outfit });
  }
  function beginSwitch(to) {
    const from = profile.current;
    const pl = game.player;
    if (pl?.vehicle) game.vehicles?.exit?.(pl);
    const me = pl?.position || spawn();
    cur().pos = { x: me.x, z: me.z };
    cur().armor = pl?.armor || 0;
    const dest = profile.chars[to].pos || hideout(to);
    const cam = game.three.camera;
    cut = { t: 0, from, to, dest: { x: dest.x, z: dest.z }, start: cam.position.clone(), src: { x: me.x, y: me.y ?? 0, z: me.z }, swapped: false };
    game.setState('cutscene');
    bus.emit('notify', { text: `${CHARACTERS[to].activity}`, kind: 'info', duration: 3.5 });
  }
  const ease = (t) => t * t * (3 - 2 * t);
  function updateCut(dt) {
    if (!cut) return;
    cut.t += dt;
    const T = cut.t, cam = game.three.camera;
    const H = 230;
    const dy = groundY(cut.dest.x, cut.dest.z);
    let pos, look;
    if (T < 1.5) { // montée au-dessus de la ville
      const k = ease(T / 1.5);
      pos = { x: cut.start.x + (cut.src.x - cut.start.x) * k, y: cut.start.y + (H - cut.start.y) * k, z: cut.start.z + (cut.src.z - cut.start.z) * k + 0.5 * k };
      look = cut.src;
    } else if (T < 3.2) { // survol vers l'autre perso, échange à mi-parcours
      const k = ease((T - 1.5) / 1.7);
      if (k > 0.5 && !cut.swapped) { cut.swapped = true; swapNow(); }
      pos = { x: cut.src.x + (cut.dest.x - cut.src.x) * k, y: H, z: cut.src.z + (cut.dest.z - cut.src.z) * k + 0.5 };
      look = { x: pos.x, y: 0, z: pos.z - 0.5 };
    } else if (T < 4.8) { // descente derrière le nouveau perso
      const k = ease((T - 3.2) / 1.6);
      pos = { x: cut.dest.x, y: H + (dy + 5 - H) * k, z: cut.dest.z + 0.5 + 9 * k };
      look = { x: cut.dest.x, y: dy + 1, z: cut.dest.z };
    } else { cut = null; game.setState('playing'); return; }
    cam.position.set(pos.x, pos.y, pos.z);
    cam.lookAt(look.x, look.y ?? 0, look.z);
  }
  function swapNow() {
    const { from, to, dest } = cut;
    profile.current = to;
    applyCharacter(to, dest);
    bus.emit('character:switch', { from, to });
    bus.emit('money:changed', { amount: cur().money, delta: 0, reason: 'changement de perso' });
    refreshMissions();
    if (game.police) game.police.clear?.();
    doSave();
  }

  // ---------- capacités ----------
  const abil = { until: 0, cooldown: 0 };
  function useAbility() {
    const ch = CHARACTERS[profile.current], a = ch.ability, st = gp.ability;
    if (game.state !== 'playing') return false;
    if (st.gauge < a.cost) { bus.emit('notify', { text: `${a.name} : jauge insuffisante.`, kind: 'warning', duration: 1.5 }); return false; }
    if (a.id === 'focus' && !game.player?.vehicle) { bus.emit('notify', { text: 'Focus : disponible en conduite.', kind: 'warning', duration: 2 }); return false; }
    if (a.id === 'repair') {
      const v = game.player?.vehicle;
      if (!v) { bus.emit('notify', { text: 'Réparation express : montez d\'abord dans un véhicule.', kind: 'warning', duration: 2 }); return false; }
      v.health = 100; v.repair?.();
    }
    st.gauge -= a.cost;
    if (a.duration) { abil.until = game.time.now + a.duration; st.active = a.duration; }
    if (a.id === 'blackout') {
      if (game.world) game.world.hackUntil = game.time.now + a.duration;
      // feux au vert sur l'axe où roule Jade (le monde consulte world.forceGreen(tl, axis))
      if (game.world) game.world.forceGreen = (tl, axis) => {
        if (game.time.now >= (game.world.hackUntil ?? 0)) return false;
        const pl = game.player, o = pl?.vehicle?.object3d;
        const h = o ? pl.vehicle.heading : (pl?.heading ?? 0);
        const mine = Math.abs(Math.sin(h)) > Math.abs(Math.cos(h)) ? 'ew' : 'ns';
        return axis === mine && Math.hypot((tl.x ?? 0) - pl.position.x, (tl.z ?? 0) - pl.position.z) < 150;
      };
      if (game.police) { game.police.jammedUntil = game.time.now + a.duration; game.police.jam?.(a.duration); }
    }
    if (a.id === 'focus') game.time.setScale?.('focus', 0.5);
    bus.emit('ability:used', { id: a.id, name: a.name, duration: a.duration });
    bus.emit('notify', { text: `${a.name} !`, kind: 'success', duration: 2 });
    return true;
  }
  function updateAbility(dt) {
    const ch = CHARACTERS[profile.current], a = ch.ability, st = gp.ability;
    if (st.id !== a.id) { st.id = a.id; st.name = a.name; st.cost = a.cost; st.gauge = 1; }
    st.gauge = Math.min(1, st.gauge + (a.cost / a.cooldown) * dt);
    if (st.active > 0) {
      st.active = Math.max(0, abil.until - game.time.now);
      if (st.active === 0 && a.id === 'focus') game.time.setScale?.('focus', 1);
    }
    // résistance des véhicules de Malik
    const v = game.player?.vehicle;
    if (v) v.damageScale = ch.vehicleDamage ?? 1;
  }

  // ---------- boutiques ----------
  function shopCatalog(id) {
    if (id === 'clothes') {
      const items = [];
      for (const c of PALETTE) items.push({ id: `top:${c}`, group: 'Hauts', label: 'Haut', color: c, price: 40 });
      for (const c of PALETTE) items.push({ id: `bottom:${c}`, group: 'Bas', label: 'Bas', color: c, price: 40 });
      for (const c of PALETTE) items.push({ id: `shoes:${c}`, group: 'Chaussures', label: 'Chaussures', color: c, price: 30 });
      items.push({ id: 'armor', group: 'Protection', label: 'Gilet de protection (armure 100)', price: 150 });
      return { id, title: 'Prêt-à-Kuber', subtitle: 'Vêtements et protections', items };
    }
    if (id === 'garage') {
      const v = game.player?.vehicle;
      const dmg = v ? Math.max(0, 100 - (v.health ?? 100)) : 0;
      const items = [{ id: 'repair', group: 'Atelier', label: v ? `Réparer le véhicule (${Math.round(100 - dmg)} % d'état)` : 'Réparer (aucun véhicule)', price: Math.max(30, Math.round(dmg * 2)), disabled: !v }];
      for (const c of PAINTS) items.push({ id: `paint:${c}`, group: 'Peinture', label: 'Repeindre', color: c, price: 60, disabled: !v });
      for (const [k, l] of [['engine', 'Moteur'], ['brakes', 'Freins'], ['suspension', 'Suspension']]) items.push({ id: `upgrade:${k}`, group: 'Améliorations', label: `${l} (niveau +1)`, price: 300, disabled: !v });
      return { id, title: 'Chez Lou', subtitle: 'Garage : réparations, peinture, améliorations', items };
    }
    return null;
  }
  function buy(shopId, itemId) {
    const cat = shopCatalog(shopId), item = cat?.items.find((i) => i.id === itemId);
    if (!item) return { ok: false, message: 'Article introuvable.' };
    if (item.disabled) return { ok: false, message: 'Montez d\'abord dans un véhicule.' };
    if (!gp.spend(item.price, item.label)) return { ok: false, message: 'Fonds insuffisants.' };
    const [kind, arg] = itemId.split(':');
    const c = cur();
    if (['top', 'bottom', 'shoes'].includes(kind)) {
      c.outfit[kind] = arg;
      game.player?.setOutfit?.({ ...c.outfit });
      bus.emit('outfit:changed', { character: profile.current, outfit: { ...c.outfit } });
    } else if (kind === 'armor') { c.armor = 100; if (game.player) game.player.armor = 100; }
    else {
      const v = game.player?.vehicle;
      if (kind === 'repair') { if (v) { v.health = 100; v.repair?.(); } }
      if (kind === 'paint' && v) {
        paintVehicle(v, arg);
        // repeindre fait baisser la recherche (spec 9) : la police écoute vehicle:repainted (→ notifyRepaint)
        bus.emit('vehicle:repainted', { vehicle: v, color: arg });
      }
      if (kind === 'upgrade' && v) {
        v.upgrades = { ...(v.upgrades || {}), [arg]: ((v.upgrades || {})[arg] || 0) + 1 };
        v.applyUpgrades?.(v.upgrades);
      }
    }
    doSave();
    return { ok: true, message: `${item.label} acheté.` };
  }
  function paintVehicle(v, hex) {
    if (v.paint) return v.paint(hex);
    if (v.setColor) return v.setColor(hex);
    let hit = false;
    v.object3d?.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (/body|paint|carrosserie/i.test(m.name || '')) { m.color.set(hex); hit = true; }
    });
    if (!hit) v.object3d?.traverse((o) => { if (!hit && o.isMesh && o.material?.color && !/glass|window|wheel|tire|light/i.test(o.material.name || '')) { o.material = o.material.clone(); o.material.color.set(hex); } });
  }

  // ---------- marqueurs 3D (lieux de mission, boutiques, objectif) ----------
  const markerGroup = new THREE.Group(); markerGroup.name = 'marqueurs-gameplay';
  game.three.scene.add(markerGroup);
  const markerGeo = new THREE.CylinderGeometry(1.6, 1.6, 30, 24, 1, true);
  const ringGeo = new THREE.TorusGeometry(1.7, 0.12, 8, 32);
  let markerSig = '', markerObjs = [], tMark = 0;
  function currentMarkers() {
    const list = [];
    if (!active) {
      for (const m of MISSIONS) {
        if (!availableMissions(profile.missions, profile.current).includes(m)) continue;
        const p = place(m.giver);
        list.push({ x: p.x, z: p.z, color: '#ffd23f', label: m.title, kind: 'mission', id: m.id, radius: 3.4 });
      }
    } else {
      const t = active.runner.target;
      if (t) list.push({ x: t.x, z: t.z, color: '#38e8ff', label: active.def.title, kind: 'objective', radius: 0 });
    }
    for (const [id, label] of [['vetements', 'Boutique'], ['garage', 'Garage']]) {
      const p = place(id);
      // un marqueur de mission au même endroit prime : le jaune ne doit pas être recouvert par le rose
      if (list.some((m) => m.kind === 'mission' && dist2d(m, p) < 10)) continue;
      list.push({ x: p.x, z: p.z, color: id === 'garage' ? '#ff4fa3' : '#9ae66e', label, kind: 'shop', id, radius: 6 });
    }
    return list;
  }
  function updateMarkers(dt) {
    tMark -= dt;
    if (tMark <= 0) {
      tMark = 0.4;
      const list = currentMarkers();
      gp.markers = list;
      const sig = list.map((m) => `${m.kind}${m.id || ''}${Math.round(m.x)}${Math.round(m.z)}`).join('|');
      if (sig !== markerSig) {
        markerSig = sig;
        for (const o of markerObjs) { markerGroup.remove(o); o.traverse((c) => { c.material?.dispose?.(); }); }
        markerObjs = list.map((m) => {
          const col = new THREE.Color(m.color);
          const g = new THREE.Group();
          const beam = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
          beam.position.y = 15;
          const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: col }));
          ring.rotation.x = Math.PI / 2; ring.position.y = 0.2;
          g.add(beam, ring);
          g.position.set(m.x, groundY(m.x, m.z), m.z);
          markerGroup.add(g);
          return g;
        });
      }
    }
    const t = game.time.elapsed;
    markerObjs.forEach((g, i) => { g.children[1].scale.setScalar(1 + 0.12 * Math.sin(t * 3 + i)); });
  }

  // ---------- kubes ----------
  function initKubes() {
    try {
      for (const p of kubeList) {
        const q = game.world?.nearestRoadPoint?.(p);
        if (q && Number.isFinite(q.x)) { p.x = q.x + (rng() * 8 - 4); p.z = q.z + (rng() * 8 - 4); }
      }
    } catch { /* monde indisponible : positions brutes */ }
    kubeMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshStandardMaterial({ color: 0x38e8ff, emissive: 0x1aa6c0, emissiveIntensity: 1.2, roughness: 0.3 }), kubeList.length);
    kubeMesh.frustumCulled = false;
    game.three.scene.add(kubeMesh);
  }
  function updateKubes() {
    if (!kubeMesh) return;
    const p = game.player?.position, t = game.time.elapsed;
    kubeList.forEach((k, i) => {
      const got = profile.kubes.includes(i);
      if (!got && p && dist2d(p, k) < 2.6 && game.state === 'playing') {
        profile.kubes.push(i);
        gp.addMoney(25, 'kube');
        bus.emit('notify', { text: `Kube trouvé ! ${profile.kubes.length}/50`, kind: 'success', duration: 3 });
        if (profile.kubes.length === 50) gp.addMoney(1000, 'collection de kubes');
        for (const a of checkAchievements(profile)) bus.emit('notify', { text: `Succès : ${a.title}`, kind: 'success', duration: 4 });
      }
      kubeDummy.position.set(k.x, groundY(k.x, k.z) + 1.3 + Math.sin(t * 2 + i) * 0.15, k.z);
      kubeDummy.rotation.set(0.4, t + i, 0.3);
      kubeDummy.scale.setScalar(got ? 0 : 1);
      kubeDummy.updateMatrix();
      kubeMesh.setMatrixAt(i, kubeDummy.matrix);
    });
    kubeMesh.instanceMatrix.needsUpdate = true;
  }
  gp.kubePositions = kubeList;

  // ---------- interactions ----------
  let promptText = null;
  const setPrompt = (text) => { if (text !== promptText) { promptText = text; bus.emit('ui:prompt', { id: 'gameplay', text }); } };
  function nearMarker(kind) {
    const p = game.player?.position; if (!p) return null;
    return gp.markers.find((m) => m.kind === kind && dist2d(p, m) <= m.radius) || null;
  }
  function updateInteract() {
    const pl = game.player;
    if (game.state !== 'playing' || !pl) { setPrompt(null); return; }
    const onFoot = pl.state === 'onFoot';
    const shop = nearMarker('shop');
    const mis = onFoot && !active ? nearMarker('mission') : null;
    const veh = onFoot && game.vehicles?.nearestEnterable?.(pl.position, 3);
    if (mis && !veh) {
      setPrompt(`F : Parler (${mis.label})`);
      if (game.input.pressed('interact')) gp.startMission(mis.id);
    } else if (shop && (onFoot || pl.vehicle) && active?.runner?.step?.type !== 'say') setPrompt(`E : Entrer (${shop.label})`);
    else setPrompt(null);
  }
  globalThis.addEventListener?.('keydown', (e) => {
    if (e.repeat || game.state !== 'playing') return;
    const t = e.target?.tagName; if (t === 'INPUT' || t === 'TEXTAREA') return;
    if (e.code === 'KeyE') { const shop = nearMarker('shop'); if (shop) gp.openShop(shop.id); }
    if (e.code === 'KeyG') useAbility();
  });

  // ---------- respawn ----------
  function respawn(where, cost) {
    if (respawning) return;
    respawning = true;
    setTimeout(() => {
      const pl = game.player;
      const paid = Math.min(cost, cur().money);
      if (paid) gp.addMoney(-paid, where === 'hôpital' ? 'frais d\'hôpital' : 'amende');
      const p = place(where === 'hôpital' ? 'hopital' : 'commissariat');
      const spot = { x: p.x + 4, z: p.z + 6 };
      if (pl) {
        if (pl.vehicle) game.vehicles?.exit?.(pl);
        pl.teleport?.({ x: spot.x, y: groundY(spot.x, spot.z) + 1, z: spot.z });
        pl.health = 100; pl.revive?.();
        if (pl.state === 'ko' || pl.state === 'ragdoll') pl.state = 'onFoot';
      }
      game.police?.clear?.();
      bus.emit('player:respawn', { where, cost: paid });
      respawning = false;
    }, where === 'hôpital' ? 3200 : 2600);
  }
  bus.on('player:ko', () => respawn('hôpital', 200));
  bus.on('wanted:busted', () => respawn('commissariat', Math.min(500, Math.floor(cur().money * 0.1))));
  bus.on('wanted:changed', ({ level }) => { profile.stats.maxWanted = Math.max(profile.stats.maxWanted, level); });
  bus.on('npc:ko', () => { koCounter++; });
  bus.on('crime', ({ kind }) => { if (kind === 'assault') { koCounter++; gainStat(cur().stats, 'combat', 0.05); } });
  bus.on('ui:photo', () => { photos.count++; const p = game.player?.position; photos.last = p ? { x: p.x, z: p.z } : null; });
  bus.on('player:enterVehicle', ({ vehicle }) => { if (vehicle) vehicle.damageScale = CHARACTERS[profile.current].vehicleDamage ?? 1; });
  let reloading = null; // relecture du profil en cours après une reconnexion
  bus.on('net:status', (s) => {
    if (s?.connected && gp._wasDown) { gp._wasDown = false; reloading = loadProfile(game.net).then((p) => { if (p.updatedAt > profile.updatedAt) { profile = p; refreshMissions(); bus.emit('notify', { text: 'Profil resynchronisé.', kind: 'info', duration: 2.5 }); } }).catch(() => {}).finally(() => { reloading = null; }); }
    if (s && !s.connected) gp._wasDown = true;
  });

  // ---------- sauvegarde ----------
  let saveTimer = 0;
  function scheduleSave() { saveTimer = saveTimer || 8; }
  async function doSave() {
    saveTimer = 0;
    if (!loaded) return false; // ne jamais écraser une sauvegarde qu'on n'a pas encore lue
    if (reloading) await reloading; // reconnexion : relire d'abord, sinon on écraserait un profil serveur plus récent
    const p = game.player?.position, c = cur();
    if (p && game.state !== 'menu') { c.pos = { x: p.x, z: p.z }; c.armor = game.player.armor || 0; }
    return saveProfile(game.net, profile);
  }
  globalThis.addEventListener?.('pagehide', () => saveLocal(profile));
  globalThis.document?.addEventListener?.('visibilitychange', () => { if (document.hidden && game.state !== 'menu') saveLocal(profile); });

  // ---------- boucle ----------
  initKubes();
  refreshMissions();
  let last = null, autosave = 0;
  game.onUpdate((dt) => {
    updateMarkers(dt);
    if (cut) return;
    if (game.state !== 'playing') return;
    const pl = game.player;
    updateAbility(dt);
    updateActive(dt);
    updateKubes();
    updateInteract();
    if (saveTimer > 0 && (saveTimer -= dt) <= 0) doSave();
    if ((autosave += dt) > 25) { autosave = 0; doSave(); }
    profile.stats.playTime += dt;
    if (pl?.position) {
      const p = pl.position;
      if (last) {
        const d = Math.hypot(p.x - last.x, p.z - last.z);
        if (d < 50) {
          profile.stats.distance += d;
          if (game.input.isDown('sprint') && pl.state === 'onFoot') gainStat(cur().stats, 'endurance', 0.004 * dt);
        }
      }
      last = { x: p.x, z: p.z };
      if (pl.vehicle) {
        if (Math.abs(pl.vehicle.speed) > 40) gainStat(cur().stats, 'conduite', 0.003 * dt);
        // cascades : en l'air à vitesse élevée
        const vp = pl.vehicle.object3d?.position ?? p;
        const r = air.update(dt, vp.y - groundY(vp.x, vp.z) > 1.6, pl.vehicle.speed);
        if (r) {
          profile.stats.jumps++;
          gp.addMoney(r.bonus, 'cascade');
          bus.emit('stunt', { position: { x: vp.x, y: vp.y, z: vp.z }, air: r.air, bonus: r.bonus });
          bus.emit('notify', { text: `Cascade ! ${r.air.toFixed(1)} s en l'air (+${r.bonus} €)`, kind: 'success', duration: 3 });
        }
      }
    }
  }, 60);
  // la transition de caméra passe après la caméra du joueur (ordre 90)
  game.onUpdate((dt) => updateCut(dt), 96);
}
