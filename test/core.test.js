// Tests du socle : bus d'événements, entrées, réglages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bus } from '../client/src/core/bus.js';
import { EVENTS } from '../client/src/core/events.js';
import { createInput } from '../client/src/core/input.js';
import { createSettings, DEFAULTS } from '../client/src/core/settings.js';

function fakeEnv(pads = []) {
  const target = new EventTarget();
  const doc = Object.assign(new EventTarget(), { activeElement: null, pointerLockElement: null });
  const input = createInput({ target, doc, nav: { getGamepads: () => pads } });
  const key = (type, code, key = '') => { const e = new Event(type); e.code = code; e.key = key; target.dispatchEvent(e); };
  return { input, target, doc, key };
}

test('bus : on/emit/off/once', () => {
  const bus = new Bus();
  const got = [];
  const f = (p) => got.push(p);
  bus.on('a', f);
  bus.emit('a', 1);
  bus.off('a', f);
  bus.emit('a', 2);
  bus.once('b', f);
  bus.emit('b', 3); bus.emit('b', 4);
  assert.deepEqual(got, [1, 3]);
});

test('bus : une erreur dans un écouteur ne bloque pas les autres', () => {
  const bus = new Bus();
  const orig = console.error; console.error = () => {};
  let ok = false;
  bus.on('x', () => { throw new Error('boum'); });
  bus.on('x', () => { ok = true; });
  bus.emit('x');
  console.error = orig;
  assert.equal(ok, true);
});

test('events : tous les événements de la spec sont déclarés', () => {
  const attendus = ['player:spawned', 'player:enterVehicle', 'player:exitVehicle', 'player:damaged', 'player:ko', 'player:respawn',
    'vehicle:spawned', 'vehicle:destroyed', 'vehicle:collision', 'crime', 'wanted:changed', 'wanted:busted', 'money:changed',
    'mission:started', 'mission:objective', 'mission:passed', 'mission:failed', 'notify', 'subtitle', 'character:switch',
    'net:status', 'radio:station', 'ui:waypoint'];
  const dispo = new Set(Object.values(EVENTS));
  for (const e of attendus) assert.ok(dispo.has(e), e);
});

test('entrées : ZQSD, WASD et flèches donnent les mêmes axes', () => {
  for (const [code, ch] of [['KeyW', 'z'], ['KeyZ', 'z'], ['ArrowUp', '']]) {
    const { input, key } = fakeEnv();
    key('keydown', code, ch);
    assert.equal(input.axis('moveY'), 1, code);
    key('keyup', code, ch);
    assert.equal(input.axis('moveY'), 0);
  }
  const { input, key } = fakeEnv();
  key('keydown', 'KeyA', 'q'); key('keydown', 'KeyS', 's');
  assert.equal(input.axis('moveX'), -1);
  assert.equal(input.axis('moveY'), -1);
});

test('entrées : pressed() ne vaut vrai qu\'une image, isDown() reste', () => {
  const { input, key } = fakeEnv();
  key('keydown', 'Space', ' ');
  assert.ok(input.pressed('jump') && input.pressed('handbrake'));
  assert.ok(input.isDown('jump'));
  input.endFrame();
  assert.ok(!input.pressed('jump'));
  assert.ok(input.isDown('jump'));
  key('keyup', 'Space', ' ');
  assert.ok(!input.isDown('jump'));
});

test('entrées : la répétition clavier ne redéclenche pas pressed', () => {
  const { input, key } = fakeEnv();
  key('keydown', 'KeyF', 'f'); input.endFrame();
  key('keydown', 'KeyF', 'f');
  assert.ok(!input.pressed('interact'));
});

test('entrées : souris, pointer lock et delta de regard', () => {
  const { input, target, doc } = fakeEnv();
  const move = (dx, dy) => { const e = new Event('mousemove'); e.movementX = dx; e.movementY = dy; target.dispatchEvent(e); };
  move(100, 0);
  assert.equal(input.axis('lookX'), 0, 'ignoré sans pointer lock');
  doc.pointerLockElement = {}; doc.dispatchEvent(new Event('pointerlockchange'));
  assert.equal(input.pointerLocked, true);
  move(100, 50);
  assert.ok(input.axis('lookX') > 0 && input.axis('lookY') > 0);
  input.endFrame();
  assert.equal(input.axis('lookX'), 0);
  const e = new Event('mousedown'); e.button = 0; target.dispatchEvent(e);
  assert.ok(input.isDown('attack'));
});

test('entrées : manette (stick, zone morte, boutons)', () => {
  const pad = { connected: true, axes: [0.8, -1, 0.05, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  const { input } = fakeEnv([pad]);
  pad.buttons[7] = { pressed: true, value: 1 };
  input.poll(1 / 60);
  assert.equal(input.axis('moveX'), 0.8);
  assert.equal(input.axis('moveY'), 1, 'stick vers le haut = avancer');
  assert.ok(input.isDown('attack') && input.pressed('attack'));
  assert.equal(input.axis('lookX'), 0, 'zone morte');
  pad.buttons[7] = { pressed: false, value: 0 };
  input.poll(1 / 60);
  assert.ok(!input.isDown('attack'));
});

test('réglages : persistance et notification', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const s = createSettings(storage);
  assert.equal(s.get('quality'), DEFAULTS.quality);
  let seen;
  s.onChange((k, v) => { seen = [k, v]; });
  s.set('quality', 'high');
  assert.deepEqual(seen, ['quality', 'high']);
  assert.equal(createSettings(storage).get('quality'), 'high');
});
