// Textures procédurales (canvas) : bruit d'asphalte/terrain, atlas de façades (diffus + émissif nocturne), halo lumineux.
import * as THREE from 'three';
import { mulberry32 } from './citygen.js';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, { repeat = true, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

/** Bruit gris clair (multiplié par les couleurs de sommet). */
export function noiseTexture(size = 128, base = 205, amp = 34, seed = 5) {
  const c = canvas(size, size), g = c.getContext('2d'), r = mulberry32(seed);
  g.fillStyle = `rgb(${base},${base},${base})`; g.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * 0.55; i++) {
    const v = base + (r() - 0.5) * amp * 2;
    g.fillStyle = `rgba(${v},${v},${v},0.55)`; g.fillRect(Math.floor(r() * size), Math.floor(r() * size), 1 + (r() < 0.2 ? 1 : 0), 1);
  }
  return tex(c);
}

/** Atlas 8x8 de façades : { map, emissiveMap }. La case (0,0) en bas à gauche est un mur plein ; la rangée du bas = vitrines. */
export function windowAtlas() {
  const S = 512, cell = 64, d = canvas(S, S), e = canvas(S, S), gd = d.getContext('2d'), ge = e.getContext('2d'), r = mulberry32(99);
  gd.fillStyle = '#f4f4f2'; gd.fillRect(0, 0, S, S);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
  const warm = ['#ffd27a', '#ffe9b0', '#ffc46b', '#ffd27a', '#bfe9ff', '#ffb3d9'];
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const x = col * cell, y = row * cell, shop = row === 7;
    if (shop && col === 0) continue;
    const ix = shop ? 6 : 15, iy = shop ? 14 : 13, iw = cell - ix * 2, ih = shop ? 44 : 36;
    gd.fillStyle = '#d9d9d4'; gd.fillRect(x + ix - 3, y + iy - 3, iw + 6, ih + 6);
    gd.fillStyle = shop ? '#2c415c' : '#3a4a66'; gd.fillRect(x + ix, y + iy, iw, ih);
    gd.fillStyle = 'rgba(255,255,255,0.18)'; gd.fillRect(x + ix, y + iy, iw, 4);
    if (r() < (shop ? 0.65 : 0.4)) {
      ge.fillStyle = warm[Math.floor(r() * (r() < 0.9 ? 4 : 6))]; ge.fillRect(x + ix, y + iy, iw, ih);
      gd.fillStyle = 'rgba(255,230,160,0.35)'; gd.fillRect(x + ix, y + iy, iw, ih);
    }
  }
  return { map: tex(d), emissiveMap: tex(e) };
}

/** Halo radial blanc (sprites additifs des lampadaires, néons, feux). */
export function glowTexture() {
  const c = canvas(64, 64), g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return tex(c, { repeat: false });
}
