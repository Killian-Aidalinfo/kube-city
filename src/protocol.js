// Protocole WebSocket v2 (JSON, `v: 2`) : validation des messages reçus et mise en forme des diffusions.
// Fonctions pures, testées dans test/server-protocol.test.js.
export const PROTOCOL = 2;
export const MAX_PROFILE_BYTES = 48 * 1024;

const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[a-z0-9-]{6,40}$/i;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const r2 = (v) => Math.round(v * 100) / 100;
const vec3 = (a, max = 5000) => {
  if (!Array.isArray(a)) return [0, 0, 0];
  return [0, 1, 2].map((i) => Math.max(-max, Math.min(max, r2(num(a[i])))));
};

export const isValidId = (id) => ID.test(id || "");

export function cleanOutfit(o) {
  if (!o || typeof o !== "object") return null;
  const out = {};
  for (const k of ["skin", "hair", "top", "bottom", "shoes"]) if (HEX.test(o[k] || "")) out[k] = o[k];
  return Object.keys(out).length ? out : null;
}

const cleanChar = (c) => (/^[a-z0-9_-]{1,24}$/i.test(c || "") ? c : "ines");

/** hello : identité du joueur (nom, perso, tenue). */
export function parseHello(m) {
  return {
    v: num(m.v),
    id: m.id,
    name: String(m.name || "Anonyme").replace(/[\u0000-\u001f]/g, "").slice(0, 20) || "Anonyme",
    ch: cleanChar(m.ch),
    o: cleanOutfit(m.outfit),
    re: !!m.re,
    p: Array.isArray(m.p) ? vec3(m.p) : null,
  };
}

/** state : position, rotation, vitesse, animation, véhicule/siège, étoiles. */
export function parseState(m) {
  return {
    p: vec3(m.p),
    r: r2(num(m.r)),
    vel: vec3(m.vel, 400),
    a: String(m.a || "idle").replace(/[^a-z0-9_]/gi, "").slice(0, 16) || "idle",
    veh: m.veh ? String(m.veh).slice(0, 40) : null,
    seat: Math.max(0, Math.min(8, Math.round(num(m.seat)))),
    st: Math.max(0, Math.min(5, Math.round(num(m.st)))),
  };
}

/** vehicle : véhicule piloté par ce joueur (position, quaternion, roues, couleur, sirène). */
export function parseVehicle(m) {
  if (!m || !m.id) return null;
  const q = Array.isArray(m.q) && m.q.length === 4 ? m.q.map((x) => Math.round(num(x) * 1000) / 1000) : [0, 0, 0, 1];
  return {
    id: String(m.id).slice(0, 40),
    type: String(m.type || "sedan").replace(/[^a-z0-9_-]/gi, "").slice(0, 24) || "sedan",
    p: vec3(m.p),
    q,
    w: (Array.isArray(m.w) ? m.w : []).slice(0, 4).map((x) => r2(num(x))),
    col: HEX.test(m.col || "") ? m.col : null,
    sir: m.sir ? 1 : 0,
    li: m.li ? 1 : 0,
  };
}

export const parseChat = (m) => String(m.text || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 160);
export const parseEmote = (m) => (/^[a-z0-9_]{1,16}$/i.test(m.e || m.id || "") ? String(m.e || m.id) : null);

/** Profil persisté : objet JSON de taille bornée (sinon null). */
export function parseProfile(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const s = JSON.stringify(p);
  return s.length <= MAX_PROFILE_BYTES ? p : null;
}

/** Entrée de snapshot pour un joueur. `full` ajoute les champs rarement modifiés (nom, perso, tenue). */
export function packPlayer(p, full) {
  const e = { id: p.id, p: p.p, r: p.r, vel: p.vel, a: p.a, veh: p.veh || undefined, seat: p.veh ? p.seat : undefined, st: p.st || undefined, vh: p.vh || undefined };
  if (full) Object.assign(e, { n: p.name, ch: p.ch, o: p.o || undefined, bot: p.bot ? 1 : undefined });
  return e;
}
