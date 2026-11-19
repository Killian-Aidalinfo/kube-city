// Lettres de déplacement affichées selon la disposition du clavier. Les contrôles lisent des codes PHYSIQUES
// (KeyW/KeyA/KeyS/KeyD), seul l'affichage change : « Z Q S D » sur AZERTY, « W A S D » ailleurs.
const AZERTY_LANG = /^(fr|br|oc|co|ewo)\b|^fr-/i;
let L = { forward: 'W', left: 'A', back: 'S', right: 'D' };
try {
  const lang = String(globalThis.navigator?.languages?.[0] || globalThis.navigator?.language || '');
  if (AZERTY_LANG.test(lang)) L = { forward: 'Z', left: 'Q', back: 'S', right: 'D' };
} catch { /* pas de navigator */ }
try {
  globalThis.navigator?.keyboard?.getLayoutMap?.().then((m) => {
    const g = (c, d) => { const v = m.get(c); return v && v.length === 1 ? v.toUpperCase() : d; };
    L = { forward: g('KeyW', L.forward), left: g('KeyA', L.left), back: g('KeyS', L.back), right: g('KeyD', L.right) };
  }).catch(() => {});
} catch { /* API absente */ }
export const moveKeys = () => `${L.forward} ${L.left} ${L.back} ${L.right}`;
export const moveKey = (dir) => L[dir];
