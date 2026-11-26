// The benchmark: scoring, the spec it gives the car, the dyno, the class and re-run rules, GPU naming, and the save's checks. Deterministic, no GPU needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BENCHMARK, MASKED_GPU_RULE } from '../src/benchmark/constants.ts';
import { classForMaskedRate, maskedDiscreteRate, maskedDiscreteMinScore, summarizePasses, scoreFromRate, capScore, classScoreCap, checkDurations, outcomeFromPasses } from '../src/benchmark/score.ts';
import { maskedReason, MASKED_NOTE, classifyGpu, identityFromText, identify, gpuLine, PENDING_GPU } from '../src/benchmark/gpu.ts';
import { rerunReason, needsBenchmark, repairBenchmark, resultFromRun } from '../src/benchmark/rules.ts';
import { dynoCurve, dynoPeaks, powerAt, torqueAt, dynoSvg } from '../src/benchmark/dyno.ts';
import { startBenchmark, nextBatch } from '../src/benchmark/runner.ts';
import { fragment } from '../src/benchmark/workload.ts';
import { createHash } from 'node:crypto';
import { specForBenchmark, stockSpec, specLimitsOf, CLASS_SPEC_LIMITS, curveForSustain, HP_DIVISOR, tableRowFor, WEAKEST_RESULT, UNBENCHMARKED_TORQUE_SHARE } from '../src/drag/spec-source.ts';
import { CLASS_IDS } from '../src/classes.ts';
import { benchmarkItem, classItem } from '../src/benchmark/menu.ts';
import { REFERENCE_CARDS } from '../src/benchmark/reference.ts';
import { predictDrag } from '../src/drag/physics.ts';
import { RANKED, rankedStart, rankedStrip } from '../src/leaderboard/ranked.ts';
import { sanitizeSave, emptySave, cleanBenchmark } from '../src/save.ts';
import { readyCar } from '../src/drag/model.ts';
import { createDrag, createDragStrip, DRAG } from '../src/drag/physics.ts';
import { cleanTune } from '../src/drag/tune.ts';
import { STOCK_CAR } from '../src/drag/spec-source.ts';

const result = (o = {}) => ({ score: 5000, class: 'discrete', benchmarkVersion: BENCHMARK.version, gpuId: 'NVIDIA GeForce RTX 3060', date: 1700000000000, ...o });

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
  for (const cls of ['integrated', 'discrete', 'discrete']) { let last = 0; for (let s = 0; s <= BENCHMARK.maxScore; s += 250) { const t = specForBenchmark(result({ class: cls, score: s })).torque; assert.ok(t >= last, `${cls} ${s}`); last = t; } }
  assert.ok(tableRowFor(-5).torqueShare === tableRowFor(0).torqueShare && tableRowFor(1e9).torqueShare === tableRowFor(1).torqueShare);
});
test('the same result always gives the same spec, with no benchmark the stock car, and class limits beat a high score', () => {
  assert.deepEqual(specForBenchmark(result()), specForBenchmark(result())); assert.deepEqual(specForBenchmark(null), { ...specForBenchmark(WEAKEST_RESULT), torque: Math.round(specForBenchmark(WEAKEST_RESULT).torque * UNBENCHMARKED_TORQUE_SHARE) });
  assert.deepEqual(specForBenchmark(result({ class: 'not a class' })), specForBenchmark(null), 'a result with an unknown class is not believed');
  const weak = specForBenchmark(result({ class: 'integrated', score: BENCHMARK.maxScore })), strong = specForBenchmark(result({ class: 'discrete', score: BENCHMARK.maxScore }));
  assert.ok(weak.torque <= CLASS_SPEC_LIMITS.integrated.torqueNm[1] && weak.torque < strong.torque);
});
test('the un-benchmarked spec is no faster than the lowest possible benchmarked one, and weaker than every other', () => {
  const none = specForBenchmark(null), floor = specForBenchmark(result({ class: 'integrated', score: 0 }));
  assert.deepEqual({ ...none, torque: 0 }, { ...floor, torque: 0 }); assert.ok(none.torque < floor.torque, 'strictly weaker than the slowest benchmarked card');
  for (const cls of CLASS_IDS) for (const score of [0, 3000, BENCHMARK.maxScore]) { const s = specForBenchmark(result({ class: cls, score })); assert.ok(none.torque <= s.torque && none.redline <= s.redline, `${cls} ${score}`); }
  const et = spec => { const { tune } = readyCar(emptySave()); const d = createDrag({ seed: 3, strip: createDragStrip(2), entrants: [{ name: 'YOU', spec, tune, ai: { react: 0.2, spread: 0, shiftErr: 0, foul: 0 } }] }); let n = 0; while (d.state.phase !== 'over' && n++ < 240 * 60) d.step(); return d.state.runners[0].marks.quarter; };
  assert.ok(et(none) >= et(specForBenchmark(result({ class: 'discrete', score: BENCHMARK.maxScore }))), 'and slower than the best card');
});
test('the clutch passes through and the rest of the car is the stock parts', () => {
  const s = specForBenchmark(result(), 0.6), stock = stockSpec(0.6);
  assert.equal(s.clutchCondition, 0.6); assert.equal(s.mass, stock.mass); assert.equal(s.boostCap, stock.boostCap); assert.equal(s.gearsMax, stock.gearsMax);
});

// ---- hp, torque and rpm agree, through the one curve ----
test('hp = torque x rpm / 7127 on the same curve the physics uses, and the peaks are consistent', () => {
  for (const cls of ['integrated', 'discrete', 'discrete']) for (const sustain of [0, 0.5, 1]) {
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
  const i = specForBenchmark(result({ class: 'integrated', sustain: undefined })), d = specForBenchmark(result({ class: 'discrete', sustain: undefined }));
  assert.ok(d.peakRpm / d.redline > i.peakRpm / i.redline);
});
test('the dyno graph is drawn with the shift point and the power peak', () => {
  const svg = dynoSvg(specForBenchmark(result()), 8000); assert.match(svg, /^<svg/); assert.match(svg, /SHIFT 8000/); assert.match(svg, /HP @/); assert.match(svg, /NM @/);
  assert.doesNotMatch(dynoSvg(specForBenchmark(result()), NaN), /NaN/);
});
test('a full race at the weakest and strongest specs finishes with finite numbers, and the default tune fits the engine', () => {
  for (const [cls, score] of [['integrated', 0], ['discrete', BENCHMARK.maxScore]]) {
    const save = { ...emptySave(), benchmark: result({ class: cls, score }) }, { spec, tune } = readyCar(save);
    assert.ok(tune.shiftRpm <= spec.redline && tune.shiftRpm >= spec.redline - 500, `shift at ${tune.shiftRpm}, limiter ${spec.redline}`);
    const d = createDrag({ seed: 3, strip: createDragStrip(2), entrants: [{ name: 'YOU', spec, tune, ai: { react: 0.2, spread: 0, shiftErr: 0, foul: 0 } }] }); let n = 0;
    while (d.state.phase !== 'over' && n++ < 240 * 60) d.step();
    const r = d.state.runners[0]; assert.equal(d.state.phase, 'over'); assert.ok(Number.isFinite(r.marks.quarter) && r.marks.quarter > 3 && r.marks.quarter < 40, `${cls} ET ${r.marks.quarter}`);
  }
  const et = (cls, score, sustain) => { const { spec, tune } = readyCar({ ...emptySave(), benchmark: result({ class: cls, score, sustain }) }); const d = createDrag({ seed: 3, strip: createDragStrip(2), entrants: [{ name: 'YOU', spec, tune, ai: { react: 0.2, spread: 0, shiftErr: 0, foul: 0 } }] }); let n = 0; while (d.state.phase !== 'over' && n++ < 240 * 60) d.step(); return d.state.runners[0].marks.quarter; };
  // with the default tune a better card is never meaningfully slower (the torque range stops where grip becomes the limit), and the weakest is clearly slower than the strongest
  for (const cls of ['integrated', 'discrete']) { let slowest = 0, last = Infinity; for (let s = 0; s <= BENCHMARK.maxScore; s += 1000) { const e = et(cls, s, 0.7); assert.ok(e <= last + 0.1, `${cls} ${s}: ${e} after ${last}`); last = e; slowest = Math.max(slowest, e); } assert.ok(slowest - last > 0.5, `${cls} spans ${slowest - last}`); }
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
  assert.equal(capScore(99999, 'integrated'), classScoreCap('integrated')); assert.ok(classScoreCap('integrated') < classScoreCap('discrete')); assert.equal(capScore(-5, 'integrated'), 0); assert.equal(capScore(NaN, 'integrated'), 0);
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
  const run = startBenchmark({ cls: 'discrete', beat: () => ({ pulse: 0, pulse2: 0, pulseHalf: 0, phase: 1, index: 0, intensity: 0, bass: 0, mid: 0, high: 0, on: false }), createWorkload: () => fake, now, sleep });
  const r = await run.done; assert.equal(r.status, 'done', JSON.stringify(r).slice(0, 300)); assert.equal(r.outcome.rates.length, BENCHMARK.passes); assert.ok(r.outcome.score > 0 && r.outcome.score <= classScoreCap('discrete'));
  const again = await startBenchmark({ cls: 'integrated', beat: () => ({}), createWorkload: () => ({ ...fake, run(d) { t += 5 * d; return d * 1e9; } }), now: () => t, sleep }).done; assert.equal(again.status, 'done');
  let t2 = 0; const c = startBenchmark({ cls: 'integrated', beat: () => ({}), createWorkload: () => fake, now: () => t2, sleep: async () => { t2 += 10; } }); c.cancel(); assert.equal((await c.done).status, 'cancelled');
  assert.equal((await startBenchmark({ cls: 'integrated', beat: () => ({}), createWorkload: () => null }).done).status, 'failed', 'no way to draw is reported, not thrown');
});

test('the show phase keeps the screen up until the song ends, is light, never changes the score, and Esc still delivers the score', async () => {
  const beat = () => ({ pulse: 0, pulse2: 0, pulseHalf: 0, phase: 1, index: 0, intensity: 0, bass: 0, mid: 0, high: 0, on: false });
  const make = () => {
    const state = { t: 0, runs: 0, draws: 0, lightened: 0 };
    const fake = { backend: 'webgl2', canvas: { remove() {} }, unitsPerDraw: 1e9, dispose() {}, run(draws) { state.runs++; state.t += 5 * draws; return draws * 1e9; }, lighten() { state.lightened++; }, draw() { state.draws++; } };
    return { state, fake, now: () => state.t, sleep: async () => { state.t += 10; } };
  };
  // no song: finishes right after the passes with no show phase
  const a = make(); const noSong = await startBenchmark({ cls: 'discrete', beat, createWorkload: () => a.fake, now: a.now, sleep: a.sleep, nextFrame: async () => { a.state.t += 16; } }).done;
  assert.equal(noSong.status, 'done'); assert.equal(a.state.draws, 0); assert.equal(a.state.lightened, 0);
  // a song that is 20 s long and starts at 0 when the passes end: the show runs about 20 s, one draw per frame, at most every SHOW.frameMs (every 2nd 16 ms frame here), no timed work
  const b = make(); let songStart = null; const texts = [];
  const song = () => { if (songStart === null) songStart = b.state.t; const time = (b.state.t - songStart) / 1000; return time >= 20 ? null : { time, duration: 20 }; };
  const runsBefore = (() => { const c = make(); return startBenchmark({ cls: 'discrete', beat, createWorkload: () => c.fake, now: c.now, sleep: c.sleep }).done.then(r => ({ r, runs: c.state.runs })); })();
  const withShow = await startBenchmark({ cls: 'discrete', beat, createWorkload: () => b.fake, now: b.now, sleep: b.sleep, nextFrame: async () => { b.state.t += 16; }, song, onStatus: t => texts.push(t) }).done;
  const without = await runsBefore;
  assert.equal(withShow.status, 'done'); assert.equal(withShow.outcome.score, without.r.outcome.score, 'the show phase does not change the score'); assert.equal(b.state.runs, without.runs, 'no timed work in the show phase');
  assert.equal(b.state.lightened, 1); assert.ok(b.state.draws >= 20000 / 32 - 3 && b.state.draws <= 20000 / 32 + 3, `draws ${b.state.draws}`);
  assert.ok(texts.some(t => /^SCORE LOCKED IN\. SONG 0:\d\d \/ 0:20\. ESC SKIPS TO THE RESULT$/.test(t)));
  // cancelling during the show still delivers the measured score
  const c = make(); let handle; let n = 0;
  handle = startBenchmark({ cls: 'discrete', beat, createWorkload: () => c.fake, now: c.now, sleep: c.sleep, nextFrame: async () => { c.state.t += 16; if (++n === 5) handle.cancel(); }, song: () => ({ time: 1, duration: 280 }) });
  const cancelled = await handle.done; assert.equal(cancelled.status, 'done'); assert.equal(cancelled.outcome.score, without.r.outcome.score); assert.ok(n >= 5 && n < 8, 'the show stops at once');
  // a stalled song (stuck at one time) is given up on after its length plus the grace
  const d = make(); const stuck = await startBenchmark({ cls: 'discrete', beat, createWorkload: () => d.fake, now: d.now, sleep: d.sleep, nextFrame: async () => { d.state.t += 100; }, song: () => ({ time: 3, duration: 10 }) }).done; assert.equal(stuck.status, 'done');
  // cancelling during the timed run still cancels
  const e = make(); let early; early = startBenchmark({ cls: 'discrete', beat, createWorkload: () => e.fake, now: e.now, sleep: async () => { e.state.t += 10; await 0; early.cancel(); }, song: () => ({ time: 1, duration: 280 }) }); assert.equal((await early.done).status, 'cancelled'); assert.equal(e.state.draws, 0);
});

test('the scored work is pinned: constants and the Julia shader do not change, so saved scores and the class calibration stay valid', () => {
  assert.deepEqual({ version: BENCHMARK.version, warmupMs: BENCHMARK.warmupMs, passes: BENCHMARK.passes, passMs: BENCHMARK.passMs, width: BENCHMARK.width, height: BENCHMARK.height, shaderIterations: BENCHMARK.shaderIterations, batchTargetMs: BENCHMARK.batchTargetMs, maxScore: BENCHMARK.maxScore }, { version: 2, warmupMs: 2000, passes: 5, passMs: 2000, width: 1280, height: 720, shaderIterations: 160, batchTargetMs: 30, maxScore: 10000 });
  assert.deepEqual(BENCHMARK.rate, { webgl2: { min: 3e10, max: 4e12 }, webgl1: { min: 3e10, max: 4e12 }, canvas2d: { min: 1e8, max: 1e10 } });
  const src = fragment(BENCHMARK.shaderIterations);
  assert.equal((src.match(/for \(int i = 0; i < 160; i\+\+\)/g) ?? []).length, 1, 'one loop of 160 iterations'); assert.ok(src.includes('acc / 160.0'));
  assert.equal(createHash('sha256').update(src).digest('hex'), '6311fbc3489480766266ea7088f8d07a0a7239b8cd080fd79b79b61f29148a20', 'the shader source changed: that changes the scored work (bump BENCHMARK.version and recalibrate, docs/CALIBRATION.md)');
});

// ---- detecting the class from real strings: always a class, never a pick ----
// [WebGL vendor, WebGL renderer, WebGPU adapter or null, the class]
const NV = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 (0x00002684) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const CARDS = [
  // the owner's AMD Radeon 8060S (Strix Halo, gfx1151) as Windows, Linux (Mesa, ANGLE) and WebGPU report it, and masked variants
  ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon(TM) 8060S Graphics (0x00001586) Direct3D11 vs_5_0 ps_5_0, D3D11)', null, 'integrated'],
  ['AMD', 'AMD Radeon Graphics (radeonsi, gfx1151, LLVM 20.1.2, DRM 3.64, 6.17.0)', null, 'integrated'],
  ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon Graphics (radeonsi, gfx1151, LLVM 20.1.2, DRM 3.64, 6.17.0), OpenGL 4.6)', { vendor: 'amd', architecture: 'rdna3.5', device: '', description: '' }, 'integrated'],
  ['', 'Radeon 8060S Graphics', null, 'integrated'], ['', 'Mesa', { vendor: 'amd', architecture: 'rdna3.5' }, 'integrated'], ['', 'Mesa', null, 'integrated'], ['', 'WebKit WebGL', null, 'integrated'],
  ['', '', { vendor: 'amd', architecture: 'rdna3.5', device: '0x1586', description: 'AMD Radeon 8060S' }, 'integrated'], ['', '', { vendor: 'amd', architecture: 'rdna-3' }, 'integrated'],
  ['', 'AMD Radeon 890M Graphics', null, 'integrated'], ['', 'AMD Radeon(TM) 780M', null, 'integrated'], ['', 'AMD Radeon(TM) Graphics', null, 'integrated'], ['', 'AMD Radeon(TM) Vega 8 Graphics', null, 'integrated'], ['', 'AMD Radeon RX Vega 11 Graphics', null, 'integrated'],
  // separate cards
  ['Google Inc. (NVIDIA)', NV, null, 'discrete'], ['', 'NVIDIA GeForce RTX 5090/PCIe/SSE2', null, 'discrete'], ['', '', { vendor: 'nvidia', architecture: 'ada-lovelace', description: 'NVIDIA GeForce RTX 4090' }, 'discrete'],
  ['', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)', null, 'discrete'], ['', 'NVIDIA GeForce GTX 1650', null, 'discrete'], ['', 'NVIDIA GeForce GTX 1060 6GB', null, 'discrete'], ['', 'NVIDIA GeForce GTX 480', null, 'discrete'],
  ['', 'AMD Radeon RX 7900 XTX (radeonsi, navi31, LLVM 19.1.0, DRM 3.59, 6.8.0)', null, 'discrete'], ['', 'ANGLE (AMD, AMD Radeon RX 9070 XT (0x00007550) Direct3D11, D3D11)', null, 'discrete'], ['', 'AMD Radeon Graphics (radeonsi, gfx1201, LLVM 20.1.2)', null, 'discrete'],
  ['', 'AMD Radeon RX 6800 XT', null, 'discrete'], ['', 'ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11, D3D11)', null, 'discrete'], ['', 'AMD Radeon RX Vega 64', null, 'discrete'],
  ['', 'ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)', null, 'discrete'], ['', 'ANGLE (Intel, Intel(R) Arc(TM) B580 Graphics (0x0000E20B) Direct3D11, D3D11)', null, 'discrete'], ['', '', { vendor: 'intel', architecture: 'xe-hpg', description: 'Intel(R) Arc(tm) A770 Graphics' }, 'discrete'],
  // built in, phones, Apple, software
  ['', 'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)', null, 'integrated'], ['', 'Mesa Intel(R) Arc(tm) Graphics (MTL)', null, 'integrated'], ['', 'Intel(R) Iris(R) Xe Graphics', null, 'integrated'], ['', '', { vendor: 'intel', architecture: 'xe-lpg' }, 'integrated'],
  ['', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)', null, 'integrated'], ['', 'Apple M2', null, 'integrated'], ['', 'Adreno (TM) 650', null, 'integrated'], ['', 'Mali-G78', null, 'integrated'],
  ['', 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', null, 'integrated'], ['', 'llvmpipe (LLVM 17.0.6, 256 bits)', null, 'integrated'], ['', '', { vendor: 'google', architecture: 'swiftshader', isFallbackAdapter: true }, 'integrated'],
  // unclear: the safe defaults
  ['', '', null, 'integrated'], ['', 'unknown', null, 'integrated'], ['', 'Some Brand GPU 9000', null, 'integrated'],
  ['', 'NVIDIA GeForce 8800 GTX', null, 'discrete'], ['', 'Moore Threads MTT S80', null, 'discrete'], ['', '', { vendor: 'nvidia' }, 'discrete'],
];
test('the class is detected from real renderer and adapter strings, whatever the browser calls the card', () => {
  for (const [vendor, renderer, adapter, want] of CARDS) assert.equal(identify({ webglVendor: vendor, webglRenderer: renderer, adapter }).gpuClass, want, `${vendor} | ${renderer} | ${JSON.stringify(adapter)}`);
  for (const [, renderer] of CARDS) assert.ok(CLASS_IDS.includes(classifyGpu(renderer)), 'every answer is a real class id');
});
test('the safe defaults: unclear is integrated, a separate card from an unknown maker or generation is discrete', () => {
  assert.equal(classifyGpu(''), 'integrated'); assert.equal(classifyGpu('WebKit WebGL'), 'integrated');
  assert.equal(classifyGpu('Moore Threads MTT S80'), 'discrete'); assert.equal(classifyGpu('NVIDIA GeForce 9800 GTX'), 'discrete');
  assert.equal(identify({ webglVendor: '', webglRenderer: 'Mesa', adapter: { vendor: 'amd', architecture: 'rdna-3' } }).gpuClass, 'integrated', 'RDNA 3 alone does not tell a 7900 from a 780M: built in');
});
test('WebGL and WebGPU: plain evidence beats a guess, a software WebGPU adapter does not veto a real WebGL card, WebGL wins ties', () => {
  assert.equal(identify({ webglVendor: '', webglRenderer: 'Mesa', adapter: { vendor: 'nvidia', architecture: 'ampere', description: 'NVIDIA GeForce RTX 3060' } }).gpuClass, 'discrete', 'WebGL masked: WebGPU names the card');
  assert.equal(identify({ webglVendor: '', webglRenderer: NV, adapter: { vendor: 'google', architecture: 'swiftshader', isFallbackAdapter: true } }).gpuClass, 'discrete');
  { const g = identify({ webglVendor: '', webglRenderer: NV, adapter: { vendor: 'intel', description: 'Intel(R) UHD Graphics 630' } }); assert.equal(g.masked, true, 'WebGL and WebGPU disagree strongly: unknown'); assert.equal(g.gpuClass, 'integrated', 'the safe default until measured'); }
  assert.equal(identify({ webglVendor: '', webglRenderer: 'SwiftShader', adapter: { vendor: 'nvidia', description: 'NVIDIA GeForce RTX 3060' } }).software, true);
  assert.equal(identify({ webglVendor: '', webglRenderer: 'x\u0000éy  z', adapter: null }).gpuId, 'xy z'); assert.equal(identify({ webglVendor: '', webglRenderer: '', adapter: null }).gpuId, 'unknown');
  assert.equal(identify({ webglVendor: '', webglRenderer: '', adapter: { description: 'Radeon' } }).source, 'webgpu'); assert.ok(identify({ webglVendor: '', webglRenderer: 'a'.repeat(500), adapter: null }).gpuId.length <= 200);
  assert.equal(identityFromText('NVIDIA GeForce RTX 3060', '').gpuClass, 'discrete');
});
test('the result screen and the console show what the game saw', () => {
  const g = identify({ webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon(TM) 8060S Graphics (0x00001586) Direct3D11, D3D11)', adapter: null }), line = gpuLine(g);
  assert.match(line, /8060S/); assert.match(line, /INTEGRATED/); assert.match(line, /built into the ryzen/);
  const page = readFileSync(new URL('../src/drag/page.ts', import.meta.url), 'utf8');
  assert.match(page, /MASKED_NOTE/, 'and the privacy note'); assert.match(page, /text: `\$\{gpuLine\(gpu, cls\)\}/, 'the BENCHMARK DONE screen shows it'); assert.match(page, /\[GPU Wars benchmark\][^\n]*gpuLine\(gpu, cls\)/, 'the console line shows it');
});

// ---- the class cannot be picked ----
test('there is no class pick: the CLASS row is read-only and the benchmark runs in the detected class', () => {
  const gpu = identify({ webglVendor: '', webglRenderer: 'ANGLE (AMD, AMD Radeon(TM) 8060S Graphics Direct3D11, D3D11)', adapter: null });
  let started = null, said = '', saved = emptySave();
  const ctx = { save: () => saved, gpu: () => gpu, say: t => { said = t; }, start: cls => { started = cls; }, refresh: () => {} };
  const row = classItem(ctx);
  assert.equal(row.left, undefined); assert.equal(row.right, undefined); assert.equal(row.enter, undefined, 'no ENTER-to-lock');
  assert.match(row.value(), /INTEGRATED/); assert.match(row.hint(), /cannot be picked/);
  benchmarkItem(ctx).enter(); assert.equal(started, 'integrated', 'the benchmark can only start in the detected class');
  started = null; const waiting = { ...ctx, gpu: () => PENDING_GPU }; benchmarkItem(waiting).enter(); assert.equal(started, null, 'it waits until the card has been read'); assert.match(said, /CHECKING/);
  const src = ['src/benchmark/menu.ts', 'src/benchmark/rules.ts', 'src/drag/page.ts', 'src/save.ts'].map(f => readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(src, /lockClass|stepClass|classLock\s*[:=(]|classPick|canChange|LOCKED/, 'no pick or lock code is left');
});
test('a strong integrated GPU (the 8060S) is raced as integrated near 10 s, and the same score is never a discrete car', () => {
  const ref = REFERENCE_CARDS.find(c => c.name === 'AMD Radeon 8060S');
  const gpu = identify({ webglVendor: 'Google Inc. (AMD)', webglRenderer: 'ANGLE (AMD, AMD Radeon Graphics (radeonsi, gfx1151, LLVM 20.1.2, DRM 3.64, 6.17.0), OpenGL 4.6)', adapter: { vendor: 'amd', architecture: 'rdna3.5' } });
  assert.equal(gpu.gpuClass, 'integrated');
  const score = Math.min(scoreFromRate(ref.rate, 'webgl2'), classScoreCap(gpu.gpuClass));
  const et = cls => { const { spec, tune } = readyCar({ ...emptySave(), benchmark: resultFromRun({ score, sustain: 1, cls, gpuId: gpu.gpuId, now: 1 }) }), st = rankedStart(); return predictDrag(spec, tune, RANKED.seed, RANKED.conditions, st.fuel, st.engineTemp, rankedStrip()).slip.quarter; };
  assert.ok(Math.abs(et(gpu.gpuClass) - (ref.targetEt ?? 10.3)) < 0.35, `integrated: ${et(gpu.gpuClass).toFixed(2)} s`);
  assert.ok(et('discrete') < 5, 'the same score in the discrete class would be a 4 to 5 s car, so the class must never be picked');
  // no UI path turns it discrete: the only class the benchmark is started with is the detected one, and a saved result of another class is dropped
  let started = null; benchmarkItem({ save: () => emptySave(), gpu: () => gpu, say() {}, start: c => { started = c; }, refresh() {} }).enter(); assert.equal(started, 'integrated');
  const stale = { ...emptySave(), benchmark: resultFromRun({ score, sustain: 1, cls: 'discrete', gpuId: gpu.gpuId, now: 1 }) };
  assert.equal(repairBenchmark(stale, gpu).benchmark, null, 'a result saved in a picked class is thrown away');
  assert.equal(readyCar(repairBenchmark(stale, gpu)).spec.torque, readyCar(emptySave()).spec.torque, 'and the car is stock again until the benchmark is re-run');
});

// ---- re-run and old saves ----
test('the benchmark is re-run only when the card, the benchmark version or the detected class changes', () => {
  const r = result(); assert.equal(rerunReason(null, r.gpuId), 'never run'); assert.equal(rerunReason(r, r.gpuId), null); assert.equal(needsBenchmark(r, { gpuId: r.gpuId, gpuClass: r.class }), false);
  assert.equal(rerunReason(r, 'another card'), 'new graphics card'); assert.equal(rerunReason(r, r.gpuId, BENCHMARK.version + 1), 'new benchmark version'); assert.equal(rerunReason({ ...r, date: 5, score: 1 }, r.gpuId), null, 'age and score do not matter');
  assert.equal(rerunReason(r, r.gpuId, BENCHMARK.version, 'integrated'), 'class changed'); assert.equal(rerunReason(r, r.gpuId, BENCHMARK.version, r.class), null);
});
test('an old save is repaired: its classLock is dropped and a result in another class is removed, a matching result stays', () => {
  const old = sanitizeSave({ version: 1, classLock: { class: 'discrete', gpuId: 'g', date: 5 }, benchmark: result({ class: 'discrete', gpuId: 'g' }), tune: { final: 3.5 } });
  assert.equal('classLock' in old, false); assert.equal(old.version, 2); assert.equal(old.tune.final, 3.5, 'the tune is kept');
  assert.equal(repairBenchmark(old, { gpuClass: 'integrated', ready: true }).benchmark, null);
  assert.equal(repairBenchmark(old, { gpuClass: 'discrete', ready: true }), null, 'nothing to repair when the class matches');
  assert.equal(repairBenchmark(old, { gpuClass: 'integrated', ready: false }), null, 'nothing is judged before the card has been read');
  assert.equal(repairBenchmark(emptySave(), { gpuClass: 'integrated', ready: true }), null);
});

// ---- the save ----
test('the saved benchmark is checked, and the result has the agreed fields', () => {
  const run = resultFromRun({ score: 4321, sustain: 2, cls: 'integrated', gpuId: 'g', now: 99.9 });
  assert.deepEqual(Object.keys(run).sort(), ['benchmarkVersion', 'class', 'date', 'gpuId', 'score', 'sustain']); assert.equal(run.sustain, 1); assert.equal(run.date, 99);
  assert.deepEqual(sanitizeSave({ benchmark: run }).benchmark, run);
  for (const bad of [{ ...run, class: 'integrated; DROP' }, { ...run, gpuId: '\u0001' }, { ...run, score: 'x' }, { ...run, score: -1 }, null, 3, []]) assert.equal(cleanBenchmark(bad), null);
  assert.equal(cleanBenchmark({ ...run, score: 1e9 }).score, BENCHMARK.maxScore, 'an impossible stored score is capped'); assert.equal(cleanBenchmark({ ...run, sustain: 'x' }).sustain, undefined); assert.equal(cleanBenchmark({ ...run, gpuId: 'é' + 'g'.repeat(400) }).gpuId.length, 200);
  assert.equal('classLock' in emptySave(), false); assert.equal('classLock' in sanitizeSave({ classLock: { class: 'integrated', gpuId: 'g', date: 1 } }), false);
});
test('a save from the 17-class build (class "discrete-nvidia-classic") is read as "class changed": the result is kept, then removed so the benchmark is re-run in the detected class', () => {
  const old = sanitizeSave({ version: 2, benchmark: result({ class: 'discrete-nvidia-classic', gpuId: 'NVIDIA GeForce GTX 1060', score: 4100 }), tune: { final: 3.5 } });
  assert.equal(old.benchmark.class, 'discrete-nvidia-classic', 'the old class id survives loading, so it can be told apart from a save with no result');
  assert.equal(rerunReason(old.benchmark, 'NVIDIA GeForce GTX 1060', BENCHMARK.version, 'discrete'), 'class changed');
  assert.equal(needsBenchmark(old.benchmark, { gpuId: 'NVIDIA GeForce GTX 1060', gpuClass: 'discrete' }), true);
  assert.equal(specForBenchmark(old.benchmark).torque, specForBenchmark(null).torque, 'an unknown class never gives a faster car than no result');
  const fixed = repairBenchmark(old, { gpuClass: 'discrete', ready: true });
  assert.equal(fixed.benchmark, null, 'the benchmark is asked for again'); assert.equal(fixed.tune.final, 3.5, 'the tune is kept');
  assert.equal(sanitizeSave({ benchmark: result({ class: 'integrated; DROP' }) }).benchmark, null);
});
test('a tune saved for a stronger engine is brought inside a weaker one', () => {
  const weak = specForBenchmark(result({ class: 'integrated', score: 0 })), tune = cleanTune({ shiftRpm: 9300, launchRpm: 9000 }, { ...STOCK_CAR, redline: weak.redline, peakRpm: weak.peakRpm }, weak);
  assert.ok(tune.shiftRpm <= weak.redline && tune.launchRpm <= weak.redline);
});

// ---- masked (placeholder) renderer names ----
const R9 = 'AMD Radeon R9 200 Series, or similar';
const MASKED = [
  ['Google Inc. (AMD)', R9], ['', R9], ['', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), or similar'], ['', 'Apple M1, or similar'], ['', 'Intel(R) HD Graphics, or similar'],
  ['Mozilla', 'Mozilla'], ['', 'Generic Renderer'], ['', 'ANGLE (Google, Vulkan 1.3.0 (Mesa), Mesa driver)'], ['', 'Intel(R) HD Graphics'], ['', 'NVIDIA GeForce GTX 980'], ['', 'AMD Radeon R9 200 Series'], ['', 'NVIDIA GeForce GTX 1050'],
];
const REF = REFERENCE_CARDS.find(c => c.name === MASKED_GPU_RULE.referenceCard);
test('masked placeholder names are UNKNOWN: integrated before the benchmark, flagged, and the string is still shown', () => {
  for (const [v, r] of MASKED) {
    const g = identify({ webglVendor: v, webglRenderer: r, adapter: null });
    assert.equal(g.masked, true, r); assert.equal(g.gpuClass, 'integrated', r); assert.match(gpuLine(g), /HIDING THE REAL GPU NAME/); assert.ok(gpuLine(g).includes(r.slice(0, 40)), 'the seen string is shown');
  }
  assert.match(MASKED_NOTE, /CLASS SET FROM MEASURED SPEED/);
  const owner = identify({ webglVendor: '', webglRenderer: R9, adapter: null }); assert.equal(owner.gpuClass, 'integrated');
});
test('real names (and bare fixed names confirmed by WebGPU) are not masked and classify as before', () => {
  for (const [v, r, a, want] of CARDS) { const g = identify({ webglVendor: v, webglRenderer: r, adapter: a }); if (/similar|mozilla|generic/i.test(r)) continue; assert.equal(g.gpuClass, want, r); }
  assert.equal(identify({ webglVendor: '', webglRenderer: 'NVIDIA GeForce RTX 3060', adapter: null }).masked, false);
  assert.equal(identify({ webglVendor: '', webglRenderer: 'AMD Radeon RX 7800 XT', adapter: null }).gpuClass, 'discrete');
  assert.equal(identify({ webglVendor: '', webglRenderer: 'AMD Radeon(TM) 8060S Graphics', adapter: null }).masked, false);
  assert.equal(identify({ webglVendor: '', webglRenderer: 'Intel(R) HD Graphics 530', adapter: null }).masked, false);
  const real980 = identify({ webglVendor: '', webglRenderer: 'NVIDIA GeForce GTX 980', adapter: { vendor: 'nvidia', description: 'NVIDIA GeForce GTX 980' } });
  assert.equal(real980.masked, false); assert.equal(real980.gpuClass, 'discrete', 'WebGPU confirms a real 980');
  assert.equal(maskedReason('SwiftShader, or similar'), '', 'software is handled apart');
});
test('the masked-card rule: the 8060S reference rate is integrated, far above it is discrete, one named constants object', () => {
  assert.equal(REF.source, 'measured'); assert.equal(MASKED_GPU_RULE.margin >= 1.5, true);
  assert.equal(maskedDiscreteRate(), REF.rate * MASKED_GPU_RULE.margin);
  assert.equal(classForMaskedRate(REF.rate), 'integrated'); assert.equal(classForMaskedRate(REF.rate * 1.9), 'integrated'); assert.equal(classForMaskedRate(maskedDiscreteRate()), 'integrated', 'at the line: still integrated');
  assert.equal(classForMaskedRate(REF.rate * 4), 'discrete'); assert.equal(classForMaskedRate(4e12), 'discrete');
  assert.equal(classForMaskedRate(NaN), 'integrated'); assert.equal(classForMaskedRate(1e13, 'canvas2d'), 'integrated');
  assert.ok(maskedDiscreteMinScore() < classScoreCap('integrated'), 'the line sits under the integrated cap');
});
test('a masked run decides its class from the measured speed, and a score above a class cap is never saved in it', () => {
  const passes = rate => Array.from({ length: BENCHMARK.passes }, () => ({ rate, wallMs: BENCHMARK.passMs }));
  const run = rate => outcomeFromPasses(passes(rate), 20000, false, 'webgl2', 'integrated', true);
  const at = run(REF.rate), far = run(REF.rate * 6);
  assert.equal(at.cls, 'integrated'); assert.equal(at.classFromSpeed, true); assert.equal(at.score, 5005);
  assert.equal(far.cls, 'discrete'); assert.ok(far.score > classScoreCap('integrated'), 'a discrete score may pass the integrated cap');
  // an unmasked card keeps the class it was given and is capped by it
  const strongIntegrated = outcomeFromPasses(passes(4e12), 20000, false, 'webgl2', 'integrated', false);
  assert.equal(strongIntegrated.cls, 'integrated'); assert.equal(strongIntegrated.score, classScoreCap('integrated')); assert.equal(strongIntegrated.classFromSpeed, false);
  // whatever reaches the save is capped
  assert.equal(resultFromRun({ score: 10000, sustain: 1, cls: 'integrated', gpuId: 'x', now: 1 }).score, classScoreCap('integrated'));
  const masked = identify({ webglVendor: '', webglRenderer: R9, adapter: null });
  assert.equal(far.score <= classScoreCap(far.cls), true);
  const saved = resultFromRun({ score: far.score, sustain: 1, cls: far.cls, gpuId: masked.gpuId, now: 1, classFromSpeed: far.classFromSpeed });
  assert.equal(saved.class, 'discrete'); assert.equal(saved.classFromSpeed, true); assert.equal(cleanBenchmark(saved).classFromSpeed, true);
});
test('a masked result does not loop or flip-flop the class-changed re-run, and cannot claim a faster class than its score', () => {
  const g = identify({ webglVendor: '', webglRenderer: R9, adapter: null });
  for (const cls of ['integrated', 'discrete']) {
    const score = cls === 'discrete' ? 8000 : 5005, r = resultFromRun({ score, sustain: 1, cls, gpuId: g.gpuId, now: 1, classFromSpeed: true });
    assert.equal(rerunReason(r, g.gpuId, BENCHMARK.version, g.gpuClass, g.masked), null, cls + ': no re-run');
    assert.equal(needsBenchmark(r, g), false); assert.equal(repairBenchmark({ ...emptySave(), benchmark: r }, g), null, cls + ': kept');
  }
  // the same saved class from speed is NOT trusted for a card that is not masked (the plain comparison applies)
  const r = resultFromRun({ score: 8000, sustain: 1, cls: 'discrete', gpuId: 'x', now: 1, classFromSpeed: true });
  assert.equal(rerunReason(r, 'x', BENCHMARK.version, 'integrated', false), 'class changed');
  // an edited save: discrete with a score below the masked line, an over-cap integrated score, or a made-up class is dropped
  for (const bad of [{ class: 'discrete', score: 3000 }, { class: 'integrated', score: 9000 }, { class: 'weird', score: 100 }]) {
    assert.equal(repairBenchmark({ ...emptySave(), benchmark: { ...r, classFromSpeed: true, ...bad } }, g).benchmark, null, JSON.stringify(bad));
  }
  assert.equal(repairBenchmark({ ...emptySave(), benchmark: { ...r, class: 'discrete' } }, { ...g, masked: false, gpuClass: 'integrated' }).benchmark, null);
});
