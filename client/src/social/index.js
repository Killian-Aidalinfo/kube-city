// SOCIAL : de quoi jouer à plusieurs. Courses entre joueurs (compte à rebours commun, classement final), Chasse aux kubes
// dorés (événement de ville piloté par le leader serveur), classement de la session (touche L), emotes (touches 5 à 8).
// L'état partagé vit dans Redis côté serveur ; ici on ne fait qu'afficher et envoyer. API : game.social.
import * as THREE from 'three';
import { makeBubble } from '../net/remote.js';

export const EMOTES = [
  { id: 'salut', key: 'Digit5', icon: '👋', label: 'Salut' },
  { id: 'danse', key: 'Digit6', icon: '💃', label: 'Danse' },
  { id: 'bravo', key: 'Digit7', icon: '👏', label: 'Bravo' },
  { id: 'rire', key: 'Digit8', icon: '😂', label: 'Rire' },
];
const RACE_MAX_MS = 5 * 60_000;
const FINISH_RADIUS = 22, KUBE_RADIUS = 4;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtMs = (ms) => `${(ms / 1000).toFixed(1)} s`;
const fmtClock = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;

const CSS = `.kc-soc-count{position:absolute;left:50%;top:16%;transform:translateX(-50%);z-index:36;text-align:center;pointer-events:none;color:#fff;text-shadow:0 2px 12px #000}
.kc-soc-count .big{font:800 96px/1 system-ui,sans-serif;color:var(--yellow,#ffd23f)}.kc-soc-count .sm{font:700 18px/1.4 system-ui,sans-serif;background:rgba(0,0,0,.55);padding:6px 16px;border-radius:12px;border:1px solid var(--cyan,#38e8ff)}
.kc-soc-hunt{position:absolute;left:50%;top:46px;transform:translateX(-50%);z-index:34;font:700 14px/1.4 system-ui,sans-serif;color:#1b1400;background:linear-gradient(90deg,#ffd23f,#ffb300);padding:5px 16px;border-radius:14px;box-shadow:0 0 18px rgba(255,200,40,.6);pointer-events:none}
.kc-soc-panel{position:absolute;z-index:37;background:var(--panel2,#141a33);border:1px solid var(--cyan,#38e8ff);border-radius:12px;padding:12px 16px;font-size:14px;color:#fff;box-shadow:0 0 20px rgba(56,232,255,.25)}
.kc-soc-res{right:18px;top:35%;width:min(320px,90vw)}.kc-soc-board{left:50%;top:14%;transform:translateX(-50%);width:min(520px,94vw)}
.kc-soc-panel h3{margin:0 0 8px;font-size:16px;color:var(--cyan,#38e8ff)}.kc-soc-panel table{width:100%;border-collapse:collapse}.kc-soc-panel td,.kc-soc-panel th{padding:3px 6px;text-align:left;border-bottom:1px solid rgba(255,255,255,.08)}
.kc-soc-panel td.n,.kc-soc-panel th.n{text-align:right}.kc-soc-panel tr.me{color:var(--yellow,#ffd23f);font-weight:700}.kc-soc-panel small{color:var(--dim,#9aa7d8)}`;

/** @param {object} game contexte (spec 3.1) */
export function install(game) {
  const bus = game.bus;
  let off = 0; // décalage horloge serveur - horloge locale (compte à rebours commun à tous)
  const sNow = () => Date.now() + off;
  const syncNow = (t) => { if (Number.isFinite(t)) off = t - Date.now(); };
  const races = new Map();       // id -> vue de course (voir le serveur : store.raceView)
  const finished = new Set();    // courses où j'ai franchi la ligne
  const ended = new Set();       // courses clôturées
  let places = [], hunt = null, board = [], boardAt = 0, results = null, resultsUntil = 0;
  let boardOpen = false, goUntil = 0, lastFinishTry = 0, started = new Set();
  const me = () => game.net?.id;

  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const root = () => document.getElementById('ui-root') || document.body;
  const mk = (cls) => { const d = document.createElement('div'); d.className = cls; d.style.display = 'none'; root().appendChild(d); return d; };
  const elCount = mk('kc-soc-count'), elHunt = mk('kc-soc-hunt'), elRes = mk('kc-soc-panel kc-soc-res'), elBoard = mk('kc-soc-panel kc-soc-board');
  const notify = (text, kind = 'info', duration = 4) => bus.emit('notify', { text, kind, duration });
  const pos = () => game.player?.position;
  const gp = () => game.gameplay;
  fetch('/api/places').then((r) => r.json()).then((p) => { places = p; }).catch(() => {});

  // ---------- courses ----------
  const raceStatus = (r, t = sNow()) => (r.closed || t >= r.startAt + RACE_MAX_MS ? 'terminée' : t < r.startAt ? 'inscriptions' : 'en cours');
  const upsertRace = (r) => { if (r?.id) races.set(r.id, r); };
  const myRace = () => {
    const t = sNow();
    for (const r of races.values()) if (r.entrants?.[me()] && raceStatus(r, t) !== 'terminée' && !finished.has(r.id) && !ended.has(r.id)) return r;
    return null;
  };
  const lastPoint = (r) => r.checkpoints?.at(-1);

  function raceUpdate() {
    const r = myRace(), t = sNow();
    if (!r) { elCount.style.display = t < goUntil ? '' : 'none'; if (t >= goUntil) { game.ui?.setWaypoint?.(null, { auto: true }); } return; }
    const dest = lastPoint(r), left = (r.startAt - t) / 1000;
    elCount.style.display = '';
    if (left > 0) {
      const n = Math.ceil(left);
      elCount.innerHTML = n <= 5 ? `<div class="big">${n}</div><div class="sm">Course vers ${esc(r.toLabel)}</div>` : `<div class="sm">Course vers ${esc(r.toLabel)} · départ dans ${n} s · ${Object.keys(r.entrants).length} inscrit(s)</div>`;
      if (!started.has(r.id + ':wait')) { started.add(r.id + ':wait'); }
      return;
    }
    if (!started.has(r.id)) { started.add(r.id); goUntil = t + 1500; bus.emit('ui:sound', { name: 'ui_click', volume: 0.8 }); notify('Partez ! Rendez-vous à l\'arrivée.', 'success', 3); }
    const d = dest && pos() ? Math.round(Math.hypot(dest.x - pos().x, dest.z - pos().z)) : null;
    elCount.innerHTML = t < goUntil ? `<div class="big">PARTEZ !</div>` : `<div class="sm">Course vers ${esc(r.toLabel)} · ${fmtMs(t - r.startAt)}${d != null ? ` · ${d} m` : ''}</div>`;
    if (dest) game.ui?.setWaypoint?.({ x: dest.x, y: 0, z: dest.z }, { auto: true });
    // arrivée : le serveur contrôle (course en cours, inscrit, pas plus vite qu'une voiture à fond) ; on réessaie chaque seconde
    if (dest && pos() && d <= FINISH_RADIUS && game.state === 'playing' && performance.now() - lastFinishTry > 1200) {
      lastFinishTry = performance.now();
      game.net?.send('race_finish', { raceId: r.id });
    }
  }

  function showResults(title, rows, mineId) {
    results = { title, rows, mineId }; resultsUntil = performance.now() + 22000;
    elRes.innerHTML = `<h3>${esc(title)}</h3><table>${rows.map((x, i) => `<tr class="${x.id === me() ? 'me' : ''}"><td>${x.place ?? x.rank ?? i + 1}</td><td>${esc(x.name)}</td><td class="n">${x.ms != null ? fmtMs(x.ms) : x.count != null ? `${x.count} kube${x.count > 1 ? 's' : ''}` : 'abandon'}</td></tr>`).join('')}</table>`;
    elRes.style.display = '';
  }

  // ---------- chasse aux kubes dorés ----------
  const huntGroup = new THREE.Group(); huntGroup.name = 'social-hunt'; game.three.scene.add(huntGroup);
  const huntMeshes = new Map(); // index -> groupe
  const gold = new THREE.MeshStandardMaterial({ color: 0xffc400, emissive: 0xffa000, emissiveIntensity: 1.6, roughness: 0.25, metalness: 0.8 });
  const beam = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.28, depthWrite: false });
  const groundY = (x, z) => { try { return game.world?.groundHeight?.(x, z) ?? 0; } catch { return 0; } };
  const claimTry = new Map();
  function setHunt(h) {
    if (h?.id !== hunt?.id) { for (const g of huntMeshes.values()) huntGroup.remove(g); huntMeshes.clear(); claimTry.clear(); }
    hunt = h || null;
    if (hunt) for (const k of hunt.kubes) {
      const taken = hunt.claims?.[k.i] != null;
      if (taken && huntMeshes.has(k.i)) { huntGroup.remove(huntMeshes.get(k.i)); huntMeshes.delete(k.i); }
      else if (!taken && !huntMeshes.has(k.i)) {
        const g = new THREE.Group();
        const cube = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), gold);
        const ray = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 90, 12, 1, true), beam);
        ray.position.y = 45 - 1.3;
        g.add(cube, ray); g.userData = { cube, k };
        g.position.set(k.x, groundY(k.x, k.z) + 1.4, k.z);
        huntMeshes.set(k.i, g); huntGroup.add(g);
      }
    }
  }
  function huntUpdate(dt) {
    if (hunt && sNow() > hunt.endAt + 8000) setHunt(null);
    if (!hunt) { elHunt.style.display = 'none'; return; }
    const t = performance.now() / 1000, p = pos();
    let near = null, nd = 1e9;
    for (const [i, g] of huntMeshes) {
      g.userData.cube.rotation.set(0.4, t * 1.6 + i, 0.3); g.userData.cube.position.y = Math.sin(t * 2 + i) * 0.2;
      const k = g.userData.k, d = p ? Math.hypot(p.x - k.x, p.z - k.z) : 1e9;
      if (d < nd) { nd = d; near = k; }
      if (d < KUBE_RADIUS && game.state === 'playing' && performance.now() - (claimTry.get(i) || 0) > 1000) {
        claimTry.set(i, performance.now());
        game.net?.send('hunt_claim', { huntId: hunt.id, i });
      }
    }
    const left = hunt.kubes.length - Object.keys(hunt.claims || {}).length;
    elHunt.style.display = game.state === 'playing' ? '' : 'none';
    elHunt.textContent = `Chasse aux kubes dorés · ${left} restant${left > 1 ? 's' : ''} · ${fmtClock((hunt.endAt - sNow()) / 1000)}${nd < 1e8 ? ` · le plus proche : ${Math.round(nd)} m` : ''}`;
    // GPS vers le kube le plus proche, sauf course ou mission en cours
    if (near && !myRace() && !gp()?.active) game.ui?.setWaypoint?.({ x: near.x, y: 0, z: near.z }, { auto: true });
    else if (!near && !myRace() && !gp()?.active) game.ui?.setWaypoint?.(null, { auto: true });
  }

  // ---------- classement de la session (touche L) ----------
  function fetchBoard() { if (game.net?.connected) game.net.send('sboard'); boardAt = performance.now(); }
  function renderBoard() {
    const rows = board.map((r, i) => `<tr class="${r.id === me() ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td class="n">${Math.round(r.money)} €</td><td class="n">${r.races}</td><td class="n">${r.kubes}</td></tr>`).join('');
    elBoard.innerHTML = `<h3>Classement de la session <small>· L pour fermer</small></h3><table><tr><th>#</th><th>Joueur</th><th class="n">Argent gagné</th><th class="n">Courses</th><th class="n">Kubes</th></tr>${rows || '<tr><td colspan="5"><small>Personne n\'a encore gagné d\'argent. À vous de jouer.</small></td></tr>'}</table>`;
  }
  function toggleBoard(v = !boardOpen) {
    boardOpen = v; elBoard.style.display = v ? '' : 'none';
    if (v) { renderBoard(); fetchBoard(); }
  }

  // ---------- emotes (touches 5 à 8 : 1 à 4 servent aux armes) ----------
  const bubbles = [];
  function localBubble(icon) {
    const obj = game.player?.object3d || game.player?.mesh || game.player?.root;
    if (!obj) return;
    const b = makeBubble(icon); b.position.y = 2.7; obj.add(b);
    bubbles.push({ b, obj, until: performance.now() + 3000 });
  }
  function emote(id) {
    if (!EMOTES.some((e) => e.id === id) || !game.net?.sendEmote) return false;
    return game.net.sendEmote(id);
  }
  window.addEventListener('keydown', (e) => {
    if (e.repeat || game.state !== 'playing' || game.ui?.modalOpen) return;
    const tg = document.activeElement?.tagName; if (tg === 'INPUT' || tg === 'TEXTAREA') return;
    const em = EMOTES.find((x) => x.key === e.code);
    if (em) emote(em.id);
  });

  // ---------- messages du serveur ----------
  bus.on('net:welcome', (m) => {
    syncNow(m.now);
    races.clear(); for (const r of m.races || []) upsertRace(r);
    setHunt(m.hunt);
  });
  bus.on('net:message', (m) => {
    if (m.now) syncNow(m.now);
    switch (m.t) {
      case 'race': upsertRace(m.race); break;
      case 'joined':
        if (m.ok === false) notify(`Inscription impossible : ${m.reason}.`, 'warning', 4);
        else notify('Inscrit à la course. Placez-vous sur la ligne de départ !', 'success', 3);
        break;
      case 'race_error': notify(`Course impossible : ${m.reason}.`, 'warning', 4); break;
      case 'finish':
        if (m.ok) {
          finished.add(m.raceId);
          gp()?.addMoney?.(m.prize, 'course');
          if (gp()?.stats) gp().stats.races++;
          notify(`Arrivée ! Place ${m.place} en ${fmtMs(m.ms)} : +${m.prize} €. Classement final dans un instant.`, 'success', 6);
        } else if (/déjà arrivé|inconnue|pas inscrit|pas en cours/.test(m.reason || '')) { const r = myRace(); if (r) finished.add(r.id); }
        break;
      case 'race_end': {
        ended.add(m.raceId);
        const r = races.get(m.raceId); if (r) r.closed = true;
        showResults(`Course vers ${m.toLabel} : classement final`, m.rows, me());
        break;
      }
      case 'hunt': setHunt(m.hunt); break;
      case 'hunt_claim':
        if (m.ok) { gp()?.addMoney?.(m.reward, 'kube doré'); notify(`Kube doré ramassé : +${m.reward} €`, 'success', 3); }
        else if (m.taken) notify('Trop tard, ce kube doré est déjà pris.', 'warning', 2.5);
        break;
      case 'hunt_end':
        if (hunt?.id === m.huntId) setHunt(null);
        if (m.winner?.id === me()) { gp()?.addMoney?.(m.prize, 'chasse aux kubes dorés'); notify(`Vous remportez la chasse aux kubes dorés : +${m.prize} €`, 'success', 6); }
        if (m.rows?.length) showResults('Chasse aux kubes dorés', m.rows.map((r, i) => ({ ...r, rank: i + 1 })), me());
        break;
      case 'sboard': board = m.rows || []; if (boardOpen) renderBoard(); break;
    }
  });
  bus.on('net:chat', (c) => {
    if (c.history || c.from !== 'Radio Kube' || /(entre|arrive) en ville/.test(c.text)) return;
    notify(`Radio Kube : ${c.text}`, 'info', 7);
  });
  bus.on('net:emote', ({ id, e }) => {
    const em = EMOTES.find((x) => x.id === e);
    if (em && id === me()) localBubble(em.icon);
  });

  // ---------- gains de la session envoyés au serveur (classement) ----------
  const pend = { money: 0, kubes: 0 };
  let kubeBase = null, flushT = 0;
  bus.on('money:changed', ({ delta }) => { if (delta > 0) pend.money += delta; });

  game.onUpdate((dt) => {
    if (game.state !== 'playing') { elCount.style.display = 'none'; elHunt.style.display = 'none'; return; }
    const g = gp();
    if (g) { const f = g.kubes?.found ?? 0; if (kubeBase === null) kubeBase = f; else if (f > kubeBase) { pend.kubes += f - kubeBase; kubeBase = f; } else kubeBase = f; }
    flushT += dt;
    if (flushT > 5 && (pend.money > 0 || pend.kubes > 0) && game.net?.connected) {
      flushT = 0;
      const m = Math.min(3000, Math.floor(pend.money)), k = Math.min(5, pend.kubes);
      pend.money -= m; pend.kubes -= k;
      game.net.send('stat', { money: m, kubes: k });
    }
    if (game.input.pressed('board')) toggleBoard();
    if (boardOpen && performance.now() - boardAt > 2500) fetchBoard();
    raceUpdate(); huntUpdate(dt);
    if (results && performance.now() > resultsUntil) { results = null; elRes.style.display = 'none'; }
    const now = performance.now();
    for (let i = bubbles.length - 1; i >= 0; i--) if (now > bubbles[i].until) { bubbles[i].obj.remove(bubbles[i].b); bubbles.splice(i, 1); }
  }, 120, { real: true });

  // première invite, une seule fois par navigateur
  let hinted = false;
  bus.on('state:changed', ({ to }) => {
    if (to !== 'playing' || hinted) return; hinted = true;
    setTimeout(() => notify('Jouez ensemble : L = classement, 5 à 8 = emotes, téléphone > Courses pour défier les autres.', 'info', 8), 6000);
  });

  game.social = {
    emotes: EMOTES, get places() { return places; },
    get hunt() { return hunt; }, get board() { return board; }, get serverOffset() { return off; },
    serverNow: sNow, raceStatus,
    /** Courses visibles (en inscription ou en cours) pour le téléphone. */
    raceList() {
      const t = sNow();
      return [...races.values()].filter((r) => raceStatus(r, t) !== 'terminée' && !ended.has(r.id)).sort((a, b) => a.startAt - b.startAt).map((r) => ({
        id: r.id, toLabel: r.toLabel, creatorName: r.creatorName, status: raceStatus(r, t), secs: Math.ceil((r.startAt - t) / 1000),
        entrants: Object.values(r.entrants || {}), joined: !!r.entrants?.[me()], done: finished.has(r.id),
      }));
    },
    createRace(to) { return game.net?.send('race_new', { to }); },
    joinRace(id) { return game.net?.send('race_join', { raceId: id }); },
    get myRace() { return myRace(); },
    fetchBoard, toggleBoard, emote,
    get boardOpen() { return boardOpen; },
  };
}
