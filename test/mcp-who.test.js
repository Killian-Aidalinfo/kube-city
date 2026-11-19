// Quotas MCP : une classe derrière une même IP NAT, chacun avec sa clé X-Kube-Key, ne partage pas le quota perKey.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { whoIs } from "../src/mcp.js";
import * as store from "../src/store.js";

after(() => store.closeStore());

const req = (headers) => ({ headers, socket: { remoteAddress: "10.0.0.1" } });

test("whoIs : même IP NAT, clés différentes => clés de quota distinctes", () => {
  const ws = Array.from({ length: 30 }, (_, i) => whoIs(req({ "x-forwarded-for": "203.0.113.9", "x-kube-key": `etudiant-${i}` })));
  assert.equal(new Set(ws.map((w) => w.key)).size, 30);
  assert.equal(new Set(ws.map((w) => w.ip)).size, 1);
});

test("whoIs : sans X-Kube-Key la clé se confond avec l'IP (quota perKey partagé)", () => {
  const a = whoIs(req({ "x-forwarded-for": "203.0.113.9" })), b = whoIs(req({ "x-forwarded-for": "203.0.113.9" }));
  assert.equal(a.key, b.key);
});

test("whoIs : keyed vaut vrai seulement avec une X-Kube-Key", () => {
  const req = (key) => ({ headers: key ? { "x-kube-key": key, "x-forwarded-for": "203.0.113.7" } : { "x-forwarded-for": "203.0.113.7" }, socket: { remoteAddress: "10.0.0.1" } });
  assert.equal(whoIs(req("alice")).keyed, true);
  assert.equal(whoIs(req("")).keyed, false);
});
