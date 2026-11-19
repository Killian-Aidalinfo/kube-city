// AUDIO (spec 13) : Web Audio démarré au premier geste, bus de mixage (musique, effets, ambiance),
// moteurs synthétisés, pneus, chocs, klaxon, sirène deux tons, pas, ambiance et 5 stations de radio procédurales.
import { engineParams, categoryOf, skidAmount } from './engine.js';
import { STATIONS, buildBar, midiToHz, TALK_LINES, mulberry32 } from './radio.js';

const SOUND_DIR = '/assets/sounds/';
const nums = (p, n, from = 0) => Array.from({ length: n }, (_, i) => `${p}${String(i + from).padStart(2, '0')}`);
// Nom logique → fichiers (le manifest indique que les chocs de voiture sont synthétisés)
const SAMPLES = {
  step: nums('rpg/footstep', 10), hit: ['rpg/chop'], clank: ['rpg/metalPot1', 'rpg/metalPot2', 'rpg/metalPot3'],
  coins: ['rpg/handleCoins', 'rpg/handleCoins2'], doorOpen: ['rpg/doorOpen_1', 'rpg/doorOpen_2'],
  doorClose: ['rpg/doorClose_1', 'rpg/doorClose_2'], cloth: ['rpg/cloth1', 'rpg/cloth2', 'rpg/cloth3'],
  ui_click: ['ui/click_001', 'ui/click_002'], ui_ok: ['ui/confirmation_001'], ui_err: ['ui/error_001'],
  ui_open: ['ui/open_001'], ui_close: ['ui/close_001'], ui_select: ['ui/select_001'], ui_back: ['ui/back_001'],
};
// le moteur ne doit pas écraser le reste : à plein gaz il se situe autour de -24 dBFS RMS (mesuré par scripts/playtest/audio.mjs)
const ENGINE_TRIM = 0.15;
const MAX_ENGINES = 3, MAX_SIRENS = 2, HEAR = 45;

/** @param {object} game contexte (spec 3.1) */
export function install(game) {
  let ctx = null, meter, master, duck, buses = {}, noiseBuf = null, listenerPos = { x: 0, y: 0, z: 0 };
  const bufferCache = new Map();
  const rng = mulberry32(2024);

  const audio = {
    get ctx() { return ctx; },
    stations: STATIONS.map((s) => s.name),
    station: -1, // -1 = radio éteinte
    /** Joue un son logique (échantillon CC0) ou synthétisé ('crash', 'jingle'). opts : { volume, position, bus, rate, intensity }. */
    play(name, opts = {}) {
      if (!ctx) return;
      if (name === 'crash') return crash(opts.intensity ?? 0.6, opts.position);
      if (name === 'jingle') return jingle(opts.kind || 'success');
      const list = SAMPLES[name];
      if (!list) return;
      const file = list[(rng() * list.length) | 0];
      loadBuffer(file).then((buf) => {
        if (!buf || !ctx) return;
        const src = ctx.createBufferSource();
        src.buffer = buf; src.playbackRate.value = (opts.rate ?? 1) * (0.94 + rng() * 0.12);
        const g = ctx.createGain(); g.gain.value = opts.volume ?? 1;
        src.connect(g);
        g.connect(opts.position ? panner(opts.position, buses[opts.bus || 'sfx']) : buses[opts.bus || 'sfx']);
        src.start();
      });
    },
    /** Joue un son à une position du monde (spatialisé). */
    playAt(name, position, opts = {}) { audio.play(name, { ...opts, position }); },
    /** Choisit la station (0..4) ; -1 ou hors plage éteint la radio. */
    setRadio(i) {
      const next = Number.isInteger(i) && i >= 0 && i < STATIONS.length ? i : -1;
      if (next === audio.station) return;
      audio.station = next;
      radio.start(next);
      if (next >= 0) game.bus.emit('radio:station', { name: STATIONS[next].name, genre: STATIONS[next].genre, index: next });
      else game.bus.emit('radio:station', { name: 'Radio éteinte', genre: '', index: -1 });
    },
    nextStation() { audio.setRadio(audio.station + 1 >= STATIONS.length ? -1 : audio.station + 1); },
    prevStation() { audio.setRadio(audio.station < 0 ? STATIONS.length - 1 : audio.station - 1); },
    /** Volume 0..1 par bus : 'music' | 'sfx' | 'ambient'. */
    setVolume(bus, v) { if (buses[bus]) buses[bus].gain.value = Math.max(0, Math.min(1, v)); },
    /** Niveau de sortie courant : { peak, rms } (0..1) ; peak ≥ 1 = saturation. */
    level() {
      if (!meter) return { peak: 0, rms: 0 };
      const d = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(d);
      let pk = 0, sq = 0;
      for (const x of d) { const a = Math.abs(x); if (a > pk) pk = a; sq += x * x; }
      return { peak: pk, rms: Math.sqrt(sq / d.length) };
    },
    /** Démarre le contexte (appelé au premier geste). */
    unlock() { if (!ctx) init(); else if (ctx.state === 'suspended') ctx.resume(); },
  };
  game.audio = audio;

  // ---------- initialisation (premier geste) ----------
  function init() {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    duck = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    // limiteur de sécurité : seuil bas, rapport élevé, attaque rapide (aucune crête > 0 dBFS)
    comp.threshold.value = -20; comp.knee.value = 8; comp.ratio.value = 12; comp.attack.value = 0.002; comp.release.value = 0.2;
    master.gain.value = 0.85;
    // sonde de niveau (après compresseur) : sert aux mesures de mixage (audio.level())
    meter = ctx.createAnalyser(); meter.fftSize = 2048;
    duck.connect(master); master.connect(comp); comp.connect(ctx.destination); comp.connect(meter);
    for (const b of ['music', 'sfx', 'ambient']) { buses[b] = ctx.createGain(); buses[b].connect(duck); }
    applySettings();
    // bruit blanc partagé (2 s en boucle)
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rng() * 2 - 1;
    ambience.start();
    tires.start();
    if (audio.station >= 0) radio.start(audio.station);
    else if (game.player?.vehicle && audio.lastStation !== -1) audio.setRadio(0);
  }
  const applySettings = () => {
    const s = game.settings;
    const m = s.get('volumeMaster') ?? 1;
    buses.music.gain.value = (s.get('volumeMusic') ?? 0.6) * m;
    buses.sfx.gain.value = (s.get('volumeSfx') ?? 0.8) * m;
    buses.ambient.gain.value = (s.get('volumeSfx') ?? 0.8) * 0.7 * m;
  };
  game.settings.onChange((k) => { if (ctx && (k === 'volumeMaster' || k === 'volumeMusic' || k === 'volumeSfx' || k === '*')) applySettings(); });
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) globalThis.addEventListener?.(ev, () => audio.unlock(), { once: false, passive: true });

  // ---------- utilitaires ----------
  async function loadBuffer(file) {
    if (!bufferCache.has(file)) bufferCache.set(file, game.assets.loadAudio(`${SOUND_DIR}${file}.ogg`, ctx).catch(() => null));
    return bufferCache.get(file);
  }
  function panner(pos, dest) {
    const p = ctx.createPanner();
    p.panningModel = 'equalpower'; p.distanceModel = 'inverse';
    p.refDistance = 6; p.maxDistance = 160; p.rolloffFactor = 1.3;
    setPos(p, pos);
    p.connect(dest);
    return p;
  }
  function setPos(p, pos) {
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y ?? 0; p.positionZ.value = pos.z; }
    else p.setPosition?.(pos.x, pos.y ?? 0, pos.z);
  }
  function noiseSource(loop = true) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = loop;
    s.loopStart = rng() * 1.5; return s;
  }
  /** Note simple : oscillateur → filtre → enveloppe. */
  function tone(dest, { freq, t, dur, type = 'sine', vol = 0.2, attack = 0.005, release = 0.05, cutoff = 0, freqEnd = 0 }) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.setTargetAtTime(0.0001, t + Math.max(attack, dur - release), release / 3);
    let node = o;
    if (cutoff) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; o.connect(f); node = f; }
    node.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + release * 2);
    return o;
  }
  function noiseHit(dest, { t, dur, vol, type = 'highpass', freq = 6000, q = 0.7 }) {
    const s = noiseSource(false); const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, rng()); s.stop(t + dur + 0.02);
  }

  // ---------- chocs, jingles ----------
  function crash(intensity, pos) {
    const dest = pos ? panner(pos, buses.sfx) : buses.sfx;
    const t = ctx.currentTime, v = Math.min(1, 0.25 + intensity);
    noiseHit(dest, { t, dur: 0.25 + intensity * 0.35, vol: 0.45 * v, type: 'lowpass', freq: 900 + intensity * 1400 });
    tone(dest, { freq: 130, freqEnd: 40, t, dur: 0.3, type: 'sine', vol: 0.55 * v });
    if (intensity > 0.35) audio.play('clank', { volume: 0.6 * v, position: pos });
  }
  function jingle(kind) {
    const t = ctx.currentTime + 0.02;
    if (kind === 'success') {
      // fanfare courte : arpège majeur puis accord tenu (triangle + octave sinus), dans l'esprit d'une validation de pipeline
      [0, 4, 7, 12].forEach((n, i) => tone(buses.sfx, { freq: midiToHz(72 + n), t: t + i * 0.1, dur: 0.2, type: 'triangle', vol: 0.2, release: 0.1 }));
      [0, 4, 7, 16].forEach((n) => {
        tone(buses.sfx, { freq: midiToHz(72 + n), t: t + 0.46, dur: 0.7, type: 'triangle', vol: 0.12, attack: 0.01, release: 0.5 });
        tone(buses.sfx, { freq: midiToHz(84 + n), t: t + 0.46, dur: 0.5, type: 'sine', vol: 0.04, release: 0.4 });
      });
      noiseHit(buses.sfx, { t: t + 0.46, dur: 0.25, vol: 0.05, freq: 8000 });
      return;
    }
    const seq = kind === 'fail' ? [7, 3, 0, -5] : [0, 7];
    seq.forEach((n, i) => tone(buses.sfx, { freq: midiToHz(72 + n), t: t + i * 0.11, dur: 0.22, type: 'triangle', vol: 0.22, release: 0.12 }));
  }

  // ---------- ambiance : circulation lointaine, pluie, mouettes ----------
  const ambience = {
    traffic: null, rain: null, night: null, nightLfo: null, nextGull: 0,
    start() {
      const mk = (type, freq, vol) => {
        const s = noiseSource(); const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
        const g = ctx.createGain(); g.gain.value = vol; s.connect(f); f.connect(g); g.connect(buses.ambient); s.start(); return g;
      };
      this.traffic = mk('lowpass', 320, 0.05);
      // grillons de nuit : bruit étroit vers 4,6 kHz haché par un LFO
      const cs = noiseSource(); const cf = ctx.createBiquadFilter(); cf.type = 'bandpass'; cf.frequency.value = 4600; cf.Q.value = 14;
      const cg = ctx.createGain(); cg.gain.value = 0; const mod = ctx.createGain(); mod.gain.value = 1;
      this.nightLfo = ctx.createOscillator(); this.nightLfo.type = 'square'; this.nightLfo.frequency.value = 6;
      const lg = ctx.createGain(); lg.gain.value = 0.5; this.nightLfo.connect(lg); lg.connect(mod.gain);
      cs.connect(cf); cf.connect(mod); mod.connect(cg); cg.connect(buses.ambient); cs.start(); this.nightLfo.start(); this.night = cg;
      this.rain = mk('highpass', 1800, 0);
    },
    update(dt, t) {
      const night = game.time.dayTime > 22 || game.time.dayTime < 5;
      const pos = game.player?.position;
      let beach = false;
      try { beach = /plage/i.test(game.world?.district?.(pos.x, pos.z)?.name || ''); } catch { /* monde absent */ }
      const rainAmt = Math.max(0, Math.min(1, game.world?.weather?.rain ?? 0)); // 0..1 réel (world/weather.js)
      this.traffic.gain.setTargetAtTime(night ? 0.03 : 0.06, t, 1);
      this.rain.gain.setTargetAtTime(rainAmt * 0.09, t, 1.5);
      // nuit : grillons (grésillement aigu modulé) ; jour : rien
      this.night.gain.setTargetAtTime(night && !beach ? 0.012 : 0, t, 2);
      this.nightLfo.frequency.setTargetAtTime(6 + Math.sin(t / 7) * 1.5, t, 1);
      if (beach && t > this.nextGull) {
        this.nextGull = t + 4 + rng() * 6;
        const p = { x: pos.x + (rng() - 0.5) * 60, y: 15, z: pos.z + (rng() - 0.5) * 60 };
        const d = panner(p, buses.ambient);
        tone(d, { freq: 1500, freqEnd: 900, t, dur: 0.35, type: 'sawtooth', vol: 0.05, cutoff: 3000 });
        tone(d, { freq: 1700, freqEnd: 1100, t: t + 0.4, dur: 0.3, type: 'sawtooth', vol: 0.04, cutoff: 3000 });
      }
    },
  };

  // ---------- crissement de pneus ----------
  const tires = {
    gain: null, filter: null,
    start() {
      const s = noiseSource(); this.filter = ctx.createBiquadFilter(); this.filter.type = 'bandpass'; this.filter.Q.value = 3; this.filter.frequency.value = 1800;
      this.gain = ctx.createGain(); this.gain.gain.value = 0; s.connect(this.filter); this.filter.connect(this.gain); this.gain.connect(buses.sfx); s.start();
    },
    update(t, v) {
      let a = 0;
      if (v) {
        a = skidAmount({ speed: v.speed, steer: game.input.axis('moveX'), handbrake: game.input.isDown('handbrake'), slip: v.skid ?? v.slip });
        this.filter.frequency.setTargetAtTime(1500 + Math.min(1, Math.abs(v.speed) / 150) * 1200, t, 0.1);
      }
      this.gain.gain.setTargetAtTime(a * 0.22, t, 0.06);
    },
  };

  // ---------- moteurs et sirènes (voix par véhicule) ----------
  const engines = new Map(), sirens = new Map();
  function makeEngine(vehicle, own) {
    const out = ctx.createGain(); out.gain.value = 0;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.Q.value = 2.5;
    const a = ctx.createOscillator(), b = ctx.createOscillator(), sub = ctx.createOscillator();
    const subG = ctx.createGain(); const bG = ctx.createGain(); bG.gain.value = 0.5;
    a.connect(filt); b.connect(bG); bG.connect(filt); sub.connect(subG); subG.connect(filt); filt.connect(out);
    const cat = categoryOf(vehicle.type);
    a.type = 'sawtooth'; b.type = 'square'; sub.type = 'sine';
    const dest = own ? buses.sfx : panner(vehicle.object3d?.position ?? listenerPos, buses.sfx);
    out.connect(dest);
    a.start(); b.start(); sub.start();
    return { vehicle, own, cat, a, b, sub, subG, filt, out, pan: own ? null : dest, stop() { for (const o of [a, b, sub]) { try { o.stop(); } catch { /* déjà arrêté */ } } out.disconnect(); } };
  }
  function makeSiren(vehicle, own) {
    const o = ctx.createOscillator(); o.type = 'triangle';
    const o2 = ctx.createOscillator(); o2.type = 'square';
    const g = ctx.createGain(); g.gain.value = 0; const g2 = ctx.createGain(); g2.gain.value = 0.25;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600;
    o.connect(f); o2.connect(g2); g2.connect(f); f.connect(g);
    const dest = own ? buses.sfx : panner(vehicle.object3d?.position ?? listenerPos, buses.sfx);
    g.connect(dest); o.start(); o2.start();
    return { vehicle, own, o, o2, g, pan: own ? null : dest, lastDist: 0, stop() { try { o.stop(); o2.stop(); } catch { /* arrêté */ } g.disconnect(); } };
  }
  const distTo = (v) => { const p = v.object3d?.position; return p ? Math.hypot(p.x - listenerPos.x, p.z - listenerPos.z) : Infinity; };
  const prune = (map, keep) => { for (const [k, v] of map) if (!keep.has(k)) { v.stop(); map.delete(k); } };

  function updateVehicles(dt, t) {
    const player = game.player, mine = player?.vehicle;
    const list = game.vehicles?.list || [];
    const near = list.filter((v) => v !== mine && v.object3d && v.engineOn !== false && distTo(v) < HEAR && (v.speed !== undefined)).sort((a, b) => distTo(a) - distTo(b)).slice(0, MAX_ENGINES);
    const keepE = new Set();
    for (const v of [mine, ...near].filter(Boolean)) {
      keepE.add(v.id ?? v);
      let e = engines.get(v.id ?? v);
      if (!e) engines.set(v.id ?? v, (e = makeEngine(v, v === mine)));
      const own = v === mine;
      const throttle = own ? Math.max(0, game.input.axis('moveY')) : Math.min(1, 0.3 + Math.abs(v.speed || 0) / 120);
      const p = engineParams(e.cat, v.speed || 0, throttle);
      const on = v.engineOn !== false && (own || game.state !== 'paused');
      e.a.frequency.setTargetAtTime(p.freq, t, 0.05);
      e.b.frequency.setTargetAtTime(p.freq * 1.005, t, 0.05);
      e.sub.frequency.setTargetAtTime(p.freq * 0.5, t, 0.05);
      e.subG.gain.setTargetAtTime(p.sub * 0.8, t, 0.1);
      e.filt.frequency.setTargetAtTime(p.cutoff, t, 0.06);
      e.out.gain.setTargetAtTime(on ? p.gain * ENGINE_TRIM * (own ? 1 : 0.8) : 0, t, 0.1);
      if (e.pan && v.object3d) setPos(e.pan, v.object3d.position);
    }
    prune(engines, keepE);

    // sirènes : véhicule du joueur + les plus proches avec siren=true
    const sir = list.filter((v) => v.siren && v.object3d && distTo(v) < 130).sort((a, b) => distTo(a) - distTo(b)).slice(0, MAX_SIRENS);
    const keepS = new Set();
    const hi = Math.floor(t / 0.55) % 2 === 0;
    for (const v of sir) {
      keepS.add(v.id ?? v);
      let s = sirens.get(v.id ?? v);
      const own = v === mine;
      if (!s) sirens.set(v.id ?? v, (s = makeSiren(v, own)));
      const d = distTo(v);
      // doppler simple : la hauteur varie selon la vitesse d'approche
      const vr = dt > 0 && s.lastDist ? (d - s.lastDist) / dt : 0; s.lastDist = d;
      const dop = 343 / (343 + Math.max(-60, Math.min(60, vr)));
      const f = (hi ? 960 : 720) * (own ? 1 : dop);
      s.o.frequency.setTargetAtTime(f, t, 0.04); s.o2.frequency.setTargetAtTime(f * 2, t, 0.04);
      s.g.gain.setTargetAtTime(own ? 0.07 : 0.14 * Math.max(0.1, 1 - d / 130), t, 0.1);
      if (s.pan) setPos(s.pan, v.object3d.position);
    }
    prune(sirens, keepS);

    tires.update(t, mine);
    horn.update(t, !!mine && game.input.isDown('horn'));
  }

  // klaxon : deux fréquences en quinte, tenues tant que la touche est maintenue
  const horn = {
    g: null, on: false,
    update(t, wanted) {
      if (!this.g) {
        this.g = ctx.createGain(); this.g.gain.value = 0;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800; f.connect(this.g); this.g.connect(buses.sfx);
        for (const hz of [415, 523]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = hz; o.connect(f); o.start(); }
      }
      this.g.gain.setTargetAtTime(wanted ? 0.09 : 0, t, 0.015);
    },
  };

  // ---------- pas ----------
  let stepTimer = 0;
  function updateFootsteps(dt) {
    const p = game.player;
    if (!p || p.state !== 'onFoot') { stepTimer = 0; return; }
    const sp = Math.hypot(p.velocity?.x || 0, p.velocity?.z || 0);
    if (sp < 0.8) { stepTimer = 0; return; }
    stepTimer -= dt;
    if (stepTimer <= 0) {
      stepTimer = sp > 6 ? 0.3 : sp > 3 ? 0.4 : 0.52;
      audio.play('step', { volume: Math.min(0.5, 0.2 + sp * 0.04) });
    }
  }

  // ---------- radio ----------
  const radio = {
    gain: null, timer: null, nextTime: 0, step: 0, bar: 0, events: [], station: null, nextTalk: 0, seed: 1,
    start(i) {
      this.stop();
      if (!ctx || i < 0) return;
      this.station = STATIONS[i];
      this.gain = ctx.createGain(); this.gain.gain.value = 0;
      this.gain.gain.setTargetAtTime(1, ctx.currentTime + 0.25, 0.2);
      // distorsion légère pour la station rock
      if (this.station.id === 'rock') { this.dist = ctx.createWaveShaper(); this.dist.curve = distCurve(40); this.dist.connect(this.gain); }
      else this.dist = null;
      this.gain.connect(buses.music);
      // grésillement de changement de station puis jingle
      noiseHit(buses.music, { t: ctx.currentTime, dur: 0.22, vol: 0.18, type: 'bandpass', freq: 2200 });
      const t0 = ctx.currentTime + 0.25;
      [0, 7, 12].forEach((n, k) => tone(this.gain, { freq: midiToHz(this.station.root + 24 + n), t: t0 + k * 0.09, dur: 0.18, type: 'triangle', vol: 0.18 }));
      this.nextTime = t0 + 0.5; this.step = 0; this.bar = 0; this.seed = 1 + ((Math.random() * 1000) | 0);
      this.events = buildBar(this.station, 0, this.seed);
      this.nextTalk = game.time.now + 3;
      this.timer = setInterval(() => this.tick(), 40);
    },
    stop() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      if (this.gain) { const g = this.gain; g.gain.setTargetAtTime(0, ctx.currentTime, 0.05); setTimeout(() => g.disconnect(), 400); }
      this.gain = null; this.station = null;
    },
    tick() {
      if (!ctx || !this.station || !this.gain) return;
      const st = this.station, sd = 60 / st.bpm / 4;
      while (this.nextTime < ctx.currentTime + 0.18) {
        const swing = this.step % 2 === 1 ? st.swing * sd * 0.6 : 0;
        for (const e of this.events) if (Math.floor(e.t) === this.step) this.play(e, this.nextTime + swing, sd);
        this.nextTime += sd; this.step++;
        if (this.step >= 16) { this.step = 0; this.bar++; this.events = buildBar(st, this.bar, this.seed); }
      }
    },
    play(e, t, sd) {
      const st = this.station, out = this.gain, dur = e.dur * sd, v = e.vel;
      if (!st || !out) return;
      const hz = e.midi !== undefined ? midiToHz(e.midi) : 0;
      switch (e.kind) {
        case 'kick': tone(out, { freq: 150, freqEnd: 42, t, dur: 0.16, vol: 0.85 * v, release: 0.08 }); break;
        case 'snare': noiseHit(out, { t, dur: 0.16, vol: 0.28 * v, type: 'bandpass', freq: 1900, q: 0.8 }); tone(out, { freq: 200, freqEnd: 140, t, dur: 0.09, type: 'triangle', vol: 0.25 * v }); break;
        case 'clap': for (let k = 0; k < 3; k++) noiseHit(out, { t: t + k * 0.012, dur: 0.07, vol: 0.2 * v, type: 'bandpass', freq: 1500, q: 1.2 }); break;
        case 'hat': noiseHit(out, { t, dur: 0.045, vol: 0.12 * v, freq: 7500 }); break;
        case 'ohat': noiseHit(out, { t, dur: 0.18, vol: 0.12 * v, freq: 7000 }); break;
        case 'bass': tone(out, { freq: hz, t, dur, type: st.id === 'lofi' || st.id === 'talk' ? 'triangle' : 'sawtooth', vol: 0.28 * v, cutoff: 500, release: 0.06 }); break;
        case 'acid': tone(out, { freq: hz, t, dur: dur * 0.9, type: 'sawtooth', vol: 0.2 * v, cutoff: 700 + (this.bar % 8) * 220, release: 0.03 }); break;
        case 'pad': tone(out, { freq: hz, t, dur, type: 'sawtooth', vol: 0.05 * v, attack: 0.4, release: 0.6, cutoff: 1400 }); break;
        case 'arp': tone(out, { freq: hz, t, dur: dur * 1.4, type: 'square', vol: 0.06 * v, cutoff: 2600, release: 0.06 }); break;
        case 'lead': tone(this.dist || out, { freq: hz, t, dur: dur * 1.2, type: st.id === 'lofi' ? 'sine' : st.id === 'rock' ? 'sawtooth' : 'square', vol: (st.id === 'lofi' ? 0.12 : 0.08) * v, cutoff: 3200, release: 0.1 }); break;
        case 'power': [0, 7].forEach((n) => tone(this.dist, { freq: midiToHz(e.midi + n), t, dur: dur * 0.9, type: 'sawtooth', vol: 0.05 * v, cutoff: 2200, release: 0.04 })); break;
        case 'keys': tone(out, { freq: hz, t, dur, type: 'sine', vol: 0.09 * v, attack: 0.01, release: 0.4 }); tone(out, { freq: hz * 2, t, dur: dur * 0.5, type: 'sine', vol: 0.025 * v }); break;
        case 'stab': tone(out, { freq: hz, t, dur, type: 'sawtooth', vol: 0.07 * v, cutoff: 1800 }); break;
        default: break;
      }
    },
  };
  function distCurve(k) {
    const n = 256, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; c[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x)); }
    return c;
  }

  // Talk-show : texte qui défile en sous-titres tant que la station est active
  function updateTalk() {
    if (audio.station !== 4 || game.time.now < radio.nextTalk) return;
    const [speaker, text] = TALK_LINES[(rng() * TALK_LINES.length) | 0];
    radio.nextTalk = game.time.now + 9 + rng() * 5;
    game.bus.emit('subtitle', { speaker: `Radio · ${speaker}`, text, duration: 7 });
    // murmure : bruit filtré modulé façon voix
    if (ctx && radio.gain) for (let i = 0; i < 14; i++) noiseHit(radio.gain, { t: ctx.currentTime + i * 0.28 + rng() * 0.1, dur: 0.2, vol: 0.05, type: 'bandpass', freq: 500 + rng() * 900, q: 4 });
  }

  // ---------- événements du jeu ----------
  const bus = game.bus;
  bus.on('player:enterVehicle', () => { audio.play('doorClose', { volume: 0.7 }); if (audio.station < 0 && audio.lastStation !== -1) audio.setRadio(audio.lastStation ?? 0); });
  bus.on('player:exitVehicle', () => { audio.play('doorOpen', { volume: 0.7 }); audio.lastStation = audio.station; audio.setRadio(-1); });
  bus.on('vehicle:collision', ({ vehicle, impulse }) => {
    const k = Math.min(1, (impulse || 0) / 6000);
    if (k < 0.12) return;
    const pos = vehicle?.object3d?.position;
    if (vehicle === game.player?.vehicle || (pos && distTo(vehicle) < 60)) audio.play('crash', { intensity: k, position: vehicle === game.player?.vehicle ? null : pos });
  });
  // klaxon des PNJ : deux notes courtes, spatialisées ; le joueur a son propre klaxon continu
  bus.on('vehicle:horn', ({ vehicle, npc }) => {
    if (!npc || !ctx || !vehicle?.object3d || distTo(vehicle) > 90) return;
    const t = ctx.currentTime, g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1800;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07, t + 0.02); g.gain.setValueAtTime(0.07, t + 0.38); g.gain.linearRampToValueAtTime(0, t + 0.45);
    lp.connect(g); g.connect(panner(vehicle.object3d.position, buses.sfx));
    const base = vehicle.type === 'police' ? 1.1 : 0.9 + (((Number(vehicle.id) || 1) * 37) % 20) / 100; // timbre propre à chaque voiture
    for (const hz of [415 * base, 523 * base]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = hz; o.connect(lp); o.start(t); o.stop(t + 0.5); }
  });
  bus.on('player:damaged', () => audio.play('hit', { volume: 0.6 }));
  bus.on('money:changed', ({ delta }) => { if (delta > 0) audio.play('coins', { volume: 0.5 }); });
  bus.on('notify', ({ kind }) => audio.play(kind === 'danger' ? 'ui_err' : kind === 'success' ? 'ui_ok' : 'ui_click', { volume: 0.35 }));
  bus.on('mission:passed', () => audio.play('jingle', { kind: 'success' }));
  bus.on('mission:failed', () => audio.play('jingle', { kind: 'fail' }));
  bus.on('wanted:changed', ({ level, previous }) => { if (level > previous) audio.play('jingle', { kind: 'alert' }); });
  bus.on('ui:sound', ({ name, volume }) => audio.play(name, { volume }));

  // ---------- mise à jour (après la caméra : ordre 95) ----------
  game.onUpdate((dt) => {
    if (!ctx) return;
    const t = ctx.currentTime;
    // écouteur = caméra
    const cam = game.three.camera;
    if (cam) {
      const L = ctx.listener, p = cam.position, f = { x: 0, y: 0, z: -1 };
      const e = cam.matrixWorld.elements;
      f.x = -e[8]; f.y = -e[9]; f.z = -e[10];
      listenerPos = { x: p.x, y: p.y, z: p.z };
      if (L.positionX) {
        L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
        L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
      } else { L.setPosition?.(p.x, p.y, p.z); L.setOrientation?.(f.x, f.y, f.z, 0, 1, 0); }
    }
    duck.gain.setTargetAtTime(game.state === 'paused' ? 0.25 : 1, t, 0.1);
    updateVehicles(dt, t);
    updateFootsteps(dt);
    ambience.update(dt, t);
    // radio : touches R (suivante) en véhicule
    if (game.player?.vehicle && game.state === 'playing') {
      if (game.input.pressed('radioNext')) audio.nextStation();
      else if (game.input.pressed('radioPrev')) audio.prevStation();
    }
    updateTalk();
  }, 95, { real: true });
}
