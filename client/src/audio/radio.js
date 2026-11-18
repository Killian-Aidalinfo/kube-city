// Composition procédurale des 5 stations de radio (module pur : il produit des événements musicaux par mesure).
// Le séquenceur Web Audio (index.js) joue ces événements ; tout est déterministe pour une graine donnée.

/** Générateur pseudo-aléatoire déterministe. */
export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const PENTA = [0, 3, 5, 7, 10];

/** Stations : tempo, gamme et progression propres à chacune. prog = degrés de la gamme, une mesure chacun. */
export const STATIONS = [
  { id: 'neon', name: 'Néon FM', genre: 'Synthwave', bpm: 104, swing: 0, root: 57, scale: MINOR, prog: [0, 5, 3, 4], color: '#ff4fa3' },
  { id: 'lofi', name: 'Kube Lo-Fi', genre: 'Lo-fi', bpm: 78, swing: 0.28, root: 50, scale: DORIAN, prog: [1, 4, 0, 3], color: '#8fd3c8' },
  { id: 'techno', name: 'Techno 303', genre: 'Techno', bpm: 130, swing: 0, root: 52, scale: PHRYGIAN, prog: [0, 0, 1, 0], color: '#38e8ff' },
  { id: 'rock', name: 'Rock Pixel', genre: 'Rock synthétique', bpm: 142, swing: 0, root: 52, scale: MINOR, prog: [0, 0, 5, 4], color: '#ffd23f' },
  { id: 'talk', name: 'Radio Bavardage', genre: 'Talk-show', bpm: 72, swing: 0.2, root: 53, scale: DORIAN, prog: [0, 3, 1, 4], color: '#d4513f' },
];

/** Note MIDI du degré d de la gamme de la station (peut dépasser 7 : monte d'une octave). */
export function degree(st, d, oct = 0) {
  const n = st.scale.length;
  const o = Math.floor(d / n);
  return st.root + st.scale[((d % n) + n) % n] + 12 * (o + oct);
}
const triad = (st, d, oct = 0) => [degree(st, d, oct), degree(st, d + 2, oct), degree(st, d + 4, oct)];
const seventh = (st, d, oct = 0) => [...triad(st, d, oct), degree(st, d + 6, oct)];

/**
 * Événements d'une mesure (16 double-croches) : { t: 0..15, kind, midi?, dur (en pas), vel 0..1 }.
 * kinds : kick snare clap hat ohat bass acid pad arp lead power keys stab
 */
export function buildBar(st, bar, seed = 1) {
  const rng = mulberry32(seed * 7919 + bar * 104729 + st.id.length * 31);
  const d = st.prog[bar % st.prog.length];
  const ev = [];
  const add = (t, kind, midi, dur = 1, vel = 0.8) => ev.push({ t, kind, midi, dur, vel });
  switch (st.id) {
    case 'neon': {
      for (const t of [0, 4, 8, 12]) add(t, 'kick');
      for (const t of [4, 12]) add(t, 'snare');
      for (let t = 2; t < 16; t += 4) add(t, 'hat', undefined, 1, 0.7);
      for (let t = 0; t < 16; t += 2) add(t, 'bass', degree(st, d, -2), 2, t % 4 === 0 ? 0.9 : 0.65);
      for (const m of triad(st, d, 0)) add(0, 'pad', m, 16, 0.5);
      const tri = triad(st, d, 1);
      const order = [0, 1, 2, 1];
      for (let t = 0; t < 16; t++) if (rng() > 0.18) add(t, 'arp', tri[order[t % 4]], 1, 0.45);
      if (bar % 2 === 1) {
        let p = d + 7;
        for (const t of [0, 3, 6, 8, 11, 14]) { p += Math.round((rng() - 0.5) * 3); add(t, 'lead', degree(st, p), 2, 0.6); }
      }
      break;
    }
    case 'lofi': {
      for (const t of [0, 10]) add(t, 'kick', undefined, 1, 0.8);
      for (const t of [4, 12]) add(t, 'snare', undefined, 1, 0.5);
      for (let t = 0; t < 16; t += 2) add(t, 'hat', undefined, 1, t % 4 === 2 ? 0.45 : 0.3);
      add(0, 'bass', degree(st, d, -2), 6, 0.8); add(10, 'bass', degree(st, d + 4, -2), 4, 0.7);
      for (const m of seventh(st, d, 0)) { add(0, 'keys', m, 6, 0.5); add(8, 'keys', m, 8, 0.4); }
      if (rng() < 0.6) {
        let p = rng() * 5 | 0;
        for (const t of [2, 6, 7, 13]) if (rng() < 0.7) { p = (p + (rng() * 3 | 0) - 1 + 5) % 5; add(t, 'lead', st.root + 12 + PENTA[p], 2, 0.4); }
      }
      break;
    }
    case 'techno': {
      for (const t of [0, 4, 8, 12]) add(t, 'kick');
      for (const t of [2, 6, 10, 14]) add(t, 'ohat', undefined, 1, 0.5);
      for (let t = 1; t < 16; t += 2) add(t, 'hat', undefined, 1, 0.3);
      for (const t of [4, 12]) add(t, 'clap');
      const notes = [0, 0, 3, 7, 12, 0, 5, 10];
      for (let t = 0; t < 16; t++) if (rng() < 0.75) add(t, 'acid', st.root - 12 + degreeOffset(st, d) + notes[(rng() * notes.length) | 0], 1, rng() < 0.25 ? 1 : 0.7);
      if (bar % 4 === 3) for (const m of triad(st, d, 1)) add(6, 'stab', m, 2, 0.6);
      break;
    }
    case 'rock': {
      for (const t of [0, 6, 8, rng() < 0.5 ? 10 : 11]) add(t, 'kick');
      for (const t of [4, 12]) add(t, 'snare');
      for (let t = 0; t < 16; t += 2) add(t, 'hat', undefined, 1, 0.6);
      const root = degree(st, d, -1);
      for (let t = 0; t < 16; t += 2) add(t, 'power', root, 2, t % 8 === 0 ? 0.9 : 0.7);
      for (let t = 0; t < 16; t += 4) add(t, 'bass', root - 12, 4, 0.8);
      if (bar % 4 >= 2) {
        let p = rng() * 5 | 0;
        for (const t of [0, 2, 4, 7, 8, 10, 12, 14]) { p = (p + (rng() * 3 | 0) - 1 + 5) % 5; add(t, 'lead', st.root + 24 + PENTA[p], 2, 0.5); }
      }
      break;
    }
    default: { // talk : fond de jazz doux
      for (const t of [0, 4, 8, 12]) add(t, 'bass', degree(st, d + [0, 2, 4, 2][t / 4], -2), 4, 0.6);
      for (let t = 0; t < 16; t += 2) add(t, 'hat', undefined, 1, 0.22);
      if (bar % 2 === 0) for (const m of seventh(st, d, 0)) add(0, 'keys', m, 10, 0.35);
    }
  }
  return ev;
}
function degreeOffset(st, d) { return st.scale[d % st.scale.length]; }

/** Répliques du talk-show (texte qui défile). Originales, sans lien avec une émission existante. */
export const TALK_LINES = [
  ['Anne-Laure', 'Bonsoir Kube City ! Ici Radio Bavardage, et ce soir on parle de feux tricolores qui passent tous au vert en même temps.'],
  ['Marcel', 'Je dis juste que mon serveur a redémarré tout seul. Personne n\'y a touché. Personne.'],
  ['Anne-Laure', 'Marcel, tu appelles pour la quatrième fois cette semaine. Respire.'],
  ['Dr Octet', 'Mon conseil du jour : sauvegardez vos données, et surtout vos croissants.'],
  ['Marcel', 'Un « Cluster » surveillerait la ville, il paraît. Moi je dis que c\'est le syndic.'],
  ['Anne-Laure', 'Information trafic : un convoi de trottinettes bloque la jetée. Rien de grave, tout le monde klaxonne poliment.'],
  ['Dr Octet', 'Si votre pod tombe, ne paniquez pas : un autre prend le relais. C\'est ça, la haute disponibilité.'],
  ['Anne-Laure', 'Météo : soleil sur la plage, nuages sur les Collines, et une légère averse de bugs au Centre.'],
  ['Marcel', 'Hier j\'ai vu une voiture de police se garer en double file pour acheter des beignets. Sans commentaire.'],
  ['Dr Octet', 'Un kube caché, c\'est un kube trouvé. Regardez derrière les conteneurs du port.'],
];
