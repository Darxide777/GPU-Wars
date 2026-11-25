// The input layer: the timestamped queue and its ordering, edge-triggered taps, key binds into a DriverInput, the touch layout and analog values, the pad reader, and rebinding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputQueue } from '../src/input/queue.ts';
import { createControlState, toDriverInput } from '../src/input/controls.ts';
import { pushKey, actionsForKey } from '../src/input/keyboard.ts';
import { createPadReader } from '../src/input/pad.ts';
import { touchLayout, hitTest, pedalValue, sliderValue } from '../src/input/touch.ts';
import { createHaptics, hapticPattern } from '../src/input/haptics.ts';
import { INPUT } from '../src/input/constants.ts';
import { DEFAULT_BINDS, DEFAULT_PAD_BINDS, assignKey, assignKeySlot, assignPadButton, clearSecondKey, resetControls, sanitizeOptions } from '../src/options/model.ts';
import { createRebinder, normalizeKey, optionsItems } from '../src/options/screen.ts';
import { createMenu } from '../src/arena/view/menu.ts';

const tick = (queue, state, ms, delay = 0) => { for (const e of queue.drain(ms, delay)) state.apply(e); const input = toDriverInput(state); state.endTick(); return input; };

test('events apply in the order they happened, at the tick that covers them, not before', () => {
  const q = createInputQueue(), s = createControlState();
  q.push({ t: 12, kind: 'down', control: 'nitro', source: 'k:shift', value: 1 });
  q.push({ t: 5, kind: 'down', control: 'gas', source: 'k:w', value: 1 });      // arrives later in the code, happened earlier
  assert.deepEqual([tick(q, s, 4).throttle, tick(q, s, 6).throttle], [0, 1], 'gas lands at the first tick after t=5');
  assert.equal(tick(q, s, 8).nitro, false, 'nitro at t=12 is not early');
  assert.equal(tick(q, s, 13).nitro, true);
  assert.equal(q.size, 0);
});
test('the queue is ordered by time then arrival, and capped', () => {
  const q = createInputQueue();
  for (const [t, c] of [[3, 'a'], [3, 'b'], [1, 'c']]) q.push({ t, kind: 'down', control: c, source: c, value: 1 });
  assert.deepEqual(q.drain(10).map(e => e.control), ['c', 'a', 'b']);
  for (let i = 0; i < INPUT.maxQueued + 50; i++) q.push({ t: i, kind: 'analog', control: 'steerPad', source: 'p', value: 0 });
  assert.equal(q.size, INPUT.maxQueued);
  q.push({ t: NaN, kind: 'down', control: 'x', source: 'x', value: 1 }); assert.equal(q.size, INPUT.maxQueued, 'a bad timestamp is dropped');
});
test('a tap shorter than one tick is still held for one tick, and the release comes after it', () => {
  const q = createInputQueue(), s = createControlState();
  q.push({ t: 2, kind: 'down', control: 'launch', source: 'k:u', value: 1 }); q.push({ t: 2.5, kind: 'up', control: 'launch', source: 'k:u', value: 1 });
  assert.equal(tick(q, s, 4).launch, true, 'pressed and released inside one tick: the car still sees the press');
  assert.equal(tick(q, s, 8).launch, false, 'then it is released');
});
test('a control stays held while any key or finger still holds it, and a press is an edge only the first time', () => {
  const q = createInputQueue(), s = createControlState();
  q.push({ t: 1, kind: 'down', control: 'gas', source: 'k:w', value: 1 }); q.push({ t: 2, kind: 'down', control: 'gas', source: 'k:arrowup', value: 1 });
  tick(q, s, 3); assert.equal(s.tapped('gas'), false, 'endTick cleared the tap');
  q.push({ t: 4, kind: 'up', control: 'gas', source: 'k:w', value: 1 }); assert.equal(tick(q, s, 5).throttle, 1, 'the other key still holds it');
  q.push({ t: 6, kind: 'up', control: 'gas', source: 'k:arrowup', value: 1 }); assert.equal(tick(q, s, 7).throttle, 0);
});
test('the input delay holds events back by that many milliseconds', () => {
  const q = createInputQueue(), s = createControlState();
  q.push({ t: 10, kind: 'down', control: 'chute', source: 'k:n', value: 1 });
  assert.equal(tick(q, s, 20, 15).chute, false); assert.equal(tick(q, s, 26, 15).chute, true);
});
test('keys go through the binds: rebound keys work, old ones do not, Enter launches, launch also shifts up, gas + brake is a burnout', () => {
  const q = createInputQueue(), s = createControlState(), binds = assignKey(DEFAULT_BINDS, 'chute', 'x').binds;
  pushKey(q, binds, 'X', true, 1); assert.equal(tick(q, s, 2).chute, true, 'the new key (any case) drops the chute');
  pushKey(q, binds, 'X', false, 3); tick(q, s, 4);
  pushKey(q, binds, 'n', true, 5); assert.equal(tick(q, s, 6).chute, false, 'the old key no longer does');
  pushKey(q, binds, 'Enter', true, 7); const go = tick(q, s, 8); assert.ok(go.launch && go.shiftUp);
  pushKey(q, binds, 'w', true, 9); pushKey(q, binds, 's', true, 9); assert.ok(tick(q, s, 10).burnout);
  pushKey(q, binds, 'r', true, 11); assert.equal(tick(q, s, 12).backUp, true, 'the back up key reaches the input');
  assert.deepEqual(actionsForKey(DEFAULT_BINDS, 'ArrowLeft'), ['steerLeft']);
});
test('analog gas and steering: the biggest of key and analog, steering sums and clamps', () => {
  const q = createInputQueue(), s = createControlState();
  q.push({ t: 1, kind: 'analog', control: 'gasTouch', source: 't:1', value: 0.4 }); q.push({ t: 1, kind: 'analog', control: 'steerTouch', source: 't:1', value: -0.5 });
  let i = tick(q, s, 2); assert.equal(i.throttle, 0.4); assert.equal(i.steer, -0.5);
  q.push({ t: 3, kind: 'analog', control: 'steerPad', source: 'p', value: -0.9 }); i = tick(q, s, 4); assert.equal(i.steer, -1);
  q.push({ t: 5, kind: 'analog', control: 'gasTouch', source: 't:1', value: NaN }); assert.equal(tick(q, s, 6).throttle, 0, 'NaN lets go of the analog value');
});
test('touch layout: every control present, on screen, none overlapping, in landscape and portrait and at every size', () => {
  const ids = ['steer', 'gas', 'brake', 'nitro', 'chute', 'launch', 'burnout', 'backUp', 'deepStage', 'shiftUp', 'shiftDown', 'menu'];
  for (const [w, h] of [[844, 390], [1280, 720], [390, 844], [360, 640]]) for (const size of [0.7, 1, 1.5]) {
    const L = touchLayout(w, h, size); assert.deepEqual(L.map(r => r.id).sort(), [...ids].sort());
    for (const r of L) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= w + 0.5 && r.y + r.h <= h + 0.5, `${r.id} on screen at ${w}x${h} x${size}`);
    for (const a of L) for (const b of L) if (a.id < b.id) assert.ok(a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5, `${a.id} overlaps ${b.id} at ${w}x${h} x${size}`);
  }
  const L = touchLayout(844, 390), gas = L.find(r => r.id === 'gas'); assert.equal(hitTest(L, gas.x + 5, gas.y + 5).id, 'gas'); assert.equal(hitTest(L, 1, 200), null);
});
test('touch analog: the gas follows the thumb along the pedal, pressure counts when real, the slider is centred with a dead zone', () => {
  const r = { id: 'gas', label: '', x: 0, y: 0, w: 100, h: 200, kind: 'pedal' };
  const low = pedalValue(r, 190, 0.5, true), mid = pedalValue(r, 100, 0.5, true), top = pedalValue(r, 0, 0.5, true);
  assert.ok(low >= INPUT.touchMinGas && low < mid && mid < top && top === 1);
  assert.equal(pedalValue(r, 0, 0.5, false), 1, 'analog off: full gas'); assert.ok(Math.abs(pedalValue(r, 190, 0.8, true) - Math.pow(0.8, INPUT.touchAnalogCurve)) < 1e-9, 'a real pressure wins over position');
  const s = { id: 'steer', label: '', x: 0, y: 0, w: 200, h: 50, kind: 'slider' };
  assert.equal(sliderValue(s, 100), 0); assert.equal(sliderValue(s, 104), 0, 'dead zone'); assert.equal(sliderValue(s, 200), 1); assert.equal(sliderValue(s, 0), -1); assert.ok(sliderValue(s, 150) > 0 && sliderValue(s, 150) < 0.5);
});
test('the pad: buttons are edges at the poll time, triggers are analog gas, the stick steers, and a held button is not repeated', () => {
  const q = createInputQueue(), s = createControlState(), reader = createPadReader(q);
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })), pad = { buttons, axes: [0, 0, 0, 0] };
  buttons[7] = { pressed: true, value: 0.6 }; buttons[0] = { pressed: true, value: 1 }; pad.axes[0] = 1;
  reader.poll(pad, DEFAULT_PAD_BINDS, 1); let i = tick(q, s, 2);
  assert.ok(Math.abs(i.throttle - 0.6) < 1e-9 && i.launch && i.steer === 1);
  reader.poll(pad, DEFAULT_PAD_BINDS, 3); q.push({ t: 3, kind: 'analog', control: 'x', source: 'x', value: 0 }); i = tick(q, s, 4); assert.equal(s.tapped('launch'), false, 'no new press while held');
  buttons[0] = { pressed: false, value: 0 }; reader.poll(pad, DEFAULT_PAD_BINDS, 5); assert.equal(tick(q, s, 6).launch, false);
  reader.poll(null, DEFAULT_PAD_BINDS, 7); i = tick(q, s, 8); assert.equal(i.throttle, 0); assert.equal(i.steer, 0, 'unplugging lets go');
});
test('haptics fire for the player car only and do nothing without vibration support', () => {
  const calls = []; let on = true, h = createHaptics(() => on, p => { calls.push(p); return true; });
  h.onEvents([{ t: 'launch', car: 0 }, { t: 'shift', car: 1, gear: 2 }, { t: 'crash', car: 0 }, { t: 'amber', n: 1 }]); assert.deepEqual(calls.map(c => c.length), [1, 3]);
  on = false; h.onEvents([{ t: 'launch', car: 0 }]); assert.equal(calls.length, 2, 'off switch');
  assert.doesNotThrow(() => createHaptics(() => true, null).onEvents([{ t: 'launch', car: 0 }])); assert.equal(hapticPattern({ t: 'over', winner: 0 }), null);
});

// ---- rebinding ----
test('rebinding: a key is taken from another action, but never leaves an action with no key; menu keys are refused; slots work', () => {
  let r = assignKey(DEFAULT_BINDS, 'burnout', 's'); assert.ok(r.ok); assert.deepEqual(r.tookFrom, ['brake']); assert.deepEqual(r.binds.brake, ['ArrowDown', ''], 'brake keeps its other key'); assert.deepEqual(r.binds.burnout, ['s', '']);
  r = assignKey(DEFAULT_BINDS, 'gas', 'n'); assert.equal(r.ok, false, 'N is the only key of the chute'); assert.match(r.why, /ONLY KEY/); assert.deepEqual(r.binds, DEFAULT_BINDS);
  for (const k of ['Escape', 'Enter', 'Tab', '']) assert.equal(assignKey(DEFAULT_BINDS, 'gas', k).ok, false);
  const second = assignKeySlot(DEFAULT_BINDS, 'chute', 'c', 1); assert.deepEqual(second.binds.chute, ['n', 'c']);
  assert.deepEqual(clearSecondKey(second.binds, 'chute').chute, ['n', '']);
  const same = assignKeySlot(second.binds, 'chute', 'c', 0); assert.deepEqual(same.binds.chute, ['c', ''], 'the same key in both slots collapses');
  assert.ok(Object.keys(DEFAULT_BINDS).includes('backUp'), 'backUp is a control'); assert.equal(normalizeKey('W'), 'w'); assert.equal(normalizeKey('ArrowUp'), 'ArrowUp');
  const reset = resetControls({ ...sanitizeOptions(null), binds: r.binds }); assert.deepEqual(reset.binds, DEFAULT_BINDS);
  const seen = new Set(); for (const keys of Object.values(DEFAULT_BINDS)) for (const k of keys.filter(Boolean)) { assert.ok(!seen.has(k.toLowerCase()), 'default key used twice: ' + k); seen.add(k.toLowerCase()); }
});
test('gamepad rebinding: conflicts move the button, START is refused, the options survive a damaged save', () => {
  assert.equal(assignPadButton(DEFAULT_PAD_BINDS, 'nitro', 0, 0).ok, false, 'A is the only button for launch');
  const two = assignPadButton(DEFAULT_PAD_BINDS, 'launch', 12, 1); assert.deepEqual(two.pad.launch, [0, 12]);
  const taken = assignPadButton(two.pad, 'nitro', 0, 0); assert.ok(taken.ok); assert.deepEqual(taken.tookFrom, ['launch']); assert.deepEqual(taken.pad.launch, [12, -1]); assert.deepEqual(taken.pad.nitro, [0, -1]);
  assert.equal(assignPadButton(DEFAULT_PAD_BINDS, 'nitro', 9, 0).ok, false, 'START is the menu button');
  assert.deepEqual(sanitizeOptions({ padBinds: { gas: [99, 'x'], nitro: [4, 4] }, touch: { size: 9, show: 'zzz' }, latencyOffsetMs: 5000, driver: 'bogus' }).padBinds.gas, [-1, -1]);
  const o = sanitizeOptions({ touch: { size: 9, show: 'zzz' }, latencyOffsetMs: 5000, driver: 'bogus' }); assert.deepEqual([o.touch.size, o.touch.show, o.latencyOffsetMs, o.driver], [1.5, 'auto', 100, 'manual']);
  assert.deepEqual(sanitizeOptions('junk').padBinds, DEFAULT_PAD_BINDS);
});
test('the rebinding flow: pick a row, press a key, conflicts are told, Escape cancels, a pad button works after the starting press is released', () => {
  const said = []; const options = sanitizeOptions(null); let saved = 0;
  const host = { options, save: () => { saved++; }, apply: () => {}, say: t => said.push(t), refresh: () => {}, fullscreen: () => {}, back: () => {} };
  const rb = createRebinder(host), dev = { v: 'keyboard', get() { return this.v; }, set(d) { this.v = d; } };
  const items = optionsItems(host, rb, dev), row = id => items.find(i => i.id === id), menu = createMenu(items);
  assert.ok(items.some(i => i.id === 'bind:backUp') && items.some(i => i.id === 'driver') && items.some(i => i.id === 'latency'));
  row('bind:burnout').enter(); assert.equal(row('bind:burnout').value(), 'PRESS...'); assert.equal(rb.key('S'), true);
  assert.deepEqual(options.binds.burnout, ['s', '']); assert.deepEqual(options.binds.brake, ['ArrowDown', '']); assert.match(said.at(-1), /TAKEN FROM BRAKE/); assert.equal(saved, 1); assert.equal(rb.pending, null);
  row('bind:chute').enter(); rb.key('Escape'); assert.equal(rb.pending, null); assert.equal(options.binds.chute[0], 'n');
  row('bind:chute').enter(); rb.key('Enter'); assert.match(said.at(-1), /MENUS/); assert.ok(rb.pending, 'still waiting after a refused key');
  rb.key('Escape'); row('bind:chute').right(); rb.key('c'); assert.deepEqual(options.binds.chute, ['n', 'c']); row('bind:chute').left(); assert.deepEqual(options.binds.chute, ['n', '']);
  dev.set('gamepad'); const pressed = i => ({ axes: [], buttons: Array.from({ length: 16 }, (_, n) => ({ pressed: n === i, value: n === i ? 1 : 0 })) });
  row('bind:nitro').right(); rb.pad(pressed(0)); assert.ok(rb.pending, 'the button that started it is still down: ignored'); rb.pad(pressed(-1)); rb.pad(pressed(12));
  assert.equal(rb.pending, null); assert.deepEqual(options.padBinds.nitro, [1, 12]);
  row('reset').enter(); assert.deepEqual(options.binds, DEFAULT_BINDS); assert.deepEqual(options.padBinds, DEFAULT_PAD_BINDS);
  row('latency').right(); row('latency').right(); assert.equal(options.latencyOffsetMs, 10); for (let i = 0; i < 40; i++) row('latency').right(); assert.equal(options.latencyOffsetMs, 100);
  row('driver').right(); assert.equal(options.driver, 'autopilot'); assert.ok(menu.items.length > 20);
});
