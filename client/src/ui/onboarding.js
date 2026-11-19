import { moveKeys, moveKey } from '../core/keylabels.js';
// Astuces contextuelles de première partie : chacune n'apparaît qu'une fois (mémorisé en localStorage).
const KEY = 'kubecity.tips.v1';
const load = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return new Set(); } };
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify([...s])); } catch { /* stockage indisponible */ } };

/** Liste des astuces : `when(ctx)` décide du moment, `action` (facultatif) la valide si le joueur fait déjà le geste. */
export const TIP_LIST = [
  { id: 'police', when: (c) => c.wanted, text: '<b>★</b> La police vous recherche : fuyez en voiture, sortez de son champ de vision ou cachez-vous pour perdre vos étoiles' },
  { id: 'move', after: 1, get text() { return `<b>${moveKeys()}</b> pour bouger · <b>Souris</b> pour regarder (cliquez dans le jeu) · <b>Maj</b> pour courir · <b>Espace</b> pour sauter`; } },
  { id: 'sprint', when: (c) => c.walked >= 10, action: 'sprint', text: '<b>Maj</b> : courir · ou double appui sur Avancer' },
  { id: 'car', when: (c) => c.nearCar, action: 'interact', text: '<b>F</b> pour entrer dans la voiture' },
  { id: 'drive', when: (c) => c.inVehicle, get text() { return `<b>${moveKey('forward')}</b>/<b>${moveKey('back')}</b> accélérer et freiner · <b>${moveKey('left')}</b>/<b>${moveKey('right')}</b> tourner · <b>Espace</b> frein à main · <b>H</b> klaxon · <b>V</b> caméra · <b>F</b> pour sortir`; } },
  { id: 'map', after: 30, action: 'map', text: '<b>M</b> pour la carte : cliquez dessus pour poser un point GPS' },
  { id: 'weapons', after: 55, late: 400, when: (c) => c.wanted || c.hurt, action: 'weaponWheel', text: '<b>Tab</b> (maintenu) pour la roue d\'armes · <b>clic gauche</b> pour attaquer' },
  { id: 'phone', after: 80, late: 420, when: (c) => c.far, action: 'phone', text: '<b>P</b> pour le téléphone : taxi, activités, photos' },
  { id: 'switch', after: 105, late: 450, when: (c) => c.missionDone, action: 'switchChar', text: '<b>Alt</b> (maintenu) pour changer de personnage' },
  { id: 'cluster', after: 130, late: 480, when: (c) => c.inVehicle, action: 'cluster', text: '<b>K</b> pour les infos du cluster : pod, latence, leader, Redis' },
  { id: 'pad', when: (c) => c.pad, text: 'Manette détectée : stick gauche bouger · stick droit caméra · Y entrer/sortir · RT attaquer ou accélérer · Start pause' },
];

export function createOnboarding(game, ui) {
  const seen = load();
  const el = document.createElement('div');
  el.className = 'kc-tip'; el.style.display = 'none';
  ui.root.appendChild(el);
  const st = document.createElement('style');
  st.textContent = `.kc-tip{position:absolute;left:50%;top:84px;transform:translateX(-50%);max-width:min(500px,92vw);background:var(--panel2);border:1px solid var(--yellow);border-radius:10px;padding:10px 18px;font-size:15px;text-align:center;z-index:30;box-shadow:0 0 16px rgba(255,210,63,.3);pointer-events:none}.kc-tip b{color:var(--yellow);border:1px solid var(--line);border-radius:4px;padding:0 6px;background:rgba(255,255,255,.07)}.kc-tip small{display:block;color:var(--dim);font-size:11px;margin-top:3px}`;
  document.head.appendChild(st);
  let walked = 0, start = null, maxHp = 0, hurt = false, playTime = 0, current = null, until = 0, scan = 0, pad = false;
  globalThis.addEventListener?.('gamepadconnected', () => { pad = true; });

  const markSeen = (id) => { if (!seen.has(id)) { seen.add(id); save(seen); } };
  function show(tip) {
    current = tip; markSeen(tip.id);
    el.innerHTML = `${typeof tip.text === 'function' ? tip.text() : tip.text}<small>Cette astuce ne reviendra pas</small>`;
    el.style.display = ''; until = playTime + 8;
  }
  function hide() { current = null; el.style.display = 'none'; }
  return {
    seen,
    reset() { seen.clear(); save(seen); },
    update(dt) {
      const playing = game.state === 'playing' && !ui.modalOpen && !ui.screens?.S?.end;
      if (!playing) { if (current) el.style.display = 'none'; return; }
      if (current && el.style.display === 'none') el.style.display = '';
      playTime += dt;
      const inp = game.input;
      // temps passé à marcher à pied sans sprinter (pour l'astuce « Maj : courir »)
      const pf = game.player;
      if (pf?.state === 'onFoot' && pf.speed2d > 0.5) { if (pf.speed2d > 6.4) markSeen('sprint'); else walked += dt; }
      for (const t of TIP_LIST) if (t.action && inp.pressed(t.action)) { markSeen(t.id); if (current?.id === t.id) hide(); }
      if (current && playTime > until) hide();
      scan -= dt;
      if (current || scan > 0) return;
      scan = 0.4;
      const pl = game.player;
      let nearCar = false;
      try { nearCar = pl?.state === 'onFoot' && !!game.vehicles?.nearestEnterable?.(pl.position, 3); } catch { /* API absente */ }
      if (!start && pl?.position) start = { x: pl.position.x, z: pl.position.z };
      const far = !!(start && pl?.position && Math.hypot(pl.position.x - start.x, pl.position.z - start.z) > 150);
      let missionDone = false;
      try { const m = game.gameplay?.profile?.missions; missionDone = Array.isArray(m) ? m.length > 0 : Object.keys(m || {}).length > 0; } catch { /* profil absent */ }
      const hp = pl?.health;
      if (typeof hp === 'number') { if (maxHp === 0) maxHp = hp; hurt = hp < maxHp * 0.7; }
      const ctx = { walked, far, missionDone, hurt, nearCar, inVehicle: !!pl?.vehicle, pad, wanted: (game.police?.level ?? 0) > 0 };
      const next = TIP_LIST.find((t) => !seen.has(t.id) && playTime >= (t.after ?? 0) && ((!t.when || t.when(ctx)) || (t.late && playTime >= t.late)));
      if (next) show(next);
    },
  };
}

/** Première visite sur une machine sans vrai GPU (rendu logiciel) : qualité Basse d'office. Renvoie true si appliqué. */
export function autoQuality(game) {
  try {
    if (localStorage.getItem('kubecity.settings.v1')) return false;
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    const weak = !gl || /swiftshader|llvmpipe|software|basic render/i.test(name) || (navigator.hardwareConcurrency || 8) <= 2;
    if (!weak) return false;
    game.settings.set('quality', 'low');
    return true;
  } catch { return false; }
}
