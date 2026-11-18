// Tests du client réseau : interpolation, reconnexion (attente aléatoire croissante), lecture de l'état local.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushSample, sampleAt, DELAY, TELEPORT } from '../client/src/net/interp.js';
import { backoffDelay, createConnection } from '../client/src/net/connection.js';
import { readState, readVehicle, animOf } from '../client/src/net/local.js';

test('interpolation : milieu entre deux échantillons, cap par le plus court chemin', () => {
  const buf = [];
  pushSample(buf, 1.0, { p: [0, 0, 0], r: 3.0 });
  pushSample(buf, 1.1, { p: [2, 0, 0], r: -3.0 });
  const s = sampleAt(buf, 1.05);
  assert.ok(Math.abs(s.p[0] - 1) < 1e-9);
  assert.ok(Math.abs(Math.cos(s.r) + 1) < 0.01, 'passe par ±π, pas par 0'); // 3,0 -> -3,0 en passant par π
  assert.equal(DELAY, 0.1);
});

test('interpolation : extrapolation courte puis arrêt', () => {
  const buf = [];
  pushSample(buf, 1, { p: [0, 0, 0], vel: [10, 0, 0] });
  assert.ok(Math.abs(sampleAt(buf, 1.1).p[0] - 1) < 1e-9);
  assert.ok(Math.abs(sampleAt(buf, 5).p[0] - 2.5) < 1e-9); // plafonnée à 0,25 s
});

test('interpolation : téléportation au-delà de 10 m', () => {
  const buf = [];
  pushSample(buf, 1, { p: [0, 0, 0] });
  pushSample(buf, 1.1, { p: [TELEPORT + 1, 0, 0] });
  assert.equal(buf.length, 1);
  assert.equal(sampleAt(buf, 0.5).p[0], TELEPORT + 1);
});

test('interpolation : quaternions (slerp) normalisés', () => {
  const buf = [];
  const h = Math.SQRT1_2;
  pushSample(buf, 0, { p: [0, 0, 0], q: [0, 0, 0, 1] });
  pushSample(buf, 1, { p: [1, 0, 0], q: [0, h, 0, h] });
  const q = sampleAt(buf, 0.5).q;
  assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-9);
  assert.ok(Math.abs(q[1] - Math.sin(Math.PI / 8)) < 1e-6);
});

test('attente de reconnexion : aléatoire, croissante, plafonnée', () => {
  assert.ok(backoffDelay(0, () => 0) >= 100);
  assert.ok(backoffDelay(3, () => 1) > backoffDelay(0, () => 1));
  assert.ok(backoffDelay(30, () => 1) <= 5000);
  assert.notEqual(backoffDelay(4, () => 0.2), backoffDelay(4, () => 0.8));
});

// Fausse WebSocket pilotable
function fakeEnv() {
  const socks = [];
  class WS { constructor(u) { this.url = u; this.sent = []; this.readyState = 0; socks.push(this); } send(s) { this.sent.push(JSON.parse(s)); } close() { this.readyState = 3; } }
  const timers = []; let id = 0;
  const T = {
    setTimeout: (fn, ms) => { timers.push({ id: ++id, fn, ms }); return id; }, clearTimeout: (i) => { const k = timers.findIndex((t) => t.id === i); if (k >= 0) timers.splice(k, 1); },
    setInterval: () => ++id, clearInterval() {},
  };
  const events = [], msgs = [];
  const conn = createConnection({ url: () => 'ws://x/ws', hello: () => ({ id: 'joueur-abc123', name: 'T', ch: 'ines' }), onMessage: (m) => msgs.push(m), onEvent: (e) => events.push(e), WS, timers: T, rand: () => 0.5 });
  const open = (s) => { s.readyState = 1; s.onopen(); };
  const close = (s, code = 1012) => { s.readyState = 3; s.onclose({ code }); };
  return { socks, timers, events, msgs, conn, open, close };
}

test('connexion : hello v2, reconnexion automatique avec re=true, file ignorée hors ligne', () => {
  const e = fakeEnv();
  e.conn.connect();
  assert.equal(e.conn.send({ t: 'chat' }), false); // pas encore ouverte
  e.open(e.socks[0]);
  assert.deepEqual({ t: e.socks[0].sent[0].t, v: e.socks[0].sent[0].v, re: e.socks[0].sent[0].re }, { t: 'hello', v: 2, re: false });
  assert.equal(e.conn.send({ t: 'chat' }), true);
  e.close(e.socks[0]); // pod tué : 1012
  assert.equal(e.timers.length, 1, 'une reprise est planifiée');
  e.timers[0].fn();
  e.open(e.socks[1]);
  assert.equal(e.socks[1].sent[0].re, true);
  assert.equal(e.events.filter((x) => x.type === 'open').length, 2);
});

test('connexion : le code 4001 (protocole refusé) arrête les tentatives', () => {
  const e = fakeEnv();
  e.conn.connect(); e.open(e.socks[0]); e.close(e.socks[0], 4001);
  assert.equal(e.timers.length, 0);
});

test('connexion : pong -> ping mesuré, autres messages transmis', () => {
  const e = fakeEnv();
  e.conn.connect(); e.open(e.socks[0]);
  e.socks[0].onmessage({ data: JSON.stringify({ t: 'pong', ts: Date.now() - 40, leader: true }) });
  e.socks[0].onmessage({ data: JSON.stringify({ t: 'chat', msg: { text: 'x' } }) });
  const p = e.events.find((x) => x.type === 'ping');
  assert.ok(p.ms >= 40 && p.leader);
  assert.equal(e.msgs[0].t, 'chat');
});

test('état local : tolérant aux modules en stub', () => {
  assert.equal(readState({ player: null }), null);
  assert.equal(readState({ player: {} }), null);
  const pos = { x: 1, y: 0, z: 2 };
  const game = { player: { position: pos, velocity: { x: 5, y: 0, z: 0 }, state: 'onFoot', object3d: { rotation: { y: 1.5 } } }, police: { level: 3 } };
  const s = readState(game);
  assert.deepEqual(s.p, [1, 0, 2]);
  assert.equal(s.r, 1.5);
  assert.equal(s.a, 'run');
  assert.equal(s.st, 3);
  assert.equal(animOf({ anim: 'dance' }, 0), 'dance');
  assert.equal(animOf({ state: 'inVehicle' }, 0), 'drive');
});

test('état local : véhicule piloté', () => {
  const pl = { position: { x: 0, y: 0, z: 0 }, state: 'inVehicle' };
  const veh = { id: 'veh-3', type: 'taxi', driver: pl, object3d: { position: { x: 4, y: 0.5, z: 6 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }, siren: true };
  pl.vehicle = veh;
  const g = { player: pl };
  assert.equal(readState(g).veh, 'veh-3');
  assert.equal(readState(g).seat, 0);
  const v = readVehicle(g);
  assert.deepEqual(v.p, [4, 0.5, 6]);
  assert.equal(v.sir, 1);
  veh.driver = {}; // passager
  assert.equal(readVehicle(g), null);
});
