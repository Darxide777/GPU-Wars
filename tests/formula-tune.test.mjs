// The Formula tune and the benchmark: a tune can never leave its limits, whatever it holds; the six tune slots keep safe tunes; the benchmark score sets the engine inside the class window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanFormulaTune, cleanFormulaSlots, carStats, formulaSpecForBenchmark, predictFormula, STOCK_SPEC, DEFAULT_FORMULA_TUNE, FORMULA_TUNE_LIMITS, FORMULA_CLASS_WINDOWS, FORMULA_TUNE_HELP, NITRO } from '../src/formula/index.ts';
import { putSlot, emptySlots, SLOT_COUNT } from '../src/tune-slots.ts';
import { UNBENCHMARKED_ENGINE } from '../src/formula/car.ts';

const bench = (cls, score) => ({ score, class: cls, benchmarkVersion: 1, gpuId: 'x', date: 0 });

test('every tune row has help text, a default inside its limits and the neutral tune is the source game\'s', () => {
  assert.deepEqual(Object.keys(FORMULA_TUNE_HELP).sort(), Object.keys(DEFAULT_FORMULA_TUNE).sort());
  for (const [k, [lo, hi]] of Object.entries(FORMULA_TUNE_LIMITS)) assert.ok(DEFAULT_FORMULA_TUNE[k] >= lo && DEFAULT_FORMULA_TUNE[k] <= hi, k);
  assert.deepEqual(DEFAULT_FORMULA_TUNE, { gearing: 0, downforce: 0.5, steering: 0, pressure: 0, nitro: 0, gearbox: 'manual', shiftLight: 0.9 });
});

test('cleanFormulaTune keeps every setting in its range, in steps of 0.1, with whole nitro bottles and a real gearbox, whatever it is given', () => {
  const hostile = [null, undefined, 5, 'x', [], {}, { gearing: 1e9, downforce: -1e9, steering: NaN, pressure: Infinity, nitro: 99, shiftLight: -5, gearbox: 'turbo' }, { gearing: '0.55', downforce: '1', nitro: 1.6, gearbox: 'auto' }, { gearing: {}, downforce: [], steering: null, nitro: -4 }, JSON.parse('{"__proto__":{"gearing":9},"gearing":0.04}')];
  for (const raw of hostile) {
    const t = cleanFormulaTune(raw);
    for (const [k, [lo, hi]] of Object.entries(FORMULA_TUNE_LIMITS)) { assert.ok(Number.isFinite(t[k]) && t[k] >= lo && t[k] <= hi, `${k} = ${t[k]} for ${JSON.stringify(raw)}`); }
    assert.ok(Number.isInteger(t.nitro)); assert.ok(t.gearbox === 'manual' || t.gearbox === 'auto'); assert.deepEqual(cleanFormulaTune(t), t, 'cleaning twice changes nothing');
  }
  assert.deepEqual(cleanFormulaTune({ gearing: 1e9, nitro: 99, gearbox: 'auto' }), { ...DEFAULT_FORMULA_TUNE, gearing: 1, nitro: NITRO.maxBottles, gearbox: 'auto' });
  assert.equal(cleanFormulaTune({ gearing: '0.55' }).gearing, 0.6); assert.equal(cleanFormulaTune({ steering: NaN }).steering, 0);
});

test('tune safety: no tune a player can set (or send) makes the car faster than the best the limits allow, or breaks the lap', () => {
  const lap = tune => predictFormula(STOCK_SPEC, tune);
  // the corners of the tune box, and some wild values: every lap finishes, is finite and is no quicker than the best corner
  const corners = []; for (const gearing of [-1, 1]) for (const downforce of [0, 1]) for (const pressure of [-1, 1]) for (const steering of [-1, 1]) corners.push({ gearing, downforce, pressure, steering, nitro: 3 });
  const times = corners.map(c => lap(c).lapTime); assert.ok(times.every(t => Number.isFinite(t) && t > 30 && t < 80), times.join(' '));
  const best = Math.min(...times);
  for (const wild of [{ gearing: 1e9, downforce: 1e9, pressure: 1e9, steering: 1e9, nitro: 1e9, shiftLight: 1e9 }, { gearing: -1e9, downforce: -1e9, pressure: -1e9, steering: -1e9, nitro: -1e9 }, { gearing: NaN, nitro: NaN }, 'x', null]) { const t = lap(wild); assert.ok(t.finished && t.lapTime >= best - 0.05, `${JSON.stringify(wild)} -> ${t.lapTime} (best corner ${best})`); }
  const s = carStats(STOCK_SPEC, { gearing: 1e9, downforce: 1e9, pressure: 1e9, steering: 1e9, nitro: 1e9, shiftLight: 1e9, gearbox: 'auto' }), edge = carStats(STOCK_SPEC, { gearing: 1, downforce: 1, pressure: 1, steering: 1, nitro: 3, shiftLight: 1, gearbox: 'auto' });
  assert.deepEqual(s, edge, 'a hostile tune gives exactly the edge-of-the-limits car');
});

test('each tune setting is a trade, in the direction the help text says', () => {
  const base = carStats(STOCK_SPEC, DEFAULT_FORMULA_TUNE), with_ = t => carStats(STOCK_SPEC, { ...DEFAULT_FORMULA_TUNE, ...t });
  assert.ok(with_({ gearing: 1 }).vmax > base.vmax && with_({ gearing: 1 }).accel < base.accel, 'tall gears: top speed for pull');
  assert.ok(with_({ downforce: 1 }).grip > base.grip && with_({ downforce: 1 }).vmax < base.vmax && with_({ downforce: 1 }).aero > base.aero, 'downforce: grip for top speed');
  assert.ok(with_({ steering: 1 }).turn > base.turn && with_({ steering: 1 }).grip < base.grip, 'quick steering: turn for grip');
  assert.ok(with_({ pressure: 1 }).vmax > base.vmax && with_({ pressure: 1 }).grip < base.grip, 'hard tyres: top speed for grip');
  assert.ok(with_({ nitro: 3 }).grip < base.grip && with_({ nitro: 3 }).nitroShots === 3, 'nitro bottles cost grip');
});

test('the six tune slots keep Formula tunes and make them safe when they are loaded', () => {
  let slots = emptySlots(); slots = putSlot(slots, 0, 'beach dry', { ...DEFAULT_FORMULA_TUNE, gearing: 0.5, nitro: 2, gearbox: 'auto' }); slots = putSlot(slots, 5, 'hot', { gearing: 9e9, nitro: -3 });
  const loaded = cleanFormulaSlots(JSON.parse(JSON.stringify(slots))); assert.equal(loaded.length, SLOT_COUNT);
  assert.equal(loaded[0].name, 'BEACH DRY'); assert.deepEqual(loaded[0].tune, { ...DEFAULT_FORMULA_TUNE, gearing: 0.5, nitro: 2, gearbox: 'auto' });
  assert.equal(loaded[5].tune.gearing, 1); assert.equal(loaded[5].tune.nitro, 0); assert.equal(loaded[1], null);
  assert.equal(cleanFormulaSlots('garbage').filter(Boolean).length, 0);
});

test('the benchmark sets the engine inside the class window: a strong built-in GPU is a slow car, the best separate card a fast one, no benchmark the slowest of all', () => {
  const engineOf = b => formulaSpecForBenchmark(b).engine, lapOf = b => predictFormula(formulaSpecForBenchmark(b)).lapTime;
  const none = engineOf(null), i0 = engineOf(bench('integrated', 0)), i80 = engineOf(bench('integrated', 8000)), d0 = engineOf(bench('discrete', 0)), d10 = engineOf(bench('discrete', 10000));
  assert.equal(none, UNBENCHMARKED_ENGINE); assert.ok(none < i0 && i0 < i80 && i80 < d0 && d0 < d10, [none, i0, i80, d0, d10].join(' < '));
  assert.equal(i0, FORMULA_CLASS_WINDOWS.integrated.engine[0]); assert.equal(d10, FORMULA_CLASS_WINDOWS.discrete.engine[1]); assert.equal(d10, STOCK_SPEC.engine, 'the best card has the source game\'s top engine');
  assert.equal(engineOf(bench('discrete', 1e9)), d10, 'a score past the class cap is capped'); assert.equal(engineOf(bench('integrated', 1e9)), engineOf(bench('integrated', 8000)));
  assert.equal(engineOf(bench('nonsense', 5000)), UNBENCHMARKED_ENGINE, 'an unknown class is no result'); assert.equal(engineOf(bench('integrated', NaN)), UNBENCHMARKED_ENGINE); assert.equal(engineOf(bench('integrated', -50)), i0);
  let last = Infinity; for (const score of [0, 1000, 3000, 5000, 8000]) { const t = lapOf(bench('integrated', score)); assert.ok(t < last, `integrated ${score}: ${t}`); last = t; }
  assert.ok(last > lapOf(bench('discrete', 0)), 'the best built-in GPU is slower than the weakest separate card'); assert.ok(lapOf(null) > lapOf(bench('integrated', 0)), 'no benchmark is slower than every benchmarked car');
  assert.deepEqual(formulaSpecForBenchmark(bench('discrete', 4321)), formulaSpecForBenchmark(bench('discrete', 4321)));
});
