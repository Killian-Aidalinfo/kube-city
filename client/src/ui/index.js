// INTERFACE (spec 12) : HUD, minimap, carte plein écran, téléphone, écran titre, sélection des persos,
// roue des persos, pause/réglages, écrans Arrêté / K.O. / Mission réussie. Style néon, en français.
import { injectStyle } from './style.js';
import { createHud } from './hud.js';
import { createFullMap } from './fullmap.js';
import { createPhone } from './phone.js';
import { createScreens } from './screens.js';
import { createShop } from './panels.js';
import { formatMoney } from './mapmath.js';
import { createOnboarding, autoQuality } from './onboarding.js';
import { createCluster } from './cluster.js';

/** @param {object} game contexte (spec 3.1) */
export function install(game) {
  injectStyle();
  const root = document.getElementById('ui-root');
  const bus = game.bus;
  const ui = { root, state: { route: null, waypoint: null } };
  const wp = { manual: null, auto: null, shownKey: '' };

  const hud = createHud(game, ui);
  const map = createFullMap(game, ui);
  const phone = createPhone(game, ui);
  const shop = createShop(game, ui);
  const screens = createScreens(game, ui);
  if (autoQuality(game)) setTimeout(() => bus.emit('notify', { text: 'Ordinateur sans carte graphique dédiée : qualité Basse activée (modifiable dans Pause > Réglages).', kind: 'info', duration: 6 }), 3000);
  const cluster = createCluster(game, ui);
  const tips = createOnboarding(game, ui);
  hud.el.classList.add('menu');

  const modalOpen = () => map.open || phone.open || shop.open;
  const unlock = () => { try { game.input.exitPointerLock(); } catch { /* rien */ } };

  // ---------- point GPS et itinéraire ----------
  const pt = (p) => ({ x: p.x, y: p.y ?? 0, z: p.z });
  function computeRoute() {
    const to = ui.state.waypoint, from = game.player?.position;
    if (!to || !from) { ui.state.route = null; return; }
    let pts = null;
    try { pts = game.world?.route?.({ x: from.x, y: from.y ?? 0, z: from.z }, to); } catch { pts = null; }
    ui.state.route = Array.isArray(pts) && pts.length > 1 ? pts.map((p) => ({ x: p.x, z: p.z })) : [{ x: from.x, z: from.z }, { x: to.x, z: to.z }];
  }
  function refreshWaypoint() {
    const shown = wp.manual || wp.auto;
    ui.state.waypoint = shown;
    const key = shown ? `${Math.round(shown.x)},${Math.round(shown.z)}` : '';
    computeRoute();
    if (key !== wp.shownKey) { wp.shownKey = key; bus.emit('ui:waypoint', shown ? { position: { ...shown } } : null); }
  }
  /** pos = {x, z} ou null. opts.auto : GPS de mission (le point posé à la main reste prioritaire). */
  ui.setWaypoint = (pos, opts = {}) => {
    if (opts.auto) {
      if (!pos) { if (!wp.auto) return; wp.auto = null; }
      else { if (wp.auto && Math.hypot(wp.auto.x - pos.x, wp.auto.z - pos.z) < 2) return; wp.auto = pt(pos); }
    } else wp.manual = pos ? pt(pos) : null;
    refreshWaypoint();
  };
  /** Premier objectif d'un débutant (aucune mission terminée, rien en cours) : le marqueur jaune de la première mission. */
  ui.firstGoal = () => {
    const gp = game.gameplay;
    if (!gp || gp.active || game.state !== 'playing' || Object.keys(gp.profile?.missions || {}).length) return null;
    const m = gp.markers?.find((k) => k.kind === 'mission');
    return m ? { x: m.x, z: m.z, label: m.label } : null;
  };
  let firstWp = false;
  function syncFirstGoal() {
    const g = ui.firstGoal();
    if (g && !wp.manual) { firstWp = true; ui.setWaypoint(g, { auto: true }); }
    else if (firstWp && !gp0()?.active) { firstWp = false; ui.setWaypoint(null, { auto: true }); }
    else firstWp = false;
  }
  const gp0 = () => game.gameplay;
  Object.defineProperty(ui, 'waypoint', { get: () => ui.state.waypoint });
  Object.defineProperty(ui, 'route', { get: () => ui.state.route });

  // ---------- ouverture / fermeture des panneaux ----------
  ui.openMap = () => { if (game.state !== 'playing' || modalOpen()) return; map.show(); unlock(); };
  ui.closeMap = () => { map.hide(); hud.showHint(6); };
  ui.openPhone = () => { if (game.state !== 'playing' || modalOpen()) return; phone.show(); };
  ui.closePhone = () => { phone.hide(); hud.showHint(6); };
  ui.openShop = (id) => shop.show(id);
  ui.pause = () => { if (game.state !== 'playing') return; unlock(); game.setState('paused'); screens.showPause(); };
  ui.resume = () => { screens.hidePause(); document.querySelectorAll('.kc-modal').forEach((e) => e.remove()); game.setState('playing'); hud.showHint(6); };
  ui.enterGame = () => {
    hud.el.classList.remove('menu');
    game.setState('playing');
    hud.showHint(10);
    bus.emit('notify', { text: 'Bienvenue à Kube City. Appuyez sur P pour le téléphone, M pour la carte.', kind: 'info', duration: 5 });
  };
  /** Écrans nommés (titre, selection, pause, carte, telephone). */
  ui.showScreen = (name) => {
    ({ title: screens.showTitle, selection: screens.showSelect, pause: ui.pause, carte: ui.openMap, telephone: ui.openPhone })[name]?.();
  };
  ui.hideScreen = (name) => {
    if (name === 'carte') ui.closeMap(); else if (name === 'telephone') ui.closePhone(); else if (name === 'pause') ui.resume(); else if (name === 'titre' || name === 'title') screens.hide('title');
  };
  ui.notify = (text, kind = 'info', duration = 3) => bus.emit('notify', { text, kind, duration });
  ui.cluster = cluster; ui.tips = tips; ui.hud = hud; ui.map = map; ui.phone = phone; ui.screens = screens;
  Object.defineProperty(ui, 'modalOpen', { get: () => modalOpen() || screens.wheelOpen || game.state === 'paused' });
  game.ui = ui;

  /** Saute les menus et choisit le premier perso (tests automatisés). */
  ui.quickStart = async (id) => {
    for (const n of ['title', 'select', 'load', 'pause']) screens.hide(n);
    document.querySelectorAll('.kc-modal').forEach((e) => e.remove());
    try { await game.gameplay?.chooseCharacter?.(id || game.gameplay?.characters?.[0] || 'ines'); } catch (e) { console.error('[ui] quickStart :', e); }
    ui.enterGame();
  };
  globalThis.__quickStart = (id) => ui.quickStart(id);

  // ---------- événements ----------
  bus.on('ui:shop', ({ id }) => { if (game.state === 'playing') shop.show(id); });
  bus.on('player:ko', () => { if (game.state === 'playing') screens.showEnd('ko', 'Vous vous réveillez à l\'hôpital. Frais de soins : 200 €.'); });
  bus.on('wanted:busted', () => { if (game.state === 'playing') screens.showEnd('busted', 'Vous êtes arrêté. Direction le commissariat, et une amende à payer.'); });
  bus.on('player:respawn', ({ where, cost }) => {
    screens.hideEnd();
    bus.emit('notify', { text: where === 'hôpital' ? `Réveil à l'hôpital. Frais : ${formatMoney(cost)}.` : `Libéré du commissariat. Amende : ${formatMoney(cost)}.`, kind: 'warning', duration: 4 });
  });
  bus.on('mission:started', ({ title }) => bus.emit('notify', { text: `Mission : ${title}`, kind: 'info', duration: 3.5 }));
  bus.on('mission:passed', ({ title, text, reward }) => screens.banner(title, text, reward, true));
  bus.on('mission:failed', ({ text }) => bus.emit('notify', { text: `Mission échouée : ${text}`, kind: 'danger', duration: 4 }));
  bus.on('character:switch', ({ to }) => bus.emit('notify', { text: `Vous jouez ${game.gameplay?.charData?.[to]?.short || to}.`, kind: 'success', duration: 3 }));

  // clic sur le jeu : capture du pointeur ; perte de capture (Échap) : pause
  game.canvas.addEventListener('click', () => { if (game.state === 'playing' && !modalOpen()) game.input.requestPointerLock(game.canvas); });
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && game.state === 'playing' && !modalOpen() && !screens.wheelOpen && !screens.titleOpen) ui.pause();
  });

  // ---------- boucle (ordre 100 : après la caméra) ----------
  let routeT = 0, syncT = 0;
  game.onUpdate((dt) => {
    hud.update(dt);
    const inp = game.input;
    inp.triggersDrive = !!game.player?.vehicle;
    tips.update(dt);
    if ((game.state === 'playing' || game.state === 'paused') && !screens.titleOpen && inp.pressed('cluster')) cluster.toggle();
    if (game.state === 'playing' && !screens.titleOpen) {
      if (inp.pressed('pause')) {
        if (shop.open) shop.hide(); else if (phone.open) { if (!phone.back()) ui.closePhone(); } else if (map.open) ui.closeMap(); else ui.pause();
      } else if (inp.pressed('map')) { if (map.open) ui.closeMap(); else ui.openMap(); }
      else if (inp.pressed('phone')) { if (phone.open) ui.closePhone(); else ui.openPhone(); }
      // roue des persos : Alt maintenu
      if (!modalOpen()) {
        if (inp.isDown('switchChar')) screens.showWheel(); else if (screens.wheelOpen) screens.hideWheel(true);
      } else if (screens.wheelOpen) screens.hideWheel(false);
    } else if (game.state === 'paused' && inp.pressed('pause') && screens.S.pause) ui.resume();
    // itinéraire : recalculé une fois par seconde, point manuel effacé à l'arrivée
    syncT -= dt; if (syncT <= 0) { syncT = 0.5; syncFirstGoal(); }
    routeT -= dt;
    if (routeT <= 0 && ui.state.waypoint) {
      routeT = 1;
      const p = game.player?.position, w = ui.state.waypoint;
      if (p && wp.manual && Math.hypot(p.x - w.x, p.z - w.z) < 14) { bus.emit('notify', { text: 'Destination atteinte.', kind: 'success', duration: 3 }); ui.setWaypoint(null); }
      else computeRoute();
    }
  }, 100, { real: true });

  screens.showTitle();
}
