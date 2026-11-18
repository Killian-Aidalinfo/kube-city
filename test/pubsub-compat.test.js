// Compatibilité des mises à jour progressives : le serveur doit encore savoir lire les anciens
// événements Pub/Sub unitaires (k: "p") en plus des lots (k: "pb").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("le serveur accepte l'ancien format k:'p' et les lots k:'pb'", () => {
  assert.match(src, /ev\.k === "p"\)\s*\{\s*players\.set\(ev\.p\.id/);
  assert.match(src, /ev\.k === "pb"/);
});
