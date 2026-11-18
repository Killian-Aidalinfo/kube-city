// RÉSEAU : client WebSocket v2, autres joueurs, reconnexion invisible, profil persisté dans Redis (spec 14).
// API publique : game.net (voir plus bas). Événement émis : net:status { connected, pod, version, reconnects, ping, leader, sync }.
// Autres événements : net:chat { from, text, ts }, net:emote { id, e }, net:event { from, kind, data }, net:message (tout message serveur non géré),
// net:profile { profile, reconnect } à chaque (re)connexion (profil relu depuis Redis), net:players quand la liste change.
import { createConnection } from './connection.js';
import { createRemotes } from './remote.js';
import { readState, readVehicle, readLook } from './local.js';

const SEND_HZ = 15;
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* stockage indisponible */ } return null; };

/** @param {object} game contexte (spec 3.1) */
export function install(game) {
  const id = (() => {
    let v = LS('kc.id');
    if (!v || !/^[a-z0-9-]{6,40}$/i.test(v)) { v = 'joueur-' + Math.random().toString(16).slice(2, 8); LS('kc.id', v); }
    return v;
  })();
  let name = LS('kc.name') || 'Joueur-' + id.slice(-3).toUpperCase();
  const players = new Map();
  const remotes = createRemotes(game, players);
  const status = { connected: false, pod: null, version: null, reconnects: 0, ping: 0, leader: null, sync: true, previousPod: null };
  const pending = new Map(); // rid -> résolution (profil)
  let rid = 0, everConnected = false, accum = 0, lastLook = '';

  const emitStatus = () => game.bus.emit('net:status', { ...status });
  const now = () => performance.now() / 1000;

  // ---------- Messages du serveur ----------
  function onMessage(m) {
    switch (m.t) {
      case 'welcome': {
        const re = everConnected;
        if (everConnected) status.reconnects++;
        everConnected = true;
        if (status.pod && status.pod !== m.pod) status.previousPod = status.pod;
        Object.assign(status, { connected: true, pod: m.pod, version: m.version, sync: m.sync !== false });
        net.id = m.id;
        emitStatus();
        game.bus.emit('net:profile', { profile: m.profile ?? null, reconnect: re });
        for (const c of m.chat || []) game.bus.emit('net:chat', { ...c, history: true });
        if (m.races) net.races = m.races;
        if (m.board) net.board = m.board;
        sendLook(true);
        pollInfo();
        break;
      }
      case 'snap': {
        const t = now();
        const ids = m.full ? new Set() : null;
        let added = false;
        for (const e of m.players || []) {
          if (e.id === net.id) continue;
          ids?.add(e.id);
          if (!players.has(e.id)) added = true;
          remotes.upsert(e, t);
        }
        if (ids) remotes.prune(ids); // liste complète : ceux qui manquent sont partis
        if (added) game.bus.emit('net:players', { count: players.size });
        break;
      }
      case 'gone': remotes.remove(m.id); game.bus.emit('net:players', { count: players.size }); break;
      case 'chat': game.bus.emit('net:chat', { ...m.msg }); break;
      case 'emote': remotes.emote(m.id, m.e); game.bus.emit('net:emote', { id: m.id, e: m.e }); break;
      case 'event': game.bus.emit('net:event', { from: m.from, kind: m.kind, data: m.data }); break;
      case 'sync': status.sync = m.ok; emitStatus(); break; // Redis en pause : le jeu continue, la synchro reprend seule
      case 'bye': break; // le serveur ferme ensuite la socket (1012) : la reconnexion s'en charge, sans rien dire au joueur
      case 'profile': case 'profile_saved': pending.get(m.rid)?.(m); pending.delete(m.rid); break;
      case 'race': case 'joined': case 'finish': case 'board': default:
        if (m.t === 'board') net.board = m.board;
        game.bus.emit('net:message', m);
    }
  }

  function onEvent(ev) {
    if (ev.type === 'ping') {
      status.ping = Math.round(ev.ms);
      emitStatus();
    } else if (ev.type === 'close') {
      if (status.connected) { status.connected = false; emitStatus(); } // l'icône clignote ; le jeu, lui, continue
      for (const [, resolve] of pending) resolve({ ok: false, profile: null });
      pending.clear();
    }
  }

  const conn = createConnection({
    url: () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
    hello: () => { const l = readLook(game); lastLook = JSON.stringify(l); const p = readState(game)?.p; return { id, name, ch: l.ch, outfit: l.outfit, ...(p ? { p } : {}) }; },
    onMessage, onEvent,
  });

  function sendLook(force) {
    const l = readLook(game), s = JSON.stringify(l);
    if (!force && s === lastLook) return;
    lastLook = s;
    conn.send({ t: 'look', ch: l.ch, outfit: l.outfit });
  }

  // Le leader IA est annoncé par /api/info (nom du pod) ; rafraîchi toutes les 3 s tant qu'on est connecté
  async function pollInfo() {
    try {
      const i = await (await fetch('/api/info', { cache: 'no-store' })).json();
      if (i.leader !== status.leader) { status.leader = i.leader; emitStatus(); }
    } catch { /* pod en cours de remplacement */ }
  }
  setInterval(() => { if (status.connected) pollInfo(); }, 3000);

  function request(msg) {
    return new Promise((resolve) => {
      const r = ++rid;
      pending.set(r, resolve);
      if (!conn.send({ ...msg, rid: r })) { pending.delete(r); return resolve({ ok: false, profile: null }); }
      setTimeout(() => { if (pending.delete(r)) resolve({ ok: false, profile: null }); }, 4000);
    });
  }

  // ---------- API publique ----------
  const net = {
    id,
    get name() { return name; },
    get connected() { return status.connected; },
    status,
    /** Autres joueurs et agents IA : Map id → { id, name, character, outfit, position, rotation, speed, anim, vehicle, bot, stars, … } */
    players,
    races: [], board: [],
    remotes,
    send(type, payload = {}) { return conn.send({ t: type, ...payload }); },
    connect() { conn.connect(); },
    setName(n) { name = String(n || '').slice(0, 20) || name; LS('kc.name', name); },
    sendChat(text) { return conn.send({ t: 'chat', text }); },
    sendEmote(e) { return conn.send({ t: 'emote', e }); },
    /** Événement partagé (course multijoueur, mission coopérative) : relayé à tous, reçu via le bus `net:event`. */
    sendEvent(kind, data) { return conn.send({ t: 'event', kind, data }); },
    /** Sauvegarde le profil dans Redis (clé par id joueur). Résout { ok } ; { ok:false } si hors ligne (le jeu garde alors localStorage). */
    async saveProfile(profile) { return (await request({ t: 'profile_save', profile })); },
    /** Relit le profil depuis Redis : l'objet, ou null (absent / hors ligne). */
    async loadProfile() { const r = await request({ t: 'profile_load' }); return r.ok ? r.profile : null; },
  };
  game.net = net;

  // ---------- Envoi de l'état local à 15 Hz + interpolation des autres ----------
  game.onUpdate((dt) => {
    remotes.update(dt, now());
    accum += dt;
    if (accum < 1 / SEND_HZ) return;
    accum %= 1 / SEND_HZ;
    if (!status.connected || game.state === 'menu') return;
    const s = readState(game);
    if (!s) return;
    const v = readVehicle(game);
    if (v) conn.send(v); // le véhicule part juste avant l'état : le serveur les publie ensemble
    conn.send(s);
  }, 50);

  game.bus.on('player:spawned', () => sendLook(false));
  game.bus.on('character:switch', () => sendLook(false));
  game.bus.on('character:outfit', () => sendLook(false));

  net.connect();
  window.addEventListener('beforeunload', () => conn.close());
}
