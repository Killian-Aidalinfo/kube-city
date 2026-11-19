// Réglages persistés en localStorage (avec repli mémoire si indisponible).
const KEY = 'kubecity.settings.v1';

export const DEFAULTS = Object.freeze({
  quality: 'medium',        // 'low' | 'medium' | 'high'
  shadows: true,
  shadowMapSize: 2048,      // 1024 | 2048 | 4096
  viewDistance: 600,        // mètres
  pedDensity: 1,            // 0..1
  maxPixelRatio: 2,
  sensitivity: 1,           // multiplicateur souris/stick
  invertY: false,
  volumeMaster: 1,
  volumeMusic: 0.6,
  volumeSfx: 0.8,
  subtitles: true,
});

/** Préréglage Basse (rendu logiciel mesuré ~30 i/s avec ces valeurs, voir scripts/perf-low.mjs). Appliqué quand quality passe à 'low'. */
export const LOW_PRESET = Object.freeze({ shadows: false, shadowMapSize: 1024, viewDistance: 200, pedDensity: 0.2, maxPixelRatio: 0.5 });

/** Réglages réactifs : settings.get/set/onChange. */
export function createSettings(storage = globalThis.localStorage) {
  let data = { ...DEFAULTS };
  try { Object.assign(data, JSON.parse(storage?.getItem(KEY) || '{}')); } catch { /* données invalides */ }
  const listeners = new Set();
  const save = () => { try { storage?.setItem(KEY, JSON.stringify(data)); } catch { /* quota / mode privé */ } };
  return {
    get: (k) => data[k],
    all: () => ({ ...data }),
    set(k, v) {
      if (data[k] === v) return;
      data[k] = v; save(); for (const f of listeners) f(k, v);
      if (k === 'quality' && v === 'low') for (const [pk, pv] of Object.entries(LOW_PRESET)) if (data[pk] !== pv) { data[pk] = pv; save(); for (const f of listeners) f(pk, pv); }
    },
    reset() { data = { ...DEFAULTS }; save(); for (const f of listeners) f('*', null); },
    /** fn(clé, valeur) ; renvoie le désabonnement */
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
