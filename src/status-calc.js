// Calculs purs de la vue « enseignant » (sans Redis : testables seuls).
export const BEAT_MS = 2000;        // un battement par pod toutes les 2 s
export const BEAT_TTL_S = 6;        // un pod sans battement depuis 6 s est considéré disparu
export const WINDOW_MS = 30 * 60_000;
export const SLOT_MS = 4000;        // un « échantillon » de dispo = 4 s (toujours ≥ 1 battement par pod vivant)
// ---------- Fonctions pures (testées) ----------

// Part des créneaux de 4 s où au moins un pod était prêt ET voyait Redis. Le calcul commence au premier
// battement de la fenêtre (un démarrage tout neuf n'affiche pas 0 %) ; un créneau sans aucun battement compte comme indisponible.
export function computeAvailability(beats, now, windowMs = WINDOW_MS, slotMs = SLOT_MS) {
  const from = now - windowMs, last = Math.floor(now / slotMs) - 1; // le créneau en cours n'est pas fini
  const up = new Set();
  let first = Infinity;
  for (const b of beats) {
    if (b.ts < from || b.ts > now) continue;
    const s = Math.floor(b.ts / slotMs);
    if (s < first) first = s;
    if (b.ready && b.redis) up.add(s);
  }
  if (!isFinite(first) || last < first) return { pct: null, up: 0, total: 0, sinceMs: 0 };
  const total = last - first + 1;
  let u = 0;
  for (const s of up) if (s >= first && s <= last) u++;
  return { pct: Math.round((u / total) * 10000) / 100, up: u, total, sinceMs: now - first * slotMs };
}

// Incidents des `windowMs` dernières ms, du plus récent au plus ancien, sans doublon exact.
export function recentIncidents(list, now, windowMs = WINDOW_MS) {
  const seen = new Set(), out = [];
  for (const e of [...list].sort((a, b) => b.ts - a.ts)) {
    if (!e || now - e.ts > windowMs) continue;
    const k = `${e.ts}|${e.pod}|${e.type}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(e);
  }
  return out;
}


