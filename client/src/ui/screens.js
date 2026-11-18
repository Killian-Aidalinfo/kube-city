// Écrans plein écran : titre, sélection des persos, chargement, pause, « Arrêté » / « K.O. », « Mission réussie », roue des persos.
import { buildSettings, buildKeys } from './panels.js';
import { renderPortraits } from './portrait.js';
import { formatMoney, TIPS } from './mapmath.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const CHAR_COLORS = { ines: '#ff6a55', malik: '#4aa3ff', jade: '#b06aff' };
const mk = (cls, html = '') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; return d; };

/** Fenêtre modale simple avec un bouton Fermer. */
export function modal(ui, title, node, cls = 'kc-set') {
  const el = mk('kc-screen dim kc-modal'); el.style.zIndex = '55';
  const card = mk(`kc-card ${cls}`, `<h3 class="kc-h">${esc(title)}</h3>`);
  card.appendChild(node);
  const b = document.createElement('button'); b.className = 'kc-btn pink'; b.textContent = 'Fermer'; card.appendChild(b);
  el.appendChild(card); ui.root.appendChild(el);
  const close = () => { el.remove(); };
  b.onclick = close; el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
  b.focus();
  return { el, close };
}

/** Fond animé de l'écran titre : soleil, immeubles, grille en perspective. */
function animateTitle(cv) {
  const g = cv.getContext('2d');
  let raf = 0, W = 0, H = 0;
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const bld = Array.from({ length: 34 }, () => ({ x: rnd(), w: 0.025 + rnd() * 0.05, h: 0.1 + rnd() * 0.32, layer: rnd() < 0.5 ? 0 : 1, lit: rnd() }));
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (!cv.isConnected) { cancelAnimationFrame(raf); return; }
    if (cv.width !== cv.clientWidth || cv.height !== cv.clientHeight) { W = cv.width = cv.clientWidth; H = cv.height = cv.clientHeight; }
    const hz = H * 0.58, s = t / 1000;
    const sky = g.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, '#05081a'); sky.addColorStop(0.6, '#2a0f55'); sky.addColorStop(1, '#a8267f');
    g.fillStyle = sky; g.fillRect(0, 0, W, hz);
    // soleil rayé
    const r = Math.min(W, H) * 0.2, cx = W / 2, cy = hz - r * 0.35;
    const sun = g.createLinearGradient(0, cy - r, 0, cy + r); sun.addColorStop(0, '#ffd23f'); sun.addColorStop(1, '#ff4fa3');
    g.save(); g.beginPath(); g.arc(cx, cy, r, 0, 7); g.clip(); g.fillStyle = sun; g.fillRect(cx - r, cy - r, r * 2, r * 2);
    g.fillStyle = '#2a0f55'; for (let i = 0; i < 7; i++) { const y = cy + r * (0.05 + i * 0.14); g.fillRect(cx - r, y, r * 2, 2 + i * 1.6); } g.restore();
    // immeubles
    for (const layer of [0, 1]) for (const b of bld) {
      if (b.layer !== layer) continue;
      const x = b.x * W, w = b.w * W, h = b.h * H * (layer ? 0.8 : 1);
      g.fillStyle = layer ? '#0d0a24' : '#160d38'; g.fillRect(x, hz - h, w, h);
      g.fillStyle = layer ? '#ff4fa3' : '#38e8ff';
      for (let yy = hz - h + 8; yy < hz - 6; yy += 14) for (let xx = x + 5; xx < x + w - 6; xx += 12) if (((xx * 7 + yy * 13 + Math.floor(s * (0.3 + b.lit))) | 0) % 5 === 0) g.fillRect(xx, yy, 4, 6);
    }
    // sol et grille
    g.fillStyle = '#0a0620'; g.fillRect(0, hz, W, H - hz);
    g.strokeStyle = 'rgba(255,79,163,.7)'; g.lineWidth = 1.5;
    for (let i = -20; i <= 20; i++) { g.beginPath(); g.moveTo(cx + i * 20, hz); g.lineTo(cx + i * W * 0.16, H); g.stroke(); }
    const off = (s * 0.4) % 1;
    for (let i = 0; i < 14; i++) { const k = (i + off) / 14, y = hz + (H - hz) * k * k; g.globalAlpha = 0.25 + k * 0.6; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.globalAlpha = 1;
  }
  raf = requestAnimationFrame(frame);
}

export function createScreens(game, ui) {
  const root = ui.root;
  const bus = game.bus;
  const S = { title: null, select: null, load: null, pause: null, end: null, wheel: null };
  let portraits = null, portraitsP = null;

  // ---------- titre ----------
  function showTitle() {
    hide('title');
    const el = S.title = mk('kc-screen kc-title');
    el.innerHTML = `<canvas></canvas><div class="in"><h1 class="kc-logo">KUBE <span>CITY</span></h1>
      <div class="kc-tag">Ville ouverte · Cluster inconnu · Haute disponibilité</div>
      <div class="menu"><button class="kc-btn" data-a="play" style="font-size:22px;padding:14px">Jouer</button><button class="kc-btn" data-a="set">Réglages</button><button class="kc-btn" data-a="keys">Touches</button></div></div>
      <div class="kc-foot">Un monde ouvert créé pour une journée de cours sur Kubernetes · Entrée pour jouer</div>`;
    root.appendChild(el);
    animateTitle(el.querySelector('canvas'));
    el.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      game.audio?.unlock?.();
      if (a === 'play') showSelect();
      else if (a === 'set') modal(ui, 'Réglages', buildSettings(game));
      else if (a === 'keys') modal(ui, 'Touches', buildKeys(), 'kc-keys');
    });
    el.querySelector('[data-a=play]').focus();
  }
  globalThis.addEventListener('keydown', (e) => { if (e.key === 'Enter' && S.title && !document.querySelector('.kc-card') && ['play', undefined].includes(document.activeElement?.dataset?.a)) { game.audio?.unlock?.(); showSelect(); } });

  // ---------- sélection du perso ----------
  async function showSelect() {
    if (S.select) return;
    hide('title');
    await game.gameplay?.ensureReady?.();
    const gp = game.gameplay, ids = gp?.characters || ['ines', 'malik', 'jade'];
    const el = S.select = mk('kc-screen kc-sel');
    const bar = (label, v) => `<div class="kc-stat"><span>${label}</span><div class="bar"><i style="width:${Math.round((v / 10) * 100)}%"></i></div><b>${(+v).toFixed(1).replace('.0', '')}</b></div>`;
    el.innerHTML = `<h2>Choisissez votre personnage</h2><p>Chacun a sa spécialité, sa planque, son argent. Vous pourrez changer en jeu (Alt).</p><div class="kc-chars">${ids.map((id, i) => {
      const c = gp.charData[id], st = gp.profile.chars[id].stats;
      return `<button class="kc-char" data-id="${id}" style="--c:${CHAR_COLORS[id]}"><div class="pic"><img alt="Portrait de ${esc(c.short)}" style="opacity:0"></div><div class="info">
        <h3 class="nm">${esc(c.name)}</h3><div class="sp">${esc(c.specialty)}</div>
        <p class="ab"><b>${esc(c.ability.name)}</b> (G) : ${esc(c.ability.desc)}</p>
        ${bar('Endurance', st.endurance)}${bar('Conduite', st.conduite)}${bar('Combat', st.combat)}
        <div class="go">${i + 1} · Jouer ${esc(c.short)}</div></div></button>`;
    }).join('')}</div>`;
    root.appendChild(el);
    const choose = (id) => { game.audio?.play?.('ui_ok'); startGame(id); };
    el.addEventListener('click', (e) => { const b = e.target.closest('.kc-char'); if (b) choose(b.dataset.id); });
    const onKey = (e) => {
      if (!S.select) return globalThis.removeEventListener('keydown', onKey);
      const i = '123'.indexOf(e.key);
      if (i >= 0 && ids[i]) choose(ids[i]);
      const cards = [...el.querySelectorAll('.kc-char')], cur = cards.indexOf(document.activeElement);
      if (e.key === 'ArrowRight') cards[(cur + 1) % cards.length].focus();
      if (e.key === 'ArrowLeft') cards[(cur - 1 + cards.length) % cards.length].focus();
    };
    globalThis.addEventListener('keydown', onKey);
    el.querySelector('.kc-char').focus();
    // portraits 3D (une seule fois), puis affichage progressif
    portraits = await getPortraits();
    for (const b of el.querySelectorAll('.kc-char')) { const img = b.querySelector('img'); img.src = portraits[b.dataset.id]; img.onload = () => { img.style.transition = 'opacity .4s'; img.style.opacity = 1; }; }
  }
  function getPortraits() {
    const gp = game.gameplay;
    portraitsP ||= renderPortraits(game, Object.fromEntries((gp?.characters || []).map((id) => [id, gp.profile.chars[id].outfit])));
    return portraitsP;
  }

  // ---------- chargement ----------
  async function startGame(id) {
    if (S.load) return;
    hide('select'); hide('title');
    const el = S.load = mk('kc-screen kc-load', '<h3>Chargement de Kube City</h3><div class="bar"><i></i></div><div class="tip"></div>');
    root.appendChild(el);
    const barI = el.querySelector('i'), tip = el.querySelector('.tip');
    let k = Math.floor(Math.random() * TIPS.length);
    const showTip = () => { tip.textContent = 'Astuce : ' + TIPS[k++ % TIPS.length]; };
    showTip(); const tt = setInterval(showTip, 2600);
    const t0 = performance.now(), MIN = 1500;
    let real = 0;
    const off = bus.on('assets:progress', ({ loaded, total }) => { real = total ? loaded / total : 0; });
    const tick = setInterval(() => { barI.style.width = `${Math.round(Math.min(1, Math.max(real, (performance.now() - t0) / MIN)) * 100)}%`; }, 60);
    try { await game.gameplay?.chooseCharacter?.(id); } catch (e) { console.error('[ui] choix du perso :', e); }
    await new Promise((r) => setTimeout(r, Math.max(0, MIN - (performance.now() - t0))));
    clearInterval(tt); clearInterval(tick); off();
    hide('load');
    ui.enterGame();
  }

  // ---------- pause ----------
  function showPause() {
    if (S.pause) return;
    const el = S.pause = mk('kc-screen dim');
    el.innerHTML = `<div class="kc-card kc-pause"><h2 class="kc-glow" style="color:var(--cyan)">Pause</h2>
      <button class="kc-btn" data-a="resume">Reprendre</button><button class="kc-btn" data-a="map">Carte</button><button class="kc-btn" data-a="set">Réglages</button><button class="kc-btn" data-a="keys">Touches</button><button class="kc-btn pink" data-a="quit">Quitter vers le titre</button></div>`;
    root.appendChild(el);
    el.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'resume') ui.resume();
      else if (a === 'map') { ui.resume(); ui.openMap(); }
      else if (a === 'set') modal(ui, 'Réglages', buildSettings(game));
      else if (a === 'keys') modal(ui, 'Touches', buildKeys(), 'kc-keys');
      else if (a === 'quit') { Promise.resolve(game.gameplay?.save?.()).finally(() => location.reload()); }
    });
    el.querySelector('button').focus();
  }

  // ---------- Arrêté / K.O. ----------
  function showEnd(kind, sub) {
    hide('end');
    const el = S.end = mk(`kc-screen kc-end ${kind}`, `<h1>${kind === 'busted' ? 'Arrêté' : 'K.O.'}</h1><p>${esc(sub)}</p>`);
    root.appendChild(el);
    game.canvas.style.transition = 'filter 1.2s'; game.canvas.style.filter = 'grayscale(1) contrast(1.15) blur(1.5px)';
  }
  function hideEnd() { hide('end'); game.canvas.style.filter = ''; }

  // ---------- Mission réussie ----------
  function banner(title, text, reward, ok = true) {
    const el = mk('kc-banner', `<h2 ${ok ? '' : 'style="color:var(--red);text-shadow:0 0 22px var(--red)"'}>${ok ? 'Mission réussie' : 'Mission échouée'}</h2><p>${esc(title)}</p>${text ? `<p style="font-size:16px;color:var(--dim)">${esc(text)}</p>` : ''}${reward ? `<p class="rw">+ ${formatMoney(reward)}</p>` : ''}`);
    root.appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .6s'; el.style.opacity = 0; setTimeout(() => el.remove(), 700); }, 4200);
  }

  // ---------- roue des persos (Alt) ----------
  const wheel = { el: null, sel: -1, dx: 0 };
  function showWheel() {
    if (wheel.el || !game.gameplay) return;
    const gp = game.gameplay, ids = gp.characters;
    const el = wheel.el = mk('kc-screen kc-wheel');
    el.innerHTML = `<div class="ring">${ids.map((id, i) => `<div class="opt ${id === gp.currentCharacter ? 'cur' : ''}" style="--c:${CHAR_COLORS[id]}"><div class="pic"><img alt="${esc(gp.charData[id].short)}" src="${portraits?.[id] || ''}"></div><b>${esc(gp.charData[id].short)}</b><small>${i + 1} · ${esc(gp.charData[id].ability.name)}</small></div>`).join('')}</div><div class="help">Bougez la souris ou touches 1 à 3 · relâchez Alt pour valider</div>`;
    root.appendChild(el);
    wheel.sel = Math.max(0, ids.indexOf(gp.currentCharacter)); wheel.dx = 0;
    if (!portraits) getPortraits().then((p) => { portraits = p; el.querySelectorAll('img').forEach((im, i) => { im.src = p[ids[i]]; }); });
    paintWheel();
  }
  function paintWheel() { wheel.el?.querySelectorAll('.opt').forEach((o, i) => o.classList.toggle('sel', i === wheel.sel)); }
  globalThis.addEventListener('mousemove', (e) => {
    if (!wheel.el) return;
    wheel.dx += e.movementX || 0;
    wheel.dx = Math.max(-120, Math.min(120, wheel.dx));
    const n = game.gameplay.characters.length;
    wheel.sel = Math.max(0, Math.min(n - 1, Math.round(((wheel.dx + 120) / 240) * (n - 1))));
    paintWheel();
  });
  globalThis.addEventListener('keydown', (e) => { if (wheel.el && '123'.includes(e.key) && e.key) { wheel.sel = +e.key - 1; paintWheel(); } });
  function hideWheel(apply) {
    if (!wheel.el) return;
    const id = game.gameplay.characters[wheel.sel];
    wheel.el.remove(); wheel.el = null;
    if (apply && id && id !== game.gameplay.currentCharacter) game.gameplay.switchCharacter(id);
  }

  function hide(name) { S[name]?.remove(); S[name] = null; }
  return {
    S, showTitle, showSelect, showPause, hidePause: () => hide('pause'), showEnd, hideEnd, banner, showWheel, hideWheel,
    get wheelOpen() { return !!wheel.el; }, get titleOpen() { return !!(S.title || S.select || S.load); }, startGame,
    hide,
  };
}
