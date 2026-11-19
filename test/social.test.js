// Social : paliers d'exploits Radio Kube, classement d'une chasse, liste fermée d'emotes (fonctions pures, sans Redis).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as proto from "../src/protocol.js";
import { crossedMilestone, exploitText, huntRows } from "../src/game.js";
import * as store from "../src/store.js";

after(() => store.closeStore());

test("paliers : seul le plus haut palier franchi est annoncé", () => {
  assert.equal(crossedMilestone("money", 900, 950), null);
  assert.equal(crossedMilestone("money", 900, 1200), 1000);
  assert.equal(crossedMilestone("money", 900, 30000), 25000);
  assert.equal(crossedMilestone("kubes", 9, 10), 10);
  assert.equal(crossedMilestone("kubes", 10, 11), null);
  assert.match(exploitText("Zoé", "races", 3), /Zoé compte déjà 3 courses/);
});

test("chasse : le plus de kubes gagne, égalité au plus petit numéro", () => {
  const rows = huntRows({ 0: "a", 1: "b", 2: "b", 3: "a", 4: "c" }, { a: "Ana", b: "Ben" });
  assert.deepEqual(rows.map((r) => [r.id, r.count]), [["a", 2], ["b", 2], ["c", 1]]); // a a le kube 0
  assert.equal(rows[0].name, "Ana");
  assert.deepEqual(huntRows({}), []);
});

test("emotes : liste fermée", () => {
  assert.deepEqual(proto.EMOTES, ["salut", "danse", "bravo", "rire"]);
  assert.equal(proto.parseEmote({ e: "bravo" }), "bravo");
  assert.equal(proto.parseEmote({ e: "<script>" }), null);
});
