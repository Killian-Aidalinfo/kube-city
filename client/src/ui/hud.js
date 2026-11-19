// HUD : minimap, santé/armure, étoiles, argent, arme, vitesse, radio, invites, notifications, sous-titres, objectif, panneau HA.
import { drawMinimap, createRoadCache, collectBlips } from './maprender.js';
import { formatMoney, formatDistance } from './mapmath.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createHud(game, ui) {
  const root = document.createElement('div');
  root.className = 'kc-hud';
  root.innerHTML = `
    <div class="kc-ha kc-ptr" title="Cliquez ou F2 pour replier">
      <span class="dot"></span><span class="v pod">en attente…</span>
      <span class="more"><span class="k">version</span> <span class="v ver">—</span> · <span class="k">ping</span> <span class="v ping">—</span> · <span class="k">reconnexions</span> <span class="v rec">0</span> · <span class="lead">leader IA : <span class="ld">—</span></span></span>
      <span class="tog">▾</span>
    </div>
    <div class="kc-notifs"></div>
    <div class="kc-tr">
      <div class="kc-stars">★★★★★</div>
      <div class="kc-money"><span class="m">0 €</span></div>
      <div class="kc-weapon">Poings</div>
      <div class="kc-abil"><span class="n"></span><div class="bar"><i></i></div></div>
      <div class="kc-obj" style="display:none"><h4></h4><p></p><div class="t"></div></div>
    </div>
    <div class="kc-mini"><canvas></canvas><div class="kc-district"></div></div>
    <div class="kc-hint" style="display:none">Cliquez dans le jeu pour piloter la caméra à la souris (Échap : pause)</div>
    <div class="kc-prompt" style="display:none"></div>
    <div class="kc-sub"></div>
    <div class="kc-sta" style="display:none"><i></i></div>
    <div class="kc-speed" style="display:none"><span class="n">0</span><span class="u">km/h</span><div class="r"></div></div>`;
  ui.root.appendChild(root);
  // jauge d'endurance : discrète, visible seulement quand elle n'est pas pleine
  const staStyle = document.createElement('style');
  staStyle.textContent = '.kc-sta{position:absolute;left:50%;bottom:66px;transform:translateX(-50%);width:180px;height:6px;border-radius:3px;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.25);overflow:hidden;pointer-events:none}.kc-sta i{display:block;height:100%;width:100%;background:#7fe0ff;transition:background .15s}.kc-sta.low i{background:#ff7a59}';
  document.head.appendChild(staStyle);
  const $ = (s) => root.querySelector(s);
  const el = {
    ha: $('.kc-ha'), pod: $('.pod'), ver: $('.ver'), ping: $('.ping'), rec: $('.rec'), ld: $('.ld'), tog: $('.tog'),
    notifs: $('.kc-notifs'), stars: $('.kc-stars'), money: $('.kc-money .m'), weapon: $('.kc-weapon'),
    abil: $('.kc-abil'), abilN: $('.kc-abil .n'), abilBar: $('.kc-abil .bar i'),
    obj: $('.kc-obj'), objH: $('.kc-obj h4'), objP: $('.kc-obj p'), objT: $('.kc-obj .t'),
    mini: $('.kc-mini canvas'), district: $('.kc-district'), hint: $('.kc-hint'), prompt: $('.kc-prompt'), sub: $('.kc-sub'),
    sta: $('.kc-sta'), staI: $('.kc-sta i'), speed: $('.kc-speed'), speedN: $('.kc-speed .n'), radio: $('.kc-speed .r'),
  };

  // ----- minimap -----
  const DPR = Math.min(2, globalThis.devicePixelRatio || 1), S = 236;
  el.mini.width = S * DPR; el.mini.height = S * DPR;
  const mctx = el.mini.getContext('2d');
  mctx.scale(DPR, DPR);
  const roads = createRoadCache(game);
  const mst = { scale: 0.72, roads: [], blips: [], route: null, waypoint: null };
  let blipT = 0, miniT = 0, slow = 0;

  // ----- panneau HA -----
  let collapsed = false;
  const toggleHa = () => { collapsed = !collapsed; el.ha.classList.toggle('collapsed', collapsed); el.tog.textContent = collapsed ? '▸' : '▾'; };
  el.ha.addEventListener('click', toggleHa);
  globalThis.addEventListener('keydown', (e) => { if (e.code === 'F2') { e.preventDefault(); toggleHa(); } });
  const offs = [];
  offs.push(game.bus.on('net:status', (s) => {
    el.ha.classList.toggle('down', !s.connected);
    el.pod.textContent = s.connected ? (s.pod || 'pod inconnu') : 'Reconnexion…';
    el.ver.textContent = s.version ?? '—';
    el.ping.textContent = s.connected && Number.isFinite(s.ping) ? `${Math.round(s.ping)} ms` : '—';
    el.rec.textContent = s.reconnects ?? 0;
    el.ld.textContent = s.leader === true ? 'ce pod' : s.leader || '—';
  }));

  // ----- notifications et sous-titres -----
  const notify = ({ text, kind = 'info', duration = 3 }) => {
    if (!text) return;
    const d = document.createElement('div');
    d.className = `kc-notif ${kind}`; d.textContent = text;
    el.notifs.appendChild(d);
    while (el.notifs.children.length > 5) el.notifs.firstChild.remove();
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 400); }, Math.max(1, duration) * 1000);
  };
  offs.push(game.bus.on('notify', notify));
  offs.push(game.bus.on('subtitle', ({ speaker, text, duration = 4 }) => {
    if (!game.settings.get('subtitles')) return;
    const d = document.createElement('div');
    d.innerHTML = `${speaker ? `<b>${esc(speaker)} :</b>` : ''}${esc(text)}`;
    el.sub.appendChild(d);
    while (el.sub.children.length > 2) el.sub.firstChild.remove();
    setTimeout(() => d.remove(), Math.max(1.5, duration) * 1000);
  }));

  // ----- invites -----
  const prompts = new Map();
  offs.push(game.bus.on('ui:prompt', ({ id, text }) => { if (text) prompts.set(id, text); else prompts.delete(id); }));
  let radioName = '';
  offs.push(game.bus.on('radio:station', ({ name }) => { radioName = name; }));
  offs.push(game.bus.on('money:changed', ({ amount }) => { el.money.textContent = formatMoney(amount); }));

  let hintUntil = 0;
  globalThis.addEventListener?.('pointerdown', () => { hintUntil = 0; }, true); // un clic dans le jeu suffit : le bandeau disparaît
  const hud = {
    el: root,
    show(v) { root.style.display = v ? '' : 'none'; },
    showHint(sec = 8) { hintUntil = game.time.now + Math.min(sec, 4); },
    hideHint() { hintUntil = 0; },
    update(dt) {
      const pl = game.player, pol = game.police;
      // étoiles
      const lv = pol?.level ?? 0;
      el.stars.innerHTML = Array.from({ length: 5 }, (_, i) => `<span class="${i < lv ? 'on' : ''}">★</span>`).join('');
      el.stars.classList.toggle('search', lv > 0 && !!pol?.searchZone);
      // arme
      const w = game.combat?.currentWeapon ?? game.combat?.weapon;
      const raw = typeof w === 'string' ? w : w?.name || 'Poings';
      const wn = raw.charAt(0).toUpperCase() + raw.slice(1);
      const ammo = w && typeof w === 'object' && Number.isFinite(w.ammo) ? ` · ${w.ammo}` : '';
      if (el.weapon.textContent !== wn + ammo) el.weapon.textContent = wn + ammo;
      // capacité spéciale
      const ab = game.gameplay?.ability;
      if (ab?.name) {
        el.abil.style.display = '';
        el.abilN.innerHTML = `<b>G</b> · ${esc(ab.name)}`;
        el.abilBar.style.width = `${Math.round(ab.gauge * 100)}%`;
        el.abil.classList.toggle('ready', ab.gauge >= ab.cost);
      } else el.abil.style.display = 'none';
      // endurance
      const stam = pl?.stamina, sMax = pl?.staminaMax || 100;
      const showSta = game.state === 'playing' && pl?.state !== 'inVehicle' && Number.isFinite(stam) && stam < sMax - 0.5;
      el.sta.style.display = showSta ? '' : 'none';
      if (showSta) { el.staI.style.width = `${Math.round(Math.max(0, stam) / sMax * 100)}%`; el.sta.classList.toggle('low', stam < 25); }
      // vitesse et radio
      const veh = pl?.vehicle;
      el.speed.style.display = veh ? '' : 'none';
      if (veh) { el.speedN.textContent = Math.round(Math.abs(veh.speed || 0)); el.radio.textContent = radioName ? `♪ ${radioName}` : ''; }
      // invites : celles des modules, sinon « Monter » près d'un véhicule
      let text = [...prompts.values()][0];
      if (!text && pl?.state === 'onFoot' && game.state === 'playing') {
        try { if (game.vehicles?.nearestEnterable?.(pl.position, 3)) text = 'F : Monter'; } catch { /* API absente */ }
      }
      el.prompt.style.display = text && game.state === 'playing' ? '' : 'none';
      if (text) el.prompt.textContent = text;
      el.hint.style.display = game.state === 'playing' && !game.input.pointerLocked && game.time.now < hintUntil ? '' : 'none';
      // objectif
      slow -= dt;
      if (slow <= 0) {
        slow = 0.25;
        const fg = game.gameplay?.active ? null : ui.firstGoal?.();
        const a = game.gameplay?.active || (fg && { kind: 'goal', title: 'Premier objectif', text: `Rejoignez le marqueur jaune « ${fg.label} » (flèche cyan sur la minimap) puis appuyez sur F pour parler.`, target: fg });
        el.obj.style.display = a ? '' : 'none';
        if (a) {
          el.objH.textContent = a.kind === 'mission' ? `Mission · ${a.title}` : a.title;
          el.objP.textContent = a.text || '';
          const parts = [];
          if (a.timeLeft != null) parts.push(`${Math.ceil(a.timeLeft)} s`);
          if (a.target && pl) parts.push(formatDistance(Math.hypot(a.target.x - pl.position.x, a.target.z - pl.position.z)));
          el.objT.textContent = parts.join(' · ');
        }
        const d = game.world?.district?.(pl?.position?.x ?? 0, pl?.position?.z ?? 0);
        if (d && el.district.textContent !== d.name) { el.district.textContent = d.name; el.district.style.color = d.color || ''; }
      }
      // minimap à ~30 i/s
      miniT -= dt; blipT -= dt;
      if (miniT <= 0) {
        miniT = 1 / 30;
        if (blipT <= 0) { blipT = 0.5; mst.blips = collectBlips(game); }
        mst.roads = roads.get(0.033);
        mst.route = ui.state.route; mst.waypoint = ui.state.waypoint;
        // zoom léger en véhicule rapide
        const target = veh ? 0.72 - Math.min(0.28, Math.abs(veh.speed || 0) / 400) : 0.72;
        mst.scale += (target - mst.scale) * 0.05;
        try { drawMinimap(mctx, game, mst, S); } catch (e) { console.error('[minimap]', e); }
      }
    },
    dispose() { for (const o of offs) o(); root.remove(); },
  };
  return hud;
}
