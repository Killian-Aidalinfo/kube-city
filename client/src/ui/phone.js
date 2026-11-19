// Téléphone (P) : contacts, missions et activités, appareil photo, paramètres, joueurs connectés.
import { buildSettings } from './panels.js';
import { formatClock, formatMoney } from './mapmath.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const APPS = [
  { id: 'contacts', label: 'Contacts', ic: '☎', c: '#7bf59a' },
  { id: 'missions', label: 'Missions', ic: '★', c: '#ffd23f' },
  { id: 'activities', label: 'Activités', ic: '⚑', c: '#ff4fa3' },
  { id: 'photo', label: 'Photo', ic: '◉', c: '#38e8ff' },
  { id: 'races', label: 'Courses', ic: '⚐', c: '#ff8a3d' },
  { id: 'board', label: 'Classement', ic: '♛', c: '#ffd23f' },
  { id: 'emotes', label: 'Emotes', ic: '☺', c: '#7bf59a' },
  { id: 'players', label: 'Joueurs', ic: '☻', c: '#c08cff' },
  { id: 'settings', label: 'Réglages', ic: '⚙', c: '#c8d3f5' },
];

export function createPhone(game, ui) {
  const el = document.createElement('div');
  el.className = 'kc-screen kc-phone'; el.style.display = 'none';
  el.innerHTML = `<div class="kc-ph"><div class="top"><span class="clk"></span><span class="pod"></span></div><div class="body"></div><div class="home"><button class="kc-btn small" data-home>Accueil</button> <button class="kc-btn small pink" data-close>Fermer (P)</button></div></div>`;
  ui.root.appendChild(el);
  const body = el.querySelector('.body'), clk = el.querySelector('.clk'), podEl = el.querySelector('.pod');
  const gallery = [];
  let page = 'home', open = false, timer = 0, pod = '';
  game.bus.on('net:status', (s) => { pod = s.connected ? s.pod || '' : 'hors ligne'; });

  const item = (title, small, btn, chip) => `<div class="kc-item"><b>${esc(title)}${chip ? `<span class="kc-chip ${chip.cls}">${chip.text}</span>` : ''}</b>${small ? `<small>${esc(small)}</small>` : ''}${btn || ''}</div>`;

  function render() {
    const gp = game.gameplay;
    if (page === 'home') {
      body.innerHTML = `<h3>${esc(gp?.charData?.[gp.currentCharacter]?.short || 'Téléphone')} · ${formatMoney(gp?.money ?? 0)}</h3><div class="kc-apps">${APPS.map((a) => `<button class="kc-app" data-app="${a.id}" style="--c:${a.c}"><div class="ic">${a.ic}</div>${a.label}</button>`).join('')}</div>`;
    } else if (page === 'contacts') {
      body.innerHTML = `<h3>Contacts</h3>
        ${item('Chez Lou (garage)', 'Livre votre véhicule personnel là où vous êtes : 50 €.', '<button class="kc-btn small" data-act="garage">Appeler</button>')}
        ${item('Taxi Kube', 'Un taxi vient se ranger près de vous.', '<button class="kc-btn small" data-act="taxi">Appeler</button>')}
        ${item('Lou', 'Le patron du garage. Il a toujours du travail.', '<button class="kc-btn small" data-act="gps-garage">Itinéraire vers le garage</button>')}`;
    } else if (page === 'missions') {
      const list = gp?.missions || [];
      body.innerHTML = `<h3>Missions</h3>${list.map((m) => item(m.title, m.summary,
        m.status === 'available' ? `<button class="kc-btn small" data-mission="${m.id}">Lancer · ${m.reward} €</button>` : '',
        { cls: m.status, text: m.status === 'done' ? 'Terminée' : m.status === 'available' ? 'Disponible' : 'Verrouillée' })).join('') || '<small>Aucune mission.</small>'}`;
    } else if (page === 'activities') {
      const acts = gp?.activities || [];
      const act = gp?.active;
      body.innerHTML = `<h3>Activités</h3>${act ? item(`En cours : ${act.title}`, act.text, '<button class="kc-btn small pink" data-act="abandon">Abandonner</button>') : ''}
        ${acts.map((a) => item(a.title, a.summary, `<button class="kc-btn small" data-activity="${a.id}">Lancer</button>`)).join('')}
        ${item('Cascades', 'Sautez des rampes à plus de 30 km/h : plus vous restez en l\'air, plus le bonus grimpe.', '', { cls: 'available', text: 'Permanent' })}
        ${item('Kubes à collectionner', `${gp?.kubes?.found ?? 0} / 50 trouvés. Ils flottent un peu partout, près des routes.`, '', { cls: 'available', text: 'Permanent' })}`;
    } else if (page === 'photo') {
      body.innerHTML = `<h3>Appareil photo</h3><div class="kc-item"><small>Cadrez la scène avec la caméra du jeu, puis prenez la photo. Certaines missions demandent une photo.</small>
        <button class="kc-btn small" data-act="shot">Prendre une photo</button> <button class="kc-btn small" data-act="selfie">Selfie</button></div>
        <div class="kc-gal">${gallery.map((g) => `<img src="${g}" alt="Photo">`).join('')}</div>`;
    } else if (page === 'players') {
      const pl = game.net?.players;
      const arr = pl instanceof Map ? [...pl.values()] : Array.isArray(pl) ? pl : [];
      body.innerHTML = `<h3>Joueurs connectés</h3>${item(`${gp?.charData?.[gp.currentCharacter]?.short || 'Moi'} (vous)`, pod ? `Pod : ${pod}` : '')}
        ${arr.map((p) => item(p.name || 'Joueur', p.character ? `Perso : ${p.character}` : '')).join('') || '<small>Aucun autre joueur pour le moment.</small>'}`;
    } else if (page === 'races') {
      const so = game.social;
      body.innerHTML = `<h3>Course entre joueurs</h3>${item('Lancer une course', 'Les autres ont 30 s pour vous rejoindre, près de vous. Départ commun, classement pour tous.',
        `<select data-race-to class="kc-btn small">${(so?.places || []).map((p) => `<option value="${esc(p.key)}">${esc(p.label)}</option>`).join('')}</select> <button class="kc-btn small" data-race-new>Lancer</button>`)}<div data-rl></div>`;
      refreshLive();
    } else if (page === 'board') {
      body.innerHTML = '<h3>Classement de la session</h3><div data-bl></div>';
      game.social?.fetchBoard(); refreshLive();
    } else if (page === 'emotes') {
      body.innerHTML = `<h3>Emotes</h3>${item('Touches 5 à 8 en jeu', 'Les autres joueurs voient votre emote au-dessus de votre tête.')}
        ${(game.social?.emotes || []).map((e) => item(`${e.icon} ${e.label}`, `Touche ${e.key.replace('Digit', '')}`, `<button class="kc-btn small" data-emote="${e.id}">Essayer</button>`)).join('')}`;
    } else if (page === 'settings') {
      body.innerHTML = '<h3>Réglages</h3>';
      body.appendChild(buildSettings(game));
    }
  }

  // Courses et classement : seule la partie vivante est redessinée (la liste déroulante garde sa valeur)
  function refreshLive() {
    const so = game.social;
    const rl = body.querySelector('[data-rl]');
    if (rl) rl.innerHTML = (so?.raceList() || []).map((r) => item(`Vers ${r.toLabel}`,
      `${r.status === 'inscriptions' ? `Départ dans ${Math.max(0, r.secs)} s` : 'En cours'} · lancée par ${r.creatorName} · ${r.entrants.length} inscrit(s) : ${r.entrants.join(', ')}`,
      r.status === 'inscriptions' && !r.joined ? `<button class="kc-btn small" data-race-join="${esc(r.id)}">Rejoindre</button>` : '',
      r.joined ? { cls: 'available', text: r.done ? 'Arrivé' : 'Inscrit' } : undefined)).join('') || '<small>Aucune course ouverte. Lancez la première !</small>';
    const bl = body.querySelector('[data-bl]');
    if (bl) bl.innerHTML = `<table style="width:100%"><tr><th align="left">#</th><th align="left">Joueur</th><th align="right">€</th><th align="right">Courses</th><th align="right">Kubes</th></tr>${(so?.board || []).map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td align="right">${Math.round(r.money)}</td><td align="right">${r.races}</td><td align="right">${r.kubes}</td></tr>`).join('')}</table>`;
  }

  function shot(selfie) {
    try {
      const { renderer, scene, camera } = game.three;
      renderer.render(scene, camera);
      const url = game.canvas.toDataURL('image/jpeg', 0.8);
      gallery.unshift(url); gallery.length = Math.min(gallery.length, 6);
      game.bus.emit('ui:photo', { dataUrl: url, selfie });
      game.bus.emit('notify', { text: selfie ? 'Selfie enregistré.' : 'Photo enregistrée.', kind: 'success', duration: 2 });
      const f = document.createElement('div'); f.className = 'kc-flash'; ui.root.appendChild(f); setTimeout(() => f.remove(), 400);
      render();
    } catch (e) { game.bus.emit('notify', { text: 'Photo impossible.', kind: 'danger', duration: 2 }); }
  }

  el.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    const gp = game.gameplay;
    if (t.dataset.app) { page = t.dataset.app; render(); }
    else if ('home' in t.dataset) { page = 'home'; render(); }
    else if ('close' in t.dataset) ui.closePhone();
    else if (t.dataset.mission) { if (gp.startMission(t.dataset.mission)) ui.closePhone(); else render(); }
    else if (t.dataset.activity) { if (gp.startActivity(t.dataset.activity)) ui.closePhone(); else render(); }
    else if ('raceNew' in t.dataset) { const sel = body.querySelector('[data-race-to]'); if (sel?.value) game.social?.createRace(sel.value); }
    else if (t.dataset.raceJoin) game.social?.joinRace(t.dataset.raceJoin);
    else if (t.dataset.emote) game.social?.emote(t.dataset.emote);
    else if (t.dataset.act === 'abandon') { gp.abandon(); render(); }
    else if (t.dataset.act === 'taxi') { gp.callTaxi(); }
    else if (t.dataset.act === 'garage') { gp.callGarage(); }
    else if (t.dataset.act === 'gps-garage') { const p = gp.place('garage'); ui.setWaypoint({ x: p.x, y: 0, z: p.z }, { manual: true }); ui.closePhone(); }
    else if (t.dataset.act === 'shot') shot(false);
    else if (t.dataset.act === 'selfie') shot(true);
    game.bus.emit('ui:sound', { name: 'ui_click', volume: 0.4 });
  });

  return {
    el,
    get open() { return open; },
    show() { if (open) return; open = true; page = 'home'; el.style.display = 'flex'; game.input.exitPointerLock(); render(); timer = setInterval(() => { clk.textContent = formatClock(game.time.dayTime); podEl.textContent = pod; if (page === 'races' || page === 'board') refreshLive(); }, 500); clk.textContent = formatClock(game.time.dayTime); podEl.textContent = pod; },
    hide() { open = false; el.style.display = 'none'; clearInterval(timer); },
    back() { if (page !== 'home') { page = 'home'; render(); return true; } return false; },
  };
}
