// Règles du jeu côté serveur : courses de rue et agents IA.
import crypto from "node:crypto";
import { PLACES, roadPath, districtAt } from "../public/shared/world.js";
import * as store from "./store.js";

export const BOT_SPEED = 300;       // px/s, un peu moins vite qu'un joueur à fond
const RACE_LOBBY_MS = 20_000;       // délai pour s'inscrire avant le départ
const RACE_MAX_MS = 5 * 60_000;
const PRIZES = [300, 200, 100];

export const newId = (p) => `${p}-${crypto.randomBytes(3).toString("hex")}`;

export function placeList() {
  return Object.entries(PLACES).map(([key, p]) => ({ key, label: p.label, x: Math.round(p.x), y: Math.round(p.y) }));
}

export function resolvePlace(key) {
  const p = PLACES[String(key || "").toLowerCase()];
  return p ? { ...p, key } : null;
}

export function raceStatus(race, now = Date.now()) {
  if (now < race.startAt) return "inscriptions";
  if (now < race.startAt + RACE_MAX_MS) return "en cours";
  return "terminée";
}

export async function createRace({ creatorId, creatorName, from, toKey }) {
  const to = resolvePlace(toKey);
  if (!to) throw new Error(`lieu inconnu : ${toKey}`);
  const now = Date.now();
  const race = {
    id: newId("course"),
    creator: creatorId,
    creatorName,
    toKey,
    toLabel: to.label,
    from: { x: Math.round(from.x), y: Math.round(from.y) },
    checkpoints: roadPath(from, to).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
    createdAt: now,
    startAt: now + RACE_LOBBY_MS,
  };
  await store.saveRace(race);
  await store.joinRace(race.id, creatorId, creatorName);
  await store.pushChat({ from: "Radio Kube", text: `${creatorName} lance une course vers ${to.label} ! Départ dans 20 s, tapez R pour rejoindre.`, ts: now });
  return race;
}

// Contrôle de vraisemblance : impossible d'arriver plus vite qu'une voiture à fond
function minDurationMs(race) {
  let d = 0, prev = race.from;
  for (const c of race.checkpoints) { d += Math.hypot(c.x - prev.x, c.y - prev.y); prev = c; }
  return (d / 520) * 1000;
}

export async function finish(raceId, playerId, name) {
  const race = await store.loadRace(raceId);
  if (!race) return { ok: false, reason: "course inconnue" };
  const now = Date.now();
  if (raceStatus(race, now) !== "en cours") return { ok: false, reason: "la course n'est pas en cours" };
  const ms = now - race.startAt;
  if (ms < minDurationMs(race)) return { ok: false, reason: "trop rapide pour être vrai" };
  const entrants = await store.raceEntrants(raceId);
  if (!entrants[playerId]) return { ok: false, reason: "pas inscrit" };
  const place = await store.finishRace(raceId, playerId, ms);
  if (!place) return { ok: false, reason: "déjà arrivé" };
  const prize = PRIZES[place - 1] ?? 50;
  await store.addScore(playerId, name, prize);
  await store.pushChat({ from: "Radio Kube", text: `${name} termine ${place === 1 ? "1er" : `${place}e`} de la course vers ${race.toLabel} en ${(ms / 1000).toFixed(1)} s (+${prize}).`, ts: now });
  return { ok: true, place, ms, prize };
}

// ---------- Agents IA ----------
export async function spawnBot({ name, color }) {
  const start = Object.values(PLACES)[Math.floor(Math.random() * Object.keys(PLACES).length)];
  const bot = {
    id: newId("agent"),
    name: String(name || "Agent").slice(0, 24),
    color: /^#[0-9a-f]{6}$/i.test(color || "") ? color : "#39ff88",
    bot: true,
    x: start.x, y: start.y, a: 0, v: 0,
    path: [], goal: null, raceId: null,
    createdAt: Date.now(), lastCmd: Date.now(),
  };
  await store.saveBot(bot);
  await store.pushChat({ from: "Radio Kube", text: `L'agent ${bot.name} arrive en ville.`, ts: Date.now() });
  return bot;
}

export async function botDriveTo(id, toKey) {
  const bot = await store.loadBot(id);
  if (!bot) throw new Error("agent inconnu");
  const to = resolvePlace(toKey);
  if (!to) throw new Error(`lieu inconnu : ${toKey}`);
  const order = { path: roadPath(bot, to), goal: to.label, raceId: null, raceStage: null };
  await store.setBotOrder(id, order);
  return { ...bot, ...order };
}

export async function botJoinRace(id, raceId) {
  const bot = await store.loadBot(id);
  if (!bot) throw new Error("agent inconnu");
  const race = await store.loadRace(raceId);
  if (!race) throw new Error("course inconnue");
  if (raceStatus(race) === "terminée") throw new Error("course terminée");
  await store.joinRace(raceId, bot.id, bot.name);
  // l'agent va d'abord sur la ligne de départ, puis attend le signal
  const order = { path: roadPath(bot, race.from), goal: `départ de la course vers ${race.toLabel}`, raceId, raceStage: "approche" };
  await store.setBotOrder(id, order);
  return { bot: { ...bot, ...order }, race };
}

export function describe(bot) {
  return {
    id: bot.id, name: bot.name,
    x: Math.round(bot.x), y: Math.round(bot.y),
    quartier: districtAt(bot.x, bot.y).name,
    destination: bot.goal, enCourse: bot.raceId,
    enRoute: bot.path.length > 0,
  };
}

// Un pas de simulation pour un agent. Renvoie true si l'agent a bougé.
async function stepBot(bot, dt, now) {
  if (bot.raceId && bot.raceStage === "attente") {
    const race = await store.loadRace(bot.raceId);
    if (!race || raceStatus(race, now) === "terminée") { bot.raceId = null; bot.raceStage = null; }
    else if (now >= race.startAt) { bot.path = race.checkpoints.map((c) => ({ ...c })); bot.raceStage = "course"; }
    else return false;
  }
  if (!bot.path.length) {
    bot.v = 0;
    // un agent sans ordre depuis 30 s se promène : la ville reste vivante
    if (now - bot.lastCmd > 30_000 && !bot.raceId) {
      const keys = Object.keys(PLACES);
      const to = PLACES[keys[Math.floor(Math.random() * keys.length)]];
      bot.path = roadPath(bot, to);
      bot.goal = `${to.label} (balade)`;
      bot.lastCmd = now;
    }
    return false;
  }
  let budget = BOT_SPEED * dt;
  while (budget > 0 && bot.path.length) {
    const t = bot.path[0];
    const dx = t.x - bot.x, dy = t.y - bot.y, d = Math.hypot(dx, dy);
    if (d < 1) { bot.path.shift(); continue; }
    const step = Math.min(budget, d);
    bot.x += (dx / d) * step; bot.y += (dy / d) * step;
    bot.a = Math.atan2(dy, dx);
    budget -= step;
  }
  bot.v = BOT_SPEED;
  if (!bot.path.length) {
    bot.v = 0;
    if (bot.raceId && bot.raceStage === "approche") bot.raceStage = "attente";
    else if (bot.raceId && bot.raceStage === "course") {
      await finish(bot.raceId, bot.id, bot.name);
      bot.raceId = null; bot.raceStage = null; bot.goal = null;
    } else bot.goal = null;
  }
  return true;
}

// Boucle du leader : appelée ~10 fois par seconde par le seul pod élu
export async function tickBots(dt) {
  const now = Date.now();
  const bots = await store.listBots();
  for (const bot of bots) {
    if (now - bot.lastCmd > 30 * 60_000 && !bot.path.length) { await store.deleteBot(bot.id); continue; }
    const order = await store.takeBotOrder(bot.id);
    if (order) Object.assign(bot, order, { lastCmd: now });
    const moved = await stepBot(bot, dt, now);
    await store.saveBot(bot);
    if (moved || Math.random() < 0.1) {
      await store.publish({ k: "p", p: { id: bot.id, name: bot.name, color: bot.color, x: bot.x, y: bot.y, a: bot.a, v: bot.v, bot: true } });
    }
  }
}
