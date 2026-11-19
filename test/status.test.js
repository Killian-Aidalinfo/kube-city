import test from "node:test";
import assert from "node:assert/strict";
import { computeAvailability, recentIncidents, SLOT_MS } from "../src/status-calc.js";

const NOW = 10_000_000 * SLOT_MS;
const beats = (slots, ok = true) => slots.map((s) => ({ ts: NOW - s * SLOT_MS + 100, ready: ok, redis: ok }));

test("dispo : 100 % quand tous les créneaux ont un pod prêt", () => {
  const r = computeAvailability(beats([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]), NOW);
  assert.equal(r.pct, 100); assert.equal(r.total, 10);
});
test("dispo : un trou de 2 créneaux sur 10 = 80 %", () => {
  const r = computeAvailability(beats([10, 9, 8, 7, 4, 3, 2, 1]), NOW);
  assert.equal(r.pct, 80); assert.equal(r.up, 8);
});
test("dispo : pod non prêt ou Redis coupé = créneau indisponible ; un seul pod prêt suffit", () => {
  const b = [...beats([4, 3], false), ...beats([2, 1]), { ts: NOW - 4 * SLOT_MS + 200, ready: true, redis: true }, { ts: NOW - 3 * SLOT_MS + 200, ready: true, redis: false }];
  const r = computeAvailability(b, NOW);
  assert.equal(r.total, 4); assert.equal(r.up, 3); assert.equal(r.pct, 75);
});
test("dispo : pas de donnée = null, hors fenêtre ignoré", () => {
  assert.equal(computeAvailability([], NOW).pct, null);
  assert.equal(computeAvailability([{ ts: NOW - 40 * 60_000, ready: true, redis: true }], NOW).pct, null);
});
test("journal : fenêtre de 30 min, ordre récent d'abord, doublons retirés", () => {
  const e = (ts, type, pod = "a") => ({ ts, type, pod });
  const l = recentIncidents([e(NOW - 31 * 60_000, "up"), e(NOW - 5000, "gone"), e(NOW - 5000, "gone"), e(NOW - 60_000, "stop")], NOW);
  assert.deepEqual(l.map((x) => x.type), ["gone", "stop"]);
});
