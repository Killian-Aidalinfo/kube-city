// Tests du protocole v2 et de la logique serveur (fonctions pures, sans Redis).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as proto from "../src/protocol.js";
import { advance, botAsPlayer, minDurationMs } from "../src/game.js";
import * as store from "../src/store.js";
import { roadPath, PLACES, resolvePlace } from "../src/city.js";

test("hello : nettoie nom, perso et tenue", () => {
  const h = proto.parseHello({ v: 2, id: "joueur-abc123", name: "  x".repeat(30), ch: "jade<", outfit: { top: "#112233", skin: "rouge", extra: "#ffffff" }, re: 1 });
  assert.equal(h.v, 2);
  assert.equal(h.name.length <= 20, true);
  assert.equal(h.ch, "ines"); // identifiant invalide : repli
  assert.deepEqual(h.o, { top: "#112233" });
  assert.equal(h.re, true);
  assert.equal(proto.isValidId("a b"), false);
  assert.equal(proto.isValidId("joueur-abc123"), true);
});

test("state : bornes et valeurs par défaut", () => {
  const s = proto.parseState({ p: [1.234, 2, 99999], r: "x", vel: [1, 2, 3], a: "run!!", veh: "v-1", seat: 99, st: 9 });
  assert.deepEqual(s.p, [1.23, 2, 5000]);
  assert.equal(s.r, 0);
  assert.equal(s.a, "run");
  assert.equal(s.seat, 8);
  assert.equal(s.st, 5);
  assert.deepEqual(proto.parseState({}).p, [0, 0, 0]);
});

test("vehicle : quaternion, roues, couleur", () => {
  assert.equal(proto.parseVehicle({}), null);
  const v = proto.parseVehicle({ id: "veh-1", type: "taxi", p: [1, 0, 2], q: [0, 0.7071, 0, 0.7071], w: [0.3, 5, 9, 9, 9], col: "#ff0000", sir: 1 });
  assert.equal(v.w.length, 4);
  assert.equal(v.col, "#ff0000");
  assert.equal(v.sir, 1);
  assert.deepEqual(proto.parseVehicle({ id: "a", q: [1] }).q, [0, 0, 0, 1]);
});

test("chat, emote, profil", () => {
  assert.equal(proto.parseChat({ text: "  salut\n" }), "salut");
  assert.equal(proto.parseChat({ text: "x".repeat(500) }).length, 160);
  assert.equal(proto.parseEmote({ e: "dance" }), "dance");
  assert.equal(proto.parseEmote({ e: "../etc" }), null);
  assert.deepEqual(proto.parseProfile({ money: 5 }), { money: 5 });
  assert.equal(proto.parseProfile([1]), null);
  assert.equal(proto.parseProfile({ big: "x".repeat(proto.MAX_PROFILE_BYTES) }), null);
});

test("snapshot : champs rares seulement dans la version complète", () => {
  const p = { id: "a", name: "Zoé", ch: "jade", o: { top: "#000000" }, p: [1, 0, 2], r: 0, vel: [0, 0, 0], a: "idle", veh: null, seat: 0, st: 0 };
  assert.equal("n" in proto.packPlayer(p, false), false);
  const full = proto.packPlayer(p, true);
  assert.equal(full.n, "Zoé");
  assert.equal(full.ch, "jade");
});

test("itinéraire : rues de la grille, départ et arrivée sur des carrefours", () => {
  const path = roadPath({ x: 12, z: -30 }, resolvePlace("jetee"));
  assert.ok(path.length > 2);
  for (const pt of path) { assert.equal(pt.x % 100, 0); assert.equal(pt.z % 100, 0); }
  // jamais de diagonale : chaque segment reste sur un axe
  for (let i = 1; i < path.length; i++) assert.ok(path[i].x === path[i - 1].x || path[i].z === path[i - 1].z);
  const last = path.at(-1);
  assert.equal(last.x, PLACES.jetee.x);
  assert.equal(last.z, PLACES.jetee.z);
  assert.equal(resolvePlace("nimporte"), null);
});

test("agent : suit son itinéraire et s'arrête à l'arrivée", () => {
  const bot = { x: 0, z: 0, yaw: 0, v: 0, path: roadPath({ x: 0, z: 0 }, { x: 300, z: 0 }) };
  let moved = 0;
  for (let i = 0; i < 15 * 60 && bot.path.length; i++) if (advance(bot, 1 / 15)) moved++;
  assert.ok(moved > 0);
  assert.equal(bot.path.length, 0);
  assert.ok(Math.hypot(bot.x - 300, bot.z) < 1);
  assert.equal(advance(bot, 0.1), false);
  assert.equal(bot.v, 0);
});

test("agent diffusé comme un joueur dans un véhicule", () => {
  const e = botAsPlayer({ id: "agent-1", name: "Rex", color: "#39ff88", vtype: "taxi", x: 10, z: 20, yaw: 0, v: 5 });
  assert.equal(e.bot, true);
  assert.equal(e.veh, "agent-1-v");
  assert.equal(e.vh.type, "taxi");
  assert.deepEqual(e.p, [10, 0, 20]);
  assert.equal(e.vel[2], 5);
});

test("course : durée minimale vraisemblable", () => {
  const race = { from: { x: 0, z: 0 }, checkpoints: [{ x: 450, z: 0 }] };
  assert.equal(Math.round(minDurationMs(race)), 10000);
});

// game.js importe store.js, qui ouvre des connexions Redis : on les ferme pour que le test se termine
after(() => { store.redis.disconnect(); store.sub.disconnect(); });
