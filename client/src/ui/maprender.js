// Dessin des cartes (minimap ronde et carte plein écran) sur canvas 2D.
import { worldToMap, extractSegments, clampToCircle, frac } from './mapmath.js';

/** Cache des segments de route (le graphe est extrait une fois, puis ré-essayé si vide). */
export function createRoadCache(game) {
  let segs = [], ref = null, retry = 0;
  return {
    get(dt = 0) {
      const roads = game.world?.roads;
      retry -= dt;
      if (roads !== ref || (!segs.length && retry <= 0)) { ref = roads; segs = extractSegments(roads); retry = 2; }
      return segs;
    },
  };
}

export const project = (T, x, z) => { const p = worldToMap(x, z, T.cx, T.cz, T.fx, T.fz, T.scale); return { x: T.ox + p.x, y: T.oy + p.y }; };

/** Trace les routes visibles. rangeM : rayon de culling en mètres autour du centre. */
export function drawRoads(ctx, segs, T, rangeM, color = '#6f7fb0', width = 3) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
  ctx.beginPath();
  for (const s of segs) {
    if (Math.abs(s[0] - T.cx) > rangeM && Math.abs(s[2] - T.cx) > rangeM) continue;
    if (Math.abs(s[1] - T.cz) > rangeM && Math.abs(s[3] - T.cz) > rangeM) continue;
    const a = project(T, s[0], s[1]), b = project(T, s[2], s[3]);
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
}

/** Itinéraire GPS. */
export function drawRoute(ctx, pts, T, width = 4) {
  if (!pts || pts.length < 2) return;
  ctx.strokeStyle = '#38e8ff'; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.shadowColor = '#38e8ff'; ctx.shadowBlur = 8;
  ctx.beginPath();
  pts.forEach((p, i) => { const q = project(T, p.x, p.z); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
  ctx.stroke(); ctx.shadowBlur = 0;
}

/** Position d'une unité de police (tolérant sur la forme). */
export const unitPos = (u) => u?.position ?? u?.object3d?.position ?? u?.vehicle?.object3d?.position ?? u?.chassis?.translation?.() ?? null;

/** Cercle de zone de recherche (spec 9). */
export function drawSearch(ctx, zone, T, t) {
  const c = zone?.center ?? zone?.position, r = zone?.radius;
  if (!c || !r) return;
  const p = project(T, c.x, c.z);
  const flash = Math.floor(t * 3) % 2 === 0;
  ctx.fillStyle = flash ? 'rgba(255,60,80,.16)' : 'rgba(60,110,255,.16)';
  ctx.strokeStyle = flash ? '#ff3c50' : '#3c6eff'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
  ctx.beginPath(); ctx.arc(p.x, p.y, r * T.scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
}

/** Flèche du joueur. */
export function drawArrow(ctx, x, y, size, rot = 0, color = '#fff') {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = color; ctx.strokeStyle = '#06101e'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(size * 0.7, size * 0.8); ctx.lineTo(0, size * 0.4); ctx.lineTo(-size * 0.7, size * 0.8); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

/** Récupère l'ensemble des blips à afficher : lieux, marqueurs de mission, kubes proches, joueurs distants. */
export function collectBlips(game) {
  const out = [];
  for (const [key, p] of Object.entries(game.world?.places || {})) {
    if (p?.position) out.push({ x: p.position.x, z: p.position.z, label: p.label || key, color: placeColor(key + (p.label || '')), shape: 'sq' });
  }
  for (const m of game.gameplay?.markers || []) if (m.kind !== 'shop') out.push({ x: m.x, z: m.z, label: m.label, color: m.color, shape: 'dia' });
  // kubes à collectionner : seuls ceux à moins de 140 m apparaissent (radar, sans révéler toute la carte)
  const gp = game.gameplay, me = game.player?.position;
  if (me && gp?.kubePositions && gp.profile?.kubes) {
    const got = new Set(gp.profile.kubes);
    gp.kubePositions.forEach((k, i) => { if (!got.has(i) && Math.hypot(k.x - me.x, k.z - me.z) < 140) out.push({ x: k.x, z: k.z, color: '#7ff0ff', shape: 'dot' }); });
  }
  const pls = game.net?.players;
  const arr = pls instanceof Map ? [...pls.values()] : Array.isArray(pls) ? pls : [];
  for (const o of arr) { const p = o?.position ?? o?.pos; if (p) out.push({ x: p.x, z: p.z, label: o.name || 'Joueur', color: '#7bf59a', shape: 'dot' }); }
  return out;
}
function placeColor(s) {
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/hopital|hospital/.test(s)) return '#ff6a7a';
  if (/commis|police/.test(s)) return '#6a8cff';
  if (/garage|lou/.test(s)) return '#ff4fa3';
  if (/boutique|vetement/.test(s)) return '#9ae66e';
  return '#c8d3f5';
}

export function drawBlip(ctx, x, y, b, r = 5) {
  ctx.fillStyle = b.color; ctx.strokeStyle = '#06101e'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (b.shape === 'dia') { ctx.moveTo(x, y - r - 1); ctx.lineTo(x + r + 1, y); ctx.lineTo(x, y + r + 1); ctx.lineTo(x - r - 1, y); ctx.closePath(); }
  else if (b.shape === 'sq') ctx.rect(x - r + 1, y - r + 1, (r - 1) * 2, (r - 1) * 2);
  else ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
}

/**
 * Dessine la minimap complète (fond, routes, zone de recherche, itinéraire, blips, police, arcs santé/armure).
 * S = taille du canvas en px CSS ; l'origine est déjà mise à l'échelle du DPR.
 */
export function drawMinimap(ctx, game, st, S) {
  const R = 86, c = S / 2;
  ctx.clearRect(0, 0, S, S);
  const p = game.player?.position ?? { x: 0, z: 0 };
  const cam = game.three.camera;
  let dx = 0, dz = -1;
  if (cam) { const e = cam.matrixWorld.elements; dx = -e[8]; dz = -e[10]; }
  const { fx, fz } = (() => { const l = Math.hypot(dx, dz); return l < 1e-4 ? { fx: 0, fz: -1 } : { fx: dx / l, fz: dz / l }; })();
  const T = { cx: p.x, cz: p.z, fx, fz, scale: st.scale, ox: c, oy: c };
  const t = game.time.elapsed;

  // fond et contenu clippés dans le disque
  ctx.save();
  ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.clip();
  const d = game.world?.district?.(p.x, p.z);
  ctx.fillStyle = '#0c1330'; ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = (d?.color || '#38e8ff') + '22'; ctx.fillRect(0, 0, S, S);
  const range = R / st.scale * 1.5;
  drawRoads(ctx, st.roads, T, range, '#2a3768', 6);
  drawRoads(ctx, st.roads, T, range, '#8393c4', 3);
  drawSearch(ctx, game.police?.searchZone, T, t);
  drawRoute(ctx, st.route, T, 4);
  for (const b of st.blips) {
    const q = worldToMap(b.x, b.z, T.cx, T.cz, fx, fz, st.scale);
    const k = clampToCircle(q.x, q.y, R - 7);
    drawBlip(ctx, c + k.x, c + k.y, b, k.clamped ? 4 : 5);
  }
  if (st.waypoint) {
    const q = worldToMap(st.waypoint.x, st.waypoint.z, T.cx, T.cz, fx, fz, st.scale);
    const k = clampToCircle(q.x, q.y, R - 8);
    drawBlip(ctx, c + k.x, c + k.y, { color: '#38e8ff', shape: 'dia' }, 7);
  }
  // police : points rouges et bleus clignotants
  for (const u of game.police?.units || []) {
    const up = unitPos(u); if (!up) continue;
    const q = worldToMap(up.x, up.z, T.cx, T.cz, fx, fz, st.scale);
    const k = clampToCircle(q.x, q.y, R - 5);
    ctx.fillStyle = Math.floor(t * 4) % 2 ? '#ff3c50' : '#3c6eff';
    ctx.beginPath(); ctx.arc(c + k.x, c + k.y, 4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // anneau, nord, joueur
  ctx.strokeStyle = 'rgba(130,160,255,.6)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.stroke();
  const n = worldToMap(p.x, p.z - 100, p.x, p.z, fx, fz, 1);
  const nl = Math.hypot(n.x, n.y) || 1;
  ctx.fillStyle = '#ff4fa3'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('N', c + (n.x / nl) * (R - 11), c + (n.y / nl) * (R - 11));
  drawArrow(ctx, c, c, 9, 0, '#ffffff');

  // arcs santé (gauche) et armure (droite)
  const hp = frac(game.player?.health ?? 100, 100), ar = frac(game.player?.armor ?? 0, 100);
  const A = R + 9, a0 = Math.PI * 0.55, a1 = Math.PI * 1.45;
  ctx.lineWidth = 8; ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.beginPath(); ctx.arc(c, c, A, a0, a1); ctx.stroke();
  ctx.beginPath(); ctx.arc(c, c, A, Math.PI - a1, Math.PI - a0); ctx.stroke();
  const hpCol = hp < 0.3 ? '#ff5a6a' : '#7bf59a';
  ctx.strokeStyle = hpCol; ctx.shadowColor = hpCol; ctx.shadowBlur = 10;
  if (hp > 0.01) { ctx.beginPath(); ctx.arc(c, c, A, a0, a0 + (a1 - a0) * hp); ctx.stroke(); }
  ctx.strokeStyle = '#38e8ff'; ctx.shadowColor = '#38e8ff';
  if (ar > 0.01) { ctx.beginPath(); ctx.arc(c, c, A, Math.PI - a0, Math.PI - a0 - (a1 - a0) * ar, true); ctx.stroke(); }
  ctx.shadowBlur = 0;
}
