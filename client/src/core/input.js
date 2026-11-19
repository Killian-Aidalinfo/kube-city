// Entrées (spec 3.3) : clavier (ZQSD/WASD/flèches), souris (pointer lock), manette standard.
// API : isDown(action), pressed(action) (vrai une seule image), axis('moveX'|'moveY'|'lookX'|'lookY'), pointerLocked.
// Les touches sont lues par `code` (position physique : WASD = ZQSD sur AZERTY) et par `key` pour z/q.

/** Liste des actions logiques. */
export const ACTIONS = [
  'forward', 'back', 'left', 'right', 'sprint', 'jump', 'interact', 'handbrake', 'flip', 'attack', 'aim',
  'weaponWheel', 'horn', 'radioNext', 'radioPrev', 'lights', 'camera', 'phone', 'map', 'switchChar', 'chat', 'pause', 'cluster', 'board',
];

// Clavier : code → actions
const KEY_CODES = {
  KeyW: ['forward'], ArrowUp: ['forward'], KeyS: ['back'], ArrowDown: ['back'],
  KeyA: ['left'], ArrowLeft: ['left'], KeyD: ['right'], ArrowRight: ['right'],
  ShiftLeft: ['sprint'], ShiftRight: ['sprint'],
  Space: ['jump', 'handbrake'],
  KeyF: ['interact'], Tab: ['weaponWheel'], KeyH: ['horn'], KeyG: ['flip'], KeyR: ['radioNext'],
  KeyN: ['lights'], KeyL: ['board'], KeyV: ['camera'], KeyP: ['phone'], KeyM: ['map'], KeyK: ['cluster'],
  AltLeft: ['switchChar'], AltRight: ['switchChar'], KeyT: ['chat'], Escape: ['pause'],
};
// Clavier : touche tapée (lettres ZQSD pour les claviers QWERTY)
const KEY_CHARS = { z: ['forward'], q: ['left'] };
const MOUSE_BUTTONS = { 0: ['attack'], 2: ['aim'] };
// Manette standard : indice de bouton → actions
const PAD_BUTTONS = {
  0: ['jump', 'sprint'], 1: ['flip'], 2: ['jump'], 3: ['interact'], 4: ['weaponWheel'], 5: ['handbrake'], 6: ['aim'], 7: ['attack'],
  8: ['camera'], 9: ['pause'], 10: ['horn', 'sprint'], 11: ['map'],
  12: ['phone'], 13: ['lights'], 14: ['radioPrev'], 15: ['radioNext'],
};
const DEADZONE = 0.15;
const MOUSE_RAD_PER_PX = 0.0022;
const PAD_LOOK_RAD_PER_S = 2.8;

/**
 * @param {{ target?: EventTarget, doc?: any, nav?: any, settings?: any, canvas?: any }} [env]
 */
export function createInput(env = {}) {
  const target = env.target ?? globalThis.window;
  const doc = env.doc ?? globalThis.document;
  const nav = env.nav ?? globalThis.navigator;
  const settings = env.settings;

  const down = new Map();       // action → nb de sources enfoncées
  const srcDown = new Set();    // 'k:KeyW', 'm:0', 'g:7'
  const pressedNow = new Set();
  let mouseDX = 0, mouseDY = 0, padMove = [0, 0], padLook = [0, 0], padTrig = 0, dt = 1 / 60;
  const padHeld = new Set();

  const input = {
    pointerLocked: false,
    /** Vrai en véhicule : les gâchettes de la manette (RT/LT) accélèrent et freinent. */
    triggersDrive: false,
    /** Vrai tant que l'action est maintenue. */
    isDown: (a) => (down.get(a) || 0) > 0,
    /** Vrai une seule image après l'appui. */
    pressed: (a) => pressedNow.has(a),
    axis(name) {
      const kb = (neg, pos) => (input.isDown(pos) ? 1 : 0) - (input.isDown(neg) ? 1 : 0);
      const clamp = (v) => Math.max(-1, Math.min(1, v));
      const sens = settings?.get('sensitivity') ?? 1;
      const invY = settings?.get('invertY') ? -1 : 1;
      switch (name) {
        case 'moveX': return clamp(kb('left', 'right') + padMove[0]);
        // avancer = +1 (écran vers le haut)
        case 'moveY': return clamp(kb('back', 'forward') - padMove[1] + (input.triggersDrive ? padTrig : 0));
        case 'lookX': return (mouseDX * MOUSE_RAD_PER_PX + padLook[0] * PAD_LOOK_RAD_PER_S * dt) * sens;
        case 'lookY': return (mouseDY * MOUSE_RAD_PER_PX + padLook[1] * PAD_LOOK_RAD_PER_S * dt) * sens * invY;
        default: return 0;
      }
    },
    /** Demande le verrouillage du pointeur sur l'élément (à appeler depuis un clic). */
    requestPointerLock(el) { try { el?.requestPointerLock?.(); } catch { /* refusé */ } },
    exitPointerLock() { try { doc?.exitPointerLock?.(); } catch { /* rien */ } },
    /** Appelé chaque image avant les modules : lit la manette. */
    poll(frameDt) { dt = frameDt; pollGamepad(); },
    /** Appelé en fin d'image : efface les appuis et les deltas souris. */
    endFrame() { pressedNow.clear(); mouseDX = 0; mouseDY = 0; },
    /** Relâche tout (perte de focus). */
    releaseAll() { for (const s of [...srcDown]) release(s, KEY_ACTIONS(s)); },
    dispose() { for (const [t, fn] of listeners) (t === 'doc' ? doc : target)?.removeEventListener(fn[0], fn[1]); },
  };

  // Les sources 'g:' et 'm:' / 'k:' retrouvent leurs actions via ces tables.
  function KEY_ACTIONS(s) {
    const [k, id] = [s[0], s.slice(2)];
    if (k === 'k') return KEY_CODES[id] || KEY_CHARS[id.replace('char:', '')] || [];
    if (k === 'm') return MOUSE_BUTTONS[id] || [];
    if (k === 'g') return PAD_BUTTONS[id] || [];
    return [];
  }
  function press(src, actions) {
    if (srcDown.has(src)) return;
    srcDown.add(src);
    for (const a of actions) { down.set(a, (down.get(a) || 0) + 1); pressedNow.add(a); }
  }
  function release(src, actions) {
    if (!srcDown.delete(src)) return;
    for (const a of actions) down.set(a, Math.max(0, (down.get(a) || 0) - 1));
  }

  const listeners = [];
  const listen = (where, ev, fn) => {
    const t = where === 'doc' ? doc : target;
    t?.addEventListener?.(ev, fn);
    listeners.push([where, [ev, fn]]);
  };

  const isTyping = () => { const t = doc?.activeElement?.tagName; return t === 'INPUT' || t === 'TEXTAREA'; };
  const keySrcs = (e) => {
    const out = [];
    if (KEY_CODES[e.code]) out.push(['k:' + e.code, KEY_CODES[e.code]]);
    const ch = typeof e.key === 'string' ? e.key.toLowerCase() : '';
    if (KEY_CHARS[ch]) out.push(['k:char:' + ch, KEY_CHARS[ch]]);
    return out;
  };

  listen('win', 'keydown', (e) => {
    if (isTyping() && e.code !== 'Escape') return;
    const srcs = keySrcs(e);
    if (srcs.length && ['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'AltLeft'].includes(e.code)) e.preventDefault?.();
    for (const [s, a] of srcs) press(s, a);
  });
  listen('win', 'keyup', (e) => { for (const [s, a] of keySrcs(e)) release(s, a); });
  listen('win', 'blur', () => input.releaseAll());
  listen('win', 'mousedown', (e) => { const a = MOUSE_BUTTONS[e.button]; if (a) press('m:' + e.button, a); });
  listen('win', 'mouseup', (e) => { const a = MOUSE_BUTTONS[e.button]; if (a) release('m:' + e.button, a); });
  listen('win', 'contextmenu', (e) => e.preventDefault?.());
  listen('win', 'mousemove', (e) => {
    if (!input.pointerLocked) return;
    mouseDX += e.movementX || 0; mouseDY += e.movementY || 0;
  });
  listen('doc', 'pointerlockchange', () => { input.pointerLocked = !!doc.pointerLockElement; });

  function pollGamepad() {
    const pads = nav?.getGamepads?.() || [];
    const pad = [...pads].find((p) => p && p.connected);
    if (!pad) { padMove = [0, 0]; padLook = [0, 0]; padTrig = 0; for (const i of [...padHeld]) { padHeld.delete(i); release('g:' + i, PAD_BUTTONS[i]); } return; }
    const dz = (v) => (Math.abs(v) < DEADZONE ? 0 : v);
    padMove = [dz(pad.axes[0] || 0), dz(pad.axes[1] || 0)];
    padLook = [dz(pad.axes[2] || 0), dz(pad.axes[3] || 0)];
    padTrig = (pad.buttons[7]?.value || 0) - (pad.buttons[6]?.value || 0);
    for (const i of Object.keys(PAD_BUTTONS)) {
      const b = pad.buttons[i];
      const on = !!b && (b.pressed || b.value > 0.5);
      if (on && !padHeld.has(i)) { padHeld.add(i); press('g:' + i, PAD_BUTTONS[i]); }
      else if (!on && padHeld.has(i)) { padHeld.delete(i); release('g:' + i, PAD_BUTTONS[i]); }
    }
  }

  return input;
}
