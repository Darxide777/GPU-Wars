// The benchmark: scoring, the spec it gives the car, the dyno, the class and re-run rules, GPU naming, and the save's checks. Deterministic, no GPU needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BENCHMARK } from '../src/benchmark/constants.ts';
import { summarizePasses, scoreFromRate, capScore, classScoreCap, checkDurations, outcomeFromPasses } from '../src/benchmark/score.ts';
import { classifyGpu, identityFromText } from '../src/benchmark/gpu.ts';
import { rerunReason, needsBenchmark, classState, lockClass, stepClass, resultFromRun } from '../src/benchmark/rules.ts';
import { dynoCurve, dynoPeaks, powerAt, torqueAt, dynoSvg } from '../src/benchmark/dyno.ts';
import { startBenchmark, nextBatch } from '../src/benchmark/runner.ts';
import { specForBenchmark, stockSpec, specLimitsOf, CLASS_SPEC_LIMITS, curveForSustain, HP_DIVISOR, tableRowFor, WEAKEST_RESULT, UNBENCHMARKED_TORQUE_SHARE } from '../src/drag/spec-source.ts';
import { CLASS_IDS } from '../src/classes.ts';
import { sanitizeSave, emptySave, cleanBenchmark, cleanClassLock } from '../src/save.ts';
import { readyCar } from '../src/drag/model.ts';
import { createDrag, createDragStrip, DRAG } from '../src/drag/physics.ts';
import { cleanTune } from '../src/drag/tune.ts';
import { STOCK_CAR } from '../src/drag/spec-source.ts';

const result = (o = {}) => ({ score: 5000, class: 'discrete-nvidia-modern', benchmarkVersion: BENCHMARK.version, gpuId: 'NVIDIA GeForce RTX 3060', date: 1700000000000, ...o });

// ---- spec from the score ----
test('the spec stays inside the class limits and in sane bounds for every class at score extremes', () => {
  for (const cls of CLASS_IDS) for (const score of [-50, 0, 1, 5000, BENCHMARK.maxScore, 1e9, NaN]) for (const sustain of [0, 0.5, 1, undefined]) {
    const spec = specForBenchmark(result({ class: cls, score, sustain })), lim = specLimitsOf(cls);
    assert.ok(spec.torque >= lim.torqueNm[0] && spec.torque <= lim.torqueNm[1], `${cls} ${score}: torque ${spec.torque}`);
    assert.ok(spec.redline >= lim.redline[0] && spec.redline <= lim.redline[1], `${cls} ${score}: redline ${spec.redline}`);
    assert.ok(spec.peakRpm > spec.idle + 1000 && spec.peakRpm <= spec.redline - 1000, `${cls} ${score}: peak ${spec.peakRpm} redline ${spec.redline}`);
    for (const v of [spec.torque, spec.peakRpm, spec.redline]) assert.ok(Number.isFinite(v));
  }
});
test('a higher score never gives a weaker engine in the same class, and the table is in order', () => {
  for (const cls of ['integrated', 'discrete-amd-classic', 'discrete-nvidia-current']) { let last = 0; for (let s = 0; s <= BENCHMARK.maxScore; s += 250) { const t = specForBenchmark(result({ class: cls, score: s })).torque; assert.ok(t >= last, `${cls} ${s}`); last = t; } }
  assert.ok(tableRowFor(-5).torqueShare === tableRowFor(0).torqueShare && tableRowFor(1e9).torqueShare === tableRowFor(1).torqueShare);
});
test('the same result always gives the same spec, with no benchmark the stock car, and class limits beat a high score', () => {
  assert.deepEqual(specForBenchmark(result()), specForBenchmark(result())); assert.deepEqual(specForBenchmark(null), { ...specForBenchmark(WEAKEST_RESULT), torque: Math.round(specForBenchmark(WEAKEST_RESULT).torque * UNBENCHMARKED_TORQUE_SHARE) });
  assert.deepEqual(specForBenchmark(result({ class: 'not a class' })), specForBenchmark(null), 'a result with an unknown class is not believed');
  const weak = specForBenchmark(result({ class: 'integrated', score: BENCHMARK.maxScore })), strong = specForBenchmark(result({ class: 'discrete-nvidia-current', score: BENCHMARK.maxScore }));
  assert.ok(weak.torque <= CLASS_SPEC_LIMITS.integrated.torqueNm[1] && weak.torque < strong.torque);
});
test('the un-benchmarked spec is no faster than the lowest possible benchmarked one, and weaker than every other', () => {
  const none = specForBenchmark(null), floor = specForBenchmark(result({ class: 'integrated', score: 0 }));
  assert.deepEqual({ ...none, torque: 0 }, { ...floor, torque: 0 }); assert.ok(none.torque < floor.torque, 'strictly weaker than the slowest benchmarked card');
  for (const cls of CLASS_IDS) for (const score of [0, 3000, BENCHMARK.maxScore]) { const s = specForBenchmark(result({ class: cls, score })); assert.ok(none.torque <= s.torque && none.redline <= s.redline, `${cls} ${score}`); }
  const et = spec => { const { tune } = readyCar(emptySave()); const d = createDrag({ seed: 3, strip: createDragStrip(2), entrants: [{ name: 'YOU', spec, tune, ai: { react: 0.2, spread: 0, shiftErr: 0, foul: 0 } }] }); let n = 0; while (d.state.phase !== 'over' && n++ < 240 * 60) d.step(); return d.state.runners[0].marks.quarter; };
  assert.ok(et(none) >= et(specForBenchmark(result({ class: 'discrete-nvidia-current', score: BENCHMARK.maxScore }))), 'and slower than the best card');
});
test('the clutch passes through and the rest of the car is the stock parts', () => {
  const s = specForBenchmark(result(), 0.6), stock = stockSpec(0.6);
  assert.equal(s.clutchCondition, 0.6); assert.equal(s.mass, stock.mass); assert.equal(s.boostCap, stock.boostCap); assert.equal(s.gearsMax, stock.gearsMax);
});

// ---- hp, torque and rpm agree, through the one curve ----
test('hp = torque x rpm / 7127 on the same curve the physics uses, and the peaks are consistent', () => {
  for (const cls of ['integrated', 'discrete-amd-classic', 'discrete-nvidia-current']) for (const sustain of [0, 0.5, 1]) {
    const spec = specForBenchmark(result({ class: cls, score: 7000, sustain })), pts = dynoCurve(spec, 50), peaks = dynoPeaks(spec);
    for (const p of pts) { assert.ok(Math.abs(p.hp - p.torqueNm * p.rpm / HP_DIVISOR) < 1e-9); assert.ok(p.torqueNm <= spec.torque + 1e-9, 'torque never above the peak'); }
    assert.ok(Math.abs(peaks.torqueNm - spec.torque) < spec.torque * 0.01, 'the curve reaches the spec torque');
    assert.ok(Math.abs(peaks.torqueRpm - spec.peakRpm) <= 100, 'at the spec peak revs');
    assert.ok(Math.abs(peaks.hp - Math.max(...pts.map(p => p.hp))) < peaks.hp * 0.01);
    assert.ok(peaks.hpRpm >= spec.peakRpm - 50 && peaks.hpRpm <= spec.redline, 'power peaks at or above the torque peak');
    assert.ok(Math.abs(powerAt(spec, 5000) - torqueAt(spec, 5000) * 5000 / HP_DIVISOR) < 1e-9);
  }
});
test('sustained cards get broad high-rev curves and burst cards punchy low-mid ones', () => {
  const burst = specForBenchmark(result({ sustain: 0 })), steady = specForBenchmark(result({ sustain: 1 }));
  assert.ok(steady.peakRpm > burst.peakRpm, 'sustained peaks higher in the revs');
  const at = (spec, r) => torqueAt(spec, r) / spec.torque;
  assert.ok(at(burst, 4000) > at(steady, 4000), 'burst has more of its torque low down');
  assert.ok(at(steady, steady.redline) > at(burst, burst.redline), 'sustained holds torque up to the limiter');
  assert.ok(dynoPeaks(steady).hpRpm > dynoPeaks(burst).hpRpm, 'and its power peaks later');
  const c = curveForSustain(0.5); assert.equal(c.rise.length, 5); assert.equal(c.fall[0][1], 1);
  assert.deepEqual(curveForSustain(NaN), curveForSustain(0.5));
});
test('a class with no measured sustain uses its usual: integrated bursts, discrete holds', () => {
  const i = specForBenchmark(result({ class: 'integrated', sustain: undefined })), d = specForBenchmark(result({ class: 'discrete-nvidia-modern', sustain: undefined }));
  assert.ok(d.peakRpm / d.redline > i.peakRpm / i.redline);
});
test('the dyno graph is drawn with the shift point and the power peak', () => {
  const svg = dynoSvg(specForBenchmark(result()), 8000); assert.match(svg, /^<svg/); assert.match(svg, /SHIFT 8000/); assert.match(svg, /HP @/); assert.match(svg, /NM @/);
  assert.doesNotMatch(dynoSvg(specForBenchmark(result()), NaN), /NaN/);
});
test('a full race at the weakest and strongest specs finishes with finite numbers, and the default tune fits the engine', () => {
  for (const [cls, score] of [['integrated', 0], ['discrete-nvidia-current', BENCHMARK.maxScore]]) {
    const save = { ...emptySave(), benchmark: result({ class: cls, score }) }, { spec, tune } = readyCar(save);
    assert.ok(tune.shiftRpm <= spec.redline && tune.shiftRpm >= spec.redline - 500, `shift at ${tune.shiftRpm}, limiter ${spec.redline}`);
    const d = createDrag({ seed: 3, strip: createDragStrip(2), entrants: [{ name: 'YOU', spec, tune, ai: { react: 0.2, spread: 0, shiftErr: 0, foul: 0 } }] }); let n = 0;
    while (d.state.phase !== 'over' && n++ < 240 * 60) d.step();
    const r = d.state.runners[0]; assert.equal(d.state.phase, 'over'); assert.ok(Number.isFinite(r.marks.quarter) && r.marks.quarter > 3 && r.marks.quarter < 40, `${cls} ET ${r.marks.quarter}`);
  }
  const et = (cls, score, sustain) => { const { spec, tune } = readyCar({ ...emptySave(), benchmark: result({ class: cls, score, sustain }) }); const d = createDrag({ seed: 3, strip: createDragStrip(2), entrants: [{ name: 'YOU', spec, tune, ai: { react: 0.2, spread: 0, shiftErr: 0, foul: 0 } }] }); let n = 0; while (d.state.phase !== 'over' && n++ < 240 * 60) d.step(); return d.state.runners[0].marks.quarter; };
  // with the default tune a better card is never meaningfully slower (the torque range stops where grip becomes the limit), and the weakest is clearly slower than the strongest
  for (const cls of ['integrated', 'discrete-nvidia-current']) { let slowest = 0, last = Infinity; for (let s = 0; s <= BENCHMARK.maxScore; s += 1000) { const e = et(cls, s, 0.7); assert.ok(e <= last + 0.1, `${cls} ${s}: ${e} after ${last}`); last = e; slowest = Math.max(slowest, e); } assert.ok(slowest - last > 0.5, `${cls} spans ${slowest - last}`); }
});

// ---- scoring ----
test('throttled passes are discarded and the rest averaged', () => {
  const s = summarizePasses([100, 102, 98, 60, 101]); assert.deepEqual(s.discarded, [60]); assert.ok(s.ok && Math.abs(s.rate - 100.25) < 1e-9);
  assert.ok(s.sustain < 0.7, 'a drop shows in the sustain'); assert.ok(summarizePasses([100, 101, 99, 100, 100]).sustain > 0.97);
  assert.ok(summarizePasses([100, 100, 100, 150, 100]).discarded.includes(150), 'a boost spike is discarded too');
  assert.equal(summarizePasses([100, 50, 40, 30, 20]).ok, false, 'too unsteady to score'); assert.equal(summarizePasses([100]).ok, false); assert.equal(summarizePasses([NaN, 0, -3, 5, 5]).ok, false);
});
test('the score is a log scale from 0 to the top and never outside it, and 2D canvas is limited', () => {
  const { min, max } = BENCHMARK.rate.webgl2; assert.equal(scoreFromRate(min / 10, 'webgl2'), 0); assert.equal(scoreFromRate(max * 1000, 'webgl2'), BENCHMARK.maxScore); assert.equal(scoreFromRate(NaN, 'webgl2'), 0);
  assert.ok(Math.abs(scoreFromRate(Math.sqrt(min * max), 'webgl2') - BENCHMARK.maxScore / 2) <= 1);
  assert.ok(scoreFromRate(1e15, 'canvas2d') <= BENCHMARK.maxScore * BENCHMARK.canvas2dScoreShare);
});
test('impossible scores are capped by class', () => {
  assert.equal(capScore(99999, 'integrated'), classScoreCap('integrated')); assert.ok(classScoreCap('integrated') < classScoreCap('discrete-nvidia-current')); assert.equal(capScore(-5, 'integrated'), 0); assert.equal(capScore(NaN, 'integrated'), 0);
  const ok = Array.from({ length: BENCHMARK.passes }, () => ({ rate: BENCHMARK.rate.webgl2.max, wallMs: BENCHMARK.passMs }));
  const o = outcomeFromPasses(ok, 15000, false, 'webgl2', 'integrated'); assert.ok(o.ok && o.capped && o.score === classScoreCap('integrated') && o.rawScore === BENCHMARK.maxScore);
});
test('an implausible duration is refused', () => {
  const good = Array(BENCHMARK.passes).fill(BENCHMARK.passMs + 30);
  assert.ok(checkDurations(good, 15000, false).ok);
  assert.equal(checkDurations(good, 15000, true).ok, false, 'a hidden page'); assert.equal(checkDurations(good, BENCHMARK.maxRunMs + 1, false).ok, false);
  assert.equal(checkDurations([...good.slice(1), BENCHMARK.passMs * 3], 15000, false).ok, false, 'a stalled pass'); assert.equal(checkDurations([...good.slice(1), 10], 15000, false).ok, false, 'a pass that ended too soon'); assert.equal(checkDurations(good.slice(1), 15000, false).ok, false, 'missing passes');
  assert.equal(outcomeFromPasses(good.map(w => ({ rate: 1e11, wallMs: w })), 15000, true, 'webgl2', 'integrated').ok, false);
});
test('the batch of draws between syncs adapts', () => {
  assert.equal(nextBatch(4, 5), 8); assert.equal(nextBatch(4, BENCHMARK.batchTargetMs), 4); assert.equal(nextBatch(4, 500), 2); assert.equal(nextBatch(1, 500), 1); assert.equal(nextBatch(256, 1), 256);
});
test('the runner runs warm-up, passes and scoring with a fake card and clock, and can be cancelled', async () => {
  let t = 0; const now = () => t, sleep = async () => { t += 10; };
  const fake = { backend: 'webgl2', canvas: { remove() {} }, unitsPerDraw: 1e9, dispose() {}, run(draws) { t += 5 * draws; return draws * 1e9; } };
  const run = startBenchmark({ cls: 'discrete-nvidia-modern', beat: () => ({ eq: [], pulse: 0, pulse2: 0, pulseHalf: 0, phase: 1, index: 0, intensity: 0, bass: 0, mid: 0, high: 0, on: false }), createWorkload: () => fake, now, sleep });
  const r = await run.done; assert.equal(r.status, 'done', JSON.stringify(r).slice(0, 300)); assert.equal(r.outcome.rates.length, BENCHMARK.passes); assert.ok(r.outcome.score > 0 && r.outcome.score <= classScoreCap('discrete-nvidia-modern'));
  const again = await startBenchmark({ cls: 'integrated', beat: () => ({}), createWorkload: () => ({ ...fake, run(d) { t += 5 * d; return d * 1e9; } }), now: () => t, sleep }).done; assert.equal(again.status, 'done');
  let t2 = 0; const c = startBenchmark({ cls: 'integrated', beat: () => ({ eq: [] }), createWorkload: () => fake, now: () => t2, sleep: async () => { t2 += 10; } }); c.cancel(); assert.equal((await c.done).status, 'cancelled');
  assert.equal((await startBenchmark({ cls: 'integrated', beat: () => ({}), createWorkload: () => null }).done).status, 'failed', 'no way to draw is reported, not thrown');
});

// ---- naming the card, never guessing ----
test('a class is named only when the text says plainly what the card is', () => {
  const c = t => classifyGpu(t).detectedClass;
  assert.equal(c('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'discrete-nvidia-modern');
  assert.equal(c('NVIDIA GeForce RTX 4090'), 'discrete-nvidia-current'); assert.equal(c('NVIDIA GeForce GTX 1060 6GB'), 'discrete-nvidia-classic'); assert.equal(c('NVIDIA GeForce GTX 1650'), 'discrete-nvidia-modern'); assert.equal(c('GeForce GTX 480'), 'discrete-nvidia-retro');
  assert.equal(c('ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11, D3D11)'), 'discrete-amd-classic'); assert.equal(c('AMD Radeon RX 6800 XT'), 'discrete-amd-modern'); assert.equal(c('AMD Radeon RX 7900 XTX'), 'discrete-amd-current');
  assert.equal(c('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11, D3D11)'), 'integrated'); assert.equal(c('AMD Radeon(TM) Graphics'), 'integrated'); assert.equal(c('Apple M2'), 'integrated'); assert.equal(c('Adreno (TM) 650'), 'integrated');
  assert.equal(c('Intel(R) Arc(TM) A770 Graphics'), 'discrete-intel-current');
  // not plain enough: asked of the player
  for (const t of ['', 'unknown', 'WebKit WebGL', 'Intel(R) Arc(TM) Graphics', 'NVIDIA Quadro P2000', 'Mali', 'Google SwiftShader', 'llvmpipe (LLVM 15)', 'Some Brand GPU 9000']) assert.equal(c(t), null, `"${t}" is not guessed`);
  assert.equal(classifyGpu('Google SwiftShader').why.includes('SOFTWARE'), true);
});
test('the card id and the detected class agree across WebGL and WebGPU, or the player picks', () => {
  assert.equal(identityFromText('NVIDIA GeForce RTX 3060', '').detectedClass, 'discrete-nvidia-modern');
  assert.equal(identityFromText('NVIDIA GeForce RTX 3060', 'nvidia ampere').detectedClass, 'discrete-nvidia-modern', 'a vague WebGPU text does not veto');
  assert.equal(identityFromText('NVIDIA GeForce RTX 3060', 'Intel(R) UHD Graphics 630').detectedClass, null, 'a disagreement is not guessed through');
  assert.equal(identityFromText('', 'amd rdna-3 Radeon RX 7800 XT').source, 'webgpu'); assert.equal(identityFromText('', '').gpuId, 'unknown'); assert.equal(identityFromText('', '').detectedClass, null);
  assert.equal(identityFromText('Google SwiftShader', '').software, true); assert.equal(identityFromText('x\u0000éy  z', '').gpuId, 'xy z');
  assert.ok(identityFromText('a'.repeat(500), '').gpuId.length <= 200);
});

// ---- re-run and class lock rules ----
test('the benchmark is re-run only when the card or the benchmark version changes', () => {
  const r = result(); assert.equal(rerunReason(null, r.gpuId), 'never run'); assert.equal(rerunReason(r, r.gpuId), null); assert.equal(needsBenchmark(r, r.gpuId), false);
  assert.equal(rerunReason(r, 'another card'), 'new graphics card'); assert.equal(rerunReason(r, r.gpuId, BENCHMARK.version + 1), 'new benchmark version'); assert.equal(rerunReason({ ...r, date: 5, score: 1 }, r.gpuId), null, 'age and score do not matter');
});
test('class lock: a named class is fixed, a hand pick locks to the card, and a new card unlocks', () => {
  const named = { gpuId: 'g1', detectedClass: 'discrete-nvidia-modern' }, unnamed = { gpuId: 'g2', detectedClass: null };
  let st = classState(named, null, null); assert.deepEqual(st, { locked: 'discrete-nvidia-modern', how: 'detected', canChange: false });
  assert.equal(lockClass(st, 'g1', 'integrated', 1), null, 'a detected class cannot be overridden');
  assert.equal(classState(named, { class: 'integrated', gpuId: 'g1', date: 1 }, null).locked, 'discrete-nvidia-modern', 'a lock does not beat the browser');
  st = classState(unnamed, null, null); assert.deepEqual(st, { locked: null, how: 'none', canChange: true });
  assert.equal(lockClass(st, 'g2', 'not a class', 1), null); assert.equal(lockClass(st, '', 'integrated', 1), null);
  const lock = lockClass(st, 'g2', 'discrete-amd-modern', 123.9); assert.deepEqual(lock, { class: 'discrete-amd-modern', gpuId: 'g2', date: 123 });
  st = classState(unnamed, lock, null); assert.deepEqual(st, { locked: 'discrete-amd-modern', how: 'manual', canChange: false });
  assert.equal(lockClass(st, 'g2', 'integrated', 5), null, 'once locked it cannot be changed');
  assert.equal(classState({ gpuId: 'g3', detectedClass: null }, lock, null).canChange, true, 'a different card unlocks the pick');
  assert.equal(classState(unnamed, null, result({ gpuId: 'g2', class: 'integrated' })).locked, 'integrated', 'a benchmark already run on this card keeps its class');
  assert.equal(classState({ gpuId: 'g3', detectedClass: null }, null, result({ gpuId: 'g2', class: 'integrated' })).locked, null);
});
test('stepping through classes wraps and visits every class', () => {
  const seen = new Set(); let c = null; for (let i = 0; i < CLASS_IDS.length; i++) { c = stepClass(c, 1); seen.add(c); } assert.equal(seen.size, CLASS_IDS.length);
  assert.equal(stepClass(CLASS_IDS[CLASS_IDS.length - 1], 1), CLASS_IDS[0]); assert.equal(stepClass(CLASS_IDS[0], -1), CLASS_IDS[CLASS_IDS.length - 1]); assert.equal(stepClass(null, -1), CLASS_IDS[CLASS_IDS.length - 1]);
});

// ---- the save ----
test('the saved benchmark and class lock are checked, and the result has the agreed fields', () => {
  const run = resultFromRun({ score: 4321, sustain: 2, cls: 'integrated', gpuId: 'g', now: 99.9 });
  assert.deepEqual(Object.keys(run).sort(), ['benchmarkVersion', 'class', 'date', 'gpuId', 'score', 'sustain']); assert.equal(run.sustain, 1); assert.equal(run.date, 99);
  assert.deepEqual(sanitizeSave({ benchmark: run }).benchmark, run);
  for (const bad of [{ ...run, class: 'integrated; DROP' }, { ...run, class: 'discrete-nvidia-future' }, { ...run, gpuId: '\u0001' }, { ...run, score: 'x' }, { ...run, score: -1 }, null, 3, []]) assert.equal(cleanBenchmark(bad), null);
  assert.equal(cleanBenchmark({ ...run, score: 1e9 }).score, BENCHMARK.maxScore, 'an impossible stored score is capped'); assert.equal(cleanBenchmark({ ...run, sustain: 'x' }).sustain, undefined); assert.equal(cleanBenchmark({ ...run, gpuId: 'é' + 'g'.repeat(400) }).gpuId.length, 200);
  assert.equal(cleanClassLock({ class: 'integrated', gpuId: 'g', date: 5 }).class, 'integrated'); for (const bad of [{ class: 'x', gpuId: 'g' }, { class: 'integrated', gpuId: '' }, 'x', null]) assert.equal(cleanClassLock(bad), null);
  assert.equal(sanitizeSave({ classLock: { class: 'integrated', gpuId: 'g', date: -3 } }).classLock.date, 0); assert.equal(emptySave().classLock, null); assert.equal(sanitizeSave({}).classLock, null);
});
test('a tune saved for a stronger engine is brought inside a weaker one', () => {
  const weak = specForBenchmark(result({ class: 'integrated', score: 0 })), tune = cleanTune({ shiftRpm: 9300, launchRpm: 9000 }, { ...STOCK_CAR, redline: weak.redline, peakRpm: weak.peakRpm }, weak);
  assert.ok(tune.shiftRpm <= weak.redline && tune.launchRpm <= weak.redline);
});
