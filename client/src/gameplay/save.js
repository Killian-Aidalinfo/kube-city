// Profil de sauvegarde : structure, validation et persistance (serveur via game.net, repli localStorage). Module pur.
import { CHARACTER_IDS, CHARACTERS } from './characters.js';

export const SAVE_KEY = 'kubecity.profile.v1';
export const START_MONEY = 500;

/** Profil neuf. */
export function defaultProfile() {
  const chars = {};
  for (const id of CHARACTER_IDS) {
    chars[id] = { money: START_MONEY, stats: { ...CHARACTERS[id].stats }, outfit: { ...CHARACTERS[id].defaultOutfit }, pos: null, armor: 0 };
  }
  return {
    v: 1, current: 'ines', chars, missions: {}, kubes: [],
    stats: { distance: 0, jumps: 0, maxWanted: 0, playTime: 0, taxiRides: 0, races: 0 },
    achievements: {}, vehicles: [], updatedAt: 0,
  };
}

/** Fusionne des données inconnues avec un profil par défaut (ignore tout ce qui est invalide). */
export function mergeProfile(raw) {
  const p = defaultProfile();
  if (!raw || typeof raw !== 'object') return p;
  if (CHARACTER_IDS.includes(raw.current)) p.current = raw.current;
  for (const id of CHARACTER_IDS) {
    const c = raw.chars?.[id];
    if (!c) continue;
    if (Number.isFinite(c.money)) p.chars[id].money = Math.max(0, Math.floor(c.money));
    for (const k of Object.keys(p.chars[id].stats)) if (Number.isFinite(c.stats?.[k])) p.chars[id].stats[k] = Math.min(10, Math.max(0, c.stats[k]));
    if (c.outfit && typeof c.outfit === 'object') for (const k of Object.keys(p.chars[id].outfit)) if (/^#[0-9a-f]{6}$/i.test(c.outfit[k] || '')) p.chars[id].outfit[k] = c.outfit[k];
    if (Number.isFinite(c.pos?.x) && Number.isFinite(c.pos?.z)) p.chars[id].pos = { x: c.pos.x, z: c.pos.z };
    if (Number.isFinite(c.armor)) p.chars[id].armor = Math.min(100, Math.max(0, c.armor));
  }
  if (raw.missions && typeof raw.missions === 'object') for (const [k, m] of Object.entries(raw.missions)) if (m && m.done) p.missions[k] = { done: true };
  if (Array.isArray(raw.kubes)) p.kubes = [...new Set(raw.kubes.filter((n) => Number.isInteger(n) && n >= 0 && n < 50))];
  for (const k of Object.keys(p.stats)) if (Number.isFinite(raw.stats?.[k])) p.stats[k] = raw.stats[k];
  if (raw.achievements && typeof raw.achievements === 'object') for (const [k, v] of Object.entries(raw.achievements)) if (v) p.achievements[k] = true;
  if (Array.isArray(raw.vehicles)) p.vehicles = raw.vehicles.slice(0, 10);
  p.updatedAt = Number(raw.updatedAt) || 0;
  return p;
}

/** Lecture locale (secours). */
export function loadLocal(storage = globalThis.localStorage) {
  try { const s = storage?.getItem(SAVE_KEY); return s ? mergeProfile(JSON.parse(s)) : null; } catch { return null; }
}
export function saveLocal(profile, storage = globalThis.localStorage) {
  try { storage?.setItem(SAVE_KEY, JSON.stringify(profile)); return true; } catch { return false; }
}

/**
 * Charge le profil : serveur (game.net.loadProfile) si disponible, sinon localStorage, sinon neuf.
 * On garde le plus récent des deux (updatedAt) pour ne rien perdre en cas de panne de pod.
 */
export async function loadProfile(net, storage) {
  const local = loadLocal(storage);
  let remote = null;
  try { const r = await Promise.race([net?.loadProfile?.(), new Promise((res) => setTimeout(() => res(null), 3000))]); if (r && typeof r === 'object') remote = mergeProfile(r.profile ?? r); } catch { /* serveur indisponible */ }
  if (remote && local) return remote.updatedAt >= local.updatedAt ? remote : local;
  return remote || local || defaultProfile();
}

/** Sauvegarde sur le serveur puis en local. Ne lève jamais d'erreur. */
export async function saveProfile(net, profile, storage) {
  profile.updatedAt = Date.now();
  saveLocal(profile, storage);
  try { await net?.saveProfile?.(profile); return true; } catch { return false; }
}
