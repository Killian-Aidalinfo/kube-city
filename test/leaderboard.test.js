// Classement global : seuls les joueurs actifs depuis 24 h (LEADERBOARD_ACTIVE_HOURS) apparaissent.
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.REDIS_URL ??= "redis://localhost:6380";
const store = await import("../src/store.js");
const { redis } = store;
const ids = ["t-lb-actif", "t-lb-ancien", "t-lb-sansdate", "t-lb-bump"];
const H = 3600_000;
let up = true;

// scores énormes dans les tests : les joueurs de test sont en tête quel que soit le contenu du Redis local
const clean = () => redis.multi().zrem("pn:scores", ...ids).zrem("pn:seen", ...ids).hdel("pn:names", ...ids)
  .zrem("pn:ss:money", ...ids).exec();
try { await redis.ping(); await clean(); } catch { up = false; }
after(async () => { if (up) await clean(); await store.closeStore(); });

const board = async () => (await store.leaderboard(2000)).map((r) => r.id).filter((id) => ids.includes(id));

test("leaderboard : actif oui, ancien (>24 h) non, sans date (anciennes données) non", { skip: !up && "Redis absent" }, async () => {
  await redis.multi().zadd("pn:scores", 1e9, "t-lb-actif").hset("pn:names", "t-lb-actif", "A")
    .zadd("pn:seen", Date.now() - H, "t-lb-actif").exec();
  await redis.multi().zadd("pn:scores", 1e9, "t-lb-ancien").hset("pn:names", "t-lb-ancien", "B")
    .zadd("pn:seen", Date.now() - 25 * H, "t-lb-ancien").exec();
  await redis.multi().zadd("pn:scores", 1e9, "t-lb-sansdate").hset("pn:names", "t-lb-sansdate", "C").exec();
  assert.deepEqual(await board(), ["t-lb-actif"]);
});

test("addScore et bumpSession marquent le joueur actif ; le classement de session reste inchangé", { skip: !up && "Redis absent" }, async () => {
  await clean();
  await store.addScore("t-lb-actif", "A", 10);
  await store.bumpSession("t-lb-bump", "D", "money", 5);
  const seen = await redis.zmscore("pn:seen", "t-lb-actif", "t-lb-bump");
  assert.ok(seen.every((s) => Date.now() - Number(s) < 5000));
  assert.equal(await redis.zscore("pn:scores", "t-lb-bump"), null); // bumpSession ne touche pas au score global
  assert.equal(await redis.zscore("pn:ss:money", "t-lb-bump"), "5");
  const ttl = await redis.ttl("pn:seen");
  assert.ok(ttl > 0 && ttl <= 7 * 24 * 3600);
});

test("LEADERBOARD_ACTIVE_HOURS règle la fenêtre", { skip: !up && "Redis absent" }, async () => {
  await clean();
  await redis.multi().zadd("pn:scores", 1e9, "t-lb-ancien").hset("pn:names", "t-lb-ancien", "B")
    .zadd("pn:seen", Date.now() - 25 * H, "t-lb-ancien").exec();
  process.env.LEADERBOARD_ACTIVE_HOURS = "48";
  try { assert.deepEqual(await board(), ["t-lb-ancien"]); } finally { delete process.env.LEADERBOARD_ACTIVE_HOURS; }
  assert.deepEqual(await board(), []);
});
