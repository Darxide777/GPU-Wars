// The sound effects: the engine crossfade, the tree's beeps, the files, and the options row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { SFX_FILES, engineMix, treeFileFor } from '../src/sfx.ts';
import { sanitizeOptions } from '../src/options/model.ts';

test('idle off the gas, throttle at half gas, full-throttle at full gas, crossfading with equal power', () => {
  assert.deepEqual(engineMix(0, true), { idle: 1, throttle: 0, full: 0 });
  const half = engineMix(0.5, true); assert.ok(half.idle < 1e-9 && Math.abs(half.throttle - 1) < 1e-9 && half.full < 1e-9);
  const top = engineMix(1, true); assert.ok(top.idle < 1e-9 && top.throttle < 1e-9 && Math.abs(top.full - 1) < 1e-9);
  for (const p of [0.1, 0.4, 0.6, 0.9]) { const m = engineMix(p, true); assert.ok(Math.abs(m.idle ** 2 + m.throttle ** 2 + m.full ** 2 - 1) < 1e-9, 'no dip or bump in loudness'); }
  assert.deepEqual(engineMix(1, false), { idle: 0, throttle: 0, full: 0 }, 'silent off the race screen');
  assert.deepEqual(engineMix(NaN, true), { idle: 1, throttle: 0, full: 0 }, 'a broken pedal reads as off the gas');
});

test('each tree light has its own beep file: ambers 1 to 3, then the green', () => {
  assert.deepEqual([1, 2, 3].map(n => treeFileFor('amber', n)), [0, 1, 2]); assert.equal(treeFileFor('green'), 3); assert.equal(treeFileFor('amber', 99), 2);
  assert.equal(SFX_FILES.tree.length, 4);
});

test('every sound file is in assets/sfx and small', () => {
  for (const f of [SFX_FILES.idle, SFX_FILES.throttle, SFX_FILES.full, SFX_FILES.lift, ...SFX_FILES.tree]) { const url = new URL('../' + f, import.meta.url); assert.ok(existsSync(url), f); assert.ok(statSync(url).size > 1000 && statSync(url).size < 300 * 1024, `${f} is a sensible size`); }
});

test('the sound effects volume is an option (0 mutes), kept in range, and the page plays the tree and engine', () => {
  assert.equal(sanitizeOptions({}).sfx, 0.7); assert.equal(sanitizeOptions({ sfx: 0 }).sfx, 0); assert.equal(sanitizeOptions({ sfx: 5 }).sfx, 1); assert.equal(sanitizeOptions({ sfx: 'loud' }).sfx, 0.7);
  const page = readFileSync(new URL('../src/drag/page.ts', import.meta.url), 'utf8');
  assert.match(page, /sfx\.unlock\(\)/); assert.match(page, /sfx\.treeLight\('amber'/); assert.match(page, /sfx\.engine\(/);
});

test('only the idle sound plays in staging; the throttle sounds are allowed in the burnout and after the green', () => {
  assert.deepEqual(engineMix(1, true, false), { idle: 1, throttle: 0, full: 0 }, 'full gas in the run-out, back up and stage is still the idle sound');
  const after = engineMix(1, true, true); assert.ok(after.idle < 1e-9 && Math.abs(after.full - 1) < 1e-9);
});

test('the lift-off sound plays every time the gas comes off after the green', () => {
  const page = readFileSync(new URL('../src/drag/page.ts', import.meta.url), 'utf8');
  assert.match(page, /screen === 'race' && s\.green/); assert.match(page, /gasWasOn/); assert.match(page, /sfx\.liftOff\(\)/); assert.match(page, /gasWasOn = false; race = createDrag/);
});
