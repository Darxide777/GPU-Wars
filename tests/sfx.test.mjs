// The sound effects: the engine crossfade, the tree's beeps, the files, and the options row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { SFX_FILES, engineMix, treeFileFor } from '../src/sfx.ts';
import { sanitizeOptions } from '../src/options/model.ts';

test('idle plays off the gas and throttle on it, crossfading with equal power', () => {
  assert.deepEqual(engineMix(0, true), { idle: 1, throttle: 0 });
  const full = engineMix(1, true); assert.ok(full.idle < 1e-9 && Math.abs(full.throttle - 1) < 1e-9);
  for (const p of [0.1, 0.5, 0.9]) { const m = engineMix(p, true); assert.ok(Math.abs(m.idle ** 2 + m.throttle ** 2 - 1) < 1e-9, 'no dip or bump in loudness'); }
  assert.deepEqual(engineMix(1, false), { idle: 0, throttle: 0 }, 'silent off the race screen');
  assert.deepEqual(engineMix(NaN, true), { idle: 1, throttle: 0 }, 'a broken pedal reads as off the gas');
});

test('each tree light has its own beep file: ambers 1 to 3, then the green', () => {
  assert.deepEqual([1, 2, 3].map(n => treeFileFor('amber', n)), [0, 1, 2]); assert.equal(treeFileFor('green'), 3); assert.equal(treeFileFor('amber', 99), 2);
  assert.equal(SFX_FILES.tree.length, 4);
});

test('every sound file is in assets/sfx and small', () => {
  for (const f of [SFX_FILES.idle, SFX_FILES.throttle, ...SFX_FILES.tree]) { const url = new URL('../' + f, import.meta.url); assert.ok(existsSync(url), f); assert.ok(statSync(url).size > 1000 && statSync(url).size < 300 * 1024, `${f} is a sensible size`); }
});

test('the sound effects volume is an option (0 mutes), kept in range, and the page plays the tree and engine', () => {
  assert.equal(sanitizeOptions({}).sfx, 0.7); assert.equal(sanitizeOptions({ sfx: 0 }).sfx, 0); assert.equal(sanitizeOptions({ sfx: 5 }).sfx, 1); assert.equal(sanitizeOptions({ sfx: 'loud' }).sfx, 0.7);
  const page = readFileSync(new URL('../src/drag/page.ts', import.meta.url), 'utf8');
  assert.match(page, /sfx\.unlock\(\)/); assert.match(page, /sfx\.treeLight\('amber'/); assert.match(page, /sfx\.engine\(/);
});
