// Carte plein écran (M) : zoom, déplacement, légende, clic pour poser un point GPS.
import { project, drawRoads, drawRoute, drawBlip, drawArrow, drawSearch, collectBlips, createRoadCache, unitPos } from './maprender.js';
import { formatDistance, routeLength } from './mapmath.js';

export function createFullMap(game, ui) {
  const el = document.createElement('div');
  el.className = 'kc-screen kc-map'; el.style.display = 'none';
  el.innerHTML = `<canvas></canvas>
    <div class="kc-legend"><h3 class="kc-h" style="margin:0 0 8px">Légende</h3>
      <div><i style="background:#c8d3f5;border-radius:2px"></i>Lieu</div><div><i style="background:#ff6a7a"></i>Hôpital</div><div><i style="background:#6a8cff"></i>Commissariat</div>
      <div><i style="background:#ff4fa3"></i>Garage</div><div><i style="background:#ffd23f;border-radius:2px;transform:rotate(45deg)"></i>Mission</div>
      <div><i style="background:#38e8ff;border-radius:2px;transform:rotate(45deg)"></i>Point GPS</div><div><i style="background:#ff3c50"></i>Police</div><div><i style="background:#7bf59a"></i>Autre joueur</div>
      <div style="color:var(--dim);margin-top:10px;display:block">Clic : poser un point GPS<br>Clic droit : l'effacer<br>Molette : zoom · glisser : déplacer<br>M ou Échap : fermer</div></div>
    <div class="tools"><button class="kc-btn small" data-a="in">+</button><button class="kc-btn small" data-a="out">−</button><button class="kc-btn small" data-a="me">Ma position</button><button class="kc-btn small pink" data-a="clear">Effacer le GPS</button><button class="kc-btn small" data-a="close">Fermer</button></div>
    <div class="info"></div>`;
  ui.root.appendChild(el);
  const cv = el.querySelector('canvas'), info = el.querySelector('.info'), ctx = cv.getContext('2d');
  const roads = createRoadCache(game);
  const v = { cx: 0, cz: 0, scale: 0.6, open: false };
  let raf = 0, drag = null;

  function resize() { const d = Math.min(2, devicePixelRatio || 1); cv.width = cv.clientWidth * d; cv.height = cv.clientHeight * d; ctx.setTransform(d, 0, 0, d, 0, 0); }
  const T = () => ({ cx: v.cx, cz: v.cz, fx: 0, fz: -1, scale: v.scale, ox: cv.clientWidth / 2, oy: cv.clientHeight / 2 });
  const toWorld = (px, py) => ({ x: v.cx + (px - cv.clientWidth / 2) / v.scale, z: v.cz + (py - cv.clientHeight / 2) / v.scale });
  function fit() {
    const s = game.world?.size || 1200;
    v.scale = Math.min(cv.clientWidth, cv.clientHeight) / (s * 1.05);
  }
  function center() { const p = game.player?.position; v.cx = p?.x ?? 0; v.cz = p?.z ?? 0; }

  function draw() {
    raf = requestAnimationFrame(draw);
    const W = cv.clientWidth, H = cv.clientHeight, t = T();
    ctx.fillStyle = '#080d22'; ctx.fillRect(0, 0, W, H);
    // mer / limites de la ville
    const size = game.world?.size || 1200, a = project(t, -size / 2, -size / 2), b = project(t, size / 2, size / 2);
    ctx.fillStyle = '#0f1a3d'; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.strokeStyle = 'rgba(130,160,255,.35)'; ctx.lineWidth = 2; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    const range = Math.max(W, H) / v.scale;
    const segs = roads.get(0.016);
    drawRoads(ctx, segs, t, range, '#2a3768', Math.max(5, 9 * v.scale * 1.4));
    drawRoads(ctx, segs, t, range, '#7f8fc2', Math.max(2.5, 6 * v.scale * 1.4));
    drawSearch(ctx, game.police?.searchZone, t, game.time.elapsed);
    drawRoute(ctx, ui.state.route, t, 5);
    ctx.font = '13px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const bl of collectBlips(game)) {
      const q = project(t, bl.x, bl.z);
      if (q.x < -20 || q.x > W + 20 || q.y < -20 || q.y > H + 20) continue;
      drawBlip(ctx, q.x, q.y, bl, 6);
      if (bl.label) { ctx.fillStyle = '#000'; ctx.fillText(bl.label, q.x + 11, q.y + 1); ctx.fillStyle = '#eaf0ff'; ctx.fillText(bl.label, q.x + 10, q.y); }
    }
    for (const u of game.police?.units || []) { const p = unitPos(u); if (!p) continue; const q = project(t, p.x, p.z); ctx.fillStyle = Math.floor(game.time.elapsed * 4) % 2 ? '#ff3c50' : '#3c6eff'; ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, 7); ctx.fill(); }
    if (ui.state.waypoint) { const q = project(t, ui.state.waypoint.x, ui.state.waypoint.z); drawBlip(ctx, q.x, q.y, { color: '#38e8ff', shape: 'dia' }, 9); }
    const p = game.player?.position;
    if (p) { const q = project(t, p.x, p.z); drawArrow(ctx, q.x, q.y, 11, 0, '#fff'); }
    const wp = ui.state.waypoint;
    info.textContent = wp && p ? `Point GPS à ${formatDistance(Math.hypot(wp.x - p.x, wp.z - p.z))}${ui.state.route ? ` · trajet ${formatDistance(routeLength(ui.state.route))}` : ''}` : 'Cliquez sur la carte pour poser un point GPS';
  }

  cv.addEventListener('wheel', (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.offsetX, e.offsetY); }, { passive: false });
  function zoom(k, px = cv.clientWidth / 2, py = cv.clientHeight / 2) {
    const before = toWorld(px, py);
    v.scale = Math.max(0.12, Math.min(4, v.scale * k));
    const after = toWorld(px, py);
    v.cx += before.x - after.x; v.cz += before.z - after.z;
  }
  cv.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: false }; });
  globalThis.addEventListener('mousemove', (e) => {
    if (!drag || !v.open) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    v.cx -= dx / v.scale; v.cz -= dy / v.scale; drag.x = e.clientX; drag.y = e.clientY;
  });
  globalThis.addEventListener('mouseup', (e) => {
    if (!drag || !v.open) { drag = null; return; }
    const moved = drag.moved; drag = null;
    if (moved || e.target !== cv) return;
    if (e.button === 0) { const w = toWorld(e.offsetX, e.offsetY); ui.setWaypoint({ x: w.x, y: 0, z: w.z }, { manual: true }); game.bus.emit('ui:sound', { name: 'ui_ok', volume: 0.5 }); }
  });
  cv.addEventListener('contextmenu', (e) => { e.preventDefault(); ui.setWaypoint(null, { manual: true }); });
  el.querySelector('.tools').addEventListener('click', (e) => {
    const a = e.target.dataset?.a;
    if (a === 'in') zoom(1.3); else if (a === 'out') zoom(1 / 1.3); else if (a === 'me') center();
    else if (a === 'clear') ui.setWaypoint(null, { manual: true }); else if (a === 'close') ui.closeMap();
  });
  globalThis.addEventListener('resize', () => { if (v.open) resize(); });

  return {
    el,
    get open() { return v.open; },
    show() {
      if (v.open) return;
      v.open = true; el.style.display = 'flex';
      resize(); fit(); center(); zoom(1.3);
      cancelAnimationFrame(raf); draw();
    },
    hide() { v.open = false; el.style.display = 'none'; cancelAnimationFrame(raf); },
  };
}
