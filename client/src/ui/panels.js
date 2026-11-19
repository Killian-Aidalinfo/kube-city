// Panneaux réutilisables : réglages, liste des touches, boutique.
import { formatMoney } from './mapmath.js';
import { moveKeys } from '../core/keylabels.js';

const PRESETS = {
  low:    { shadows: false, shadowMapSize: 1024, viewDistance: 250, pedDensity: 0.3, maxPixelRatio: 0.75, lointain: 'light' },
  medium: { shadows: true, shadowMapSize: 1024, viewDistance: 500, pedDensity: 0.7, maxPixelRatio: 1.5, lointain: 'full' },
  high:   { shadows: true, shadowMapSize: 2048, viewDistance: 800, pedDensity: 1, maxPixelRatio: 2, lointain: 'full' },
};

/** Panneau de réglages (spec 12) : qualité, sensibilité, inversion Y, volumes, sous-titres. */
export function buildSettings(game) {
  const s = game.settings;
  const box = document.createElement('div');
  const rows = [
    { k: 'quality', label: 'Qualité graphique', type: 'select', opts: [['low', 'Basse'], ['medium', 'Moyenne'], ['high', 'Haute']] },
    { k: 'shadows', label: 'Ombres', type: 'check' },
    { k: 'viewDistance', label: 'Distance de vue', type: 'range', min: 200, max: 1000, step: 50, fmt: (v) => `${v} m` },
    { k: 'lointain', label: 'Décor lointain', type: 'select', opts: [['off', 'Aucun'], ['light', 'Léger'], ['full', 'Complet']] },
    { k: 'pedDensity', label: 'Densité des piétons', type: 'range', min: 0, max: 1, step: 0.1, fmt: (v) => `${Math.round(v * 100)} %` },
    { k: 'sensitivity', label: 'Sensibilité de la souris', type: 'range', min: 0.3, max: 2.5, step: 0.1, fmt: (v) => `×${(+v).toFixed(1)}` },
    { k: 'invertY', label: 'Inverser l\'axe vertical', type: 'check' },
    { k: 'volumeMaster', label: 'Volume général', type: 'range', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)} %` },
    { k: 'volumeMusic', label: 'Volume de la musique', type: 'range', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)} %` },
    { k: 'volumeSfx', label: 'Volume des effets', type: 'range', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)} %` },
    { k: 'subtitles', label: 'Sous-titres', type: 'check' },
  ];
  for (const r of rows) {
    const row = document.createElement('label'); row.className = 'kc-row';
    const name = document.createElement('span'); name.textContent = r.label; row.appendChild(name);
    let input;
    if (r.type === 'select') {
      input = document.createElement('select');
      for (const [v, l] of r.opts) { const o = document.createElement('option'); o.value = v; o.textContent = l; input.appendChild(o); }
      input.value = s.get(r.k);
      input.onchange = () => { s.set(r.k, input.value); if (r.k === 'quality') for (const [k, v] of Object.entries(PRESETS[input.value] || {})) s.set(k, v); sync(); };
    } else if (r.type === 'check') {
      input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!s.get(r.k);
      input.onchange = () => s.set(r.k, input.checked);
    } else {
      input = document.createElement('input'); input.type = 'range'; Object.assign(input, { min: r.min, max: r.max, step: r.step, value: s.get(r.k) });
      const wrap = document.createElement('span'); const val = document.createElement('small'); val.style.cssText = 'color:var(--dim);display:block;text-align:right';
      val.textContent = r.fmt(s.get(r.k));
      input.oninput = () => { s.set(r.k, +input.value); val.textContent = r.fmt(+input.value); };
      input._val = val; input._fmt = r.fmt;
      wrap.append(input, val); row.appendChild(wrap); row._in = input; row._k = r.k; box.appendChild(row); continue;
    }
    row._in = input; row._k = r.k;
    row.appendChild(input); box.appendChild(row);
  }
  // resynchronise l'affichage après un changement de préréglage
  function sync() {
    for (const row of box.children) {
      const i = row._in; if (!i || row._k === 'quality') continue;
      if (i.type === 'checkbox') i.checked = !!s.get(row._k); else { i.value = s.get(row._k); if (i._val) i._val.textContent = i._fmt(+i.value); }
    }
  }
  return box;
}

export const KEYS = [
  ['Z Q S D / W A S D / flèches', 'Se déplacer'], ['Souris', 'Regarder (cliquez dans le jeu pour capturer)'], ['Maj', 'Sprint'], ['Espace', 'Saut · frein à main en véhicule'],
  ['F', 'Monter / descendre · parler'], ['E', 'Entrer dans une boutique ou le garage'], ['Clic gauche / clic droit', 'Attaquer · viser'], ['Tab (maintenu)', 'Roue d\'armes'],
  ['H', 'Klaxon'], ['R', 'Radio suivante (en véhicule)'], ['N', 'Phares'], ['L', 'Classement de la session'], ['5-8', 'Emotes'], ['V', 'Changer de caméra'],
  ['P', 'Téléphone'], ['M', 'Carte plein écran'], ['Alt (maintenu)', 'Roue des personnages'], ['G', 'Capacité spéciale du perso'],
  ['K', 'Infos cluster (pod, latence, leader, Redis)'], ['T', 'Discussion'], ['F2', 'Replier le panneau HA'], ['Échap', 'Pause'], ['Manette', 'Stick gauche : bouger · stick droit : caméra · A : sauter · Y : entrer/sortir · RT : attaquer ou accélérer · LT : viser ou reculer · RB : frein à main · Start : pause'],
];

export function buildKeys() {
  const t = document.createElement('table');
  t.innerHTML = KEYS.map(([k, d], i) => `<tr><td>${i === 0 ? `${moveKeys()} / flèches` : k}</td><td>${d}</td></tr>`).join('');
  return t;
}

/** Boutique (vêtements / garage) : catalogue fourni par game.gameplay.shopCatalog. */
export function createShop(game, ui) {
  const el = document.createElement('div');
  el.className = 'kc-screen dim'; el.style.display = 'none'; el.style.zIndex = '42';
  ui.root.appendChild(el);
  let shopId = null;
  const render = (msg = '') => {
    const cat = game.gameplay?.shopCatalog?.(shopId);
    if (!cat) return hide();
    const groups = [...new Set(cat.items.map((i) => i.group))];
    el.innerHTML = `<div class="kc-card kc-shop"><h3 class="kc-h">${cat.title}</h3><div style="color:var(--dim);margin:-8px 0 6px">${cat.subtitle}</div>
      <div style="font-size:20px;color:var(--green)">${formatMoney(game.gameplay.money)} <small style="color:var(--yellow);font-size:14px;margin-left:10px">${msg}</small></div>
      ${groups.map((g) => `<div class="grp">${g}</div><div class="items">${cat.items.filter((i) => i.group === g).map((i) => i.color
        ? `<button class="kc-sw" data-id="${i.id}" ${i.disabled ? 'disabled' : ''}><i style="background:${i.color}"></i>${i.price} €</button>`
        : `<button class="kc-sw wide" data-id="${i.id}" ${i.disabled ? 'disabled' : ''}><span>${i.label}</span><b>${i.price} €</b></button>`).join('')}</div>`).join('')}
      <button class="kc-btn pink" data-close>Quitter (Échap)</button></div>`;
    el.querySelector('[data-close]').onclick = hide;
    for (const b of el.querySelectorAll('[data-id]')) b.onclick = () => { const r = game.gameplay.buy(shopId, b.dataset.id); render(r.message); };
  };
  function show(id) { shopId = id; el.style.display = 'flex'; game.input.exitPointerLock(); render(); }
  function hide() { el.style.display = 'none'; shopId = null; }
  return { el, show, hide, get open() { return !!shopId; } };
}
