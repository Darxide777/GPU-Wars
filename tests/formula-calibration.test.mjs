// FORMULA CALIBRATION (phase 3): the lap time each class and benchmark score gives, the way tests/calibration.test.mjs does it for Drag's quarter mile.
// Every lap here is the autopilot's lap on BEACH, standing start, from the green (the perfect-driver prediction; docs/CALIBRATION.md, "Formula lap times").
// `PRINT_LAP_TABLE=1 node --test tests/formula-calibration.test.mjs` prints the table for the docs and for the backend's FORMULA_LAP_TABLE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { driveAutopilotLap, formulaSpecForBenchmark, FORMULA_CLASS_WINDOWS, FORMULA_TUNE_LIMITS, STOCK_SPEC, UNBENCHMARKED_ENGINE, engineShareFor, FORMULA_SCORE_TO_ENGINE, DEFAULT_FORMULA_TUNE } from '../src/formula/index.ts';
import { CLASS_IDS } from '../src/classes.ts';
import { classScoreCap } from '../src/benchmark/score.ts';
import { REFERENCE_CARDS } from '../src/benchmark/reference.ts';
import { FORMULA_FALLBACK_LEADERS, fallbackFormulaLeader } from '../src/leaderboard/formula-leader.ts';
import { loadBackend } from './helpers/load-backend.mjs';

const { plausible: { FORMULA_LAP_TABLE, formulaWindow, formulaCurveAt, formulaImplausibleReason }, classes: { CLASS_SCORE_CAP }, validate: { validateSubmission } } = await loadBackend();

/** THE TARGET LAPS (s, default tune, perfect driver, BEACH): the owner's numbers. Change one, solve the engine again (`engineForLap` below), rewrite the row of FORMULA_SCORE_TO_ENGINE and the backend table. */
const TARGETS = [
  { name: 'best discrete card (score 10000)', cls: 'discrete', score: 10000, lap: 38 },
  { name: 'Radeon 8060S, strong iGPU (measured score 5005)', cls: 'integrated', score: 5005, lap: 47 },
  { name: 'S24 Ultra, phone (measured score 1302)', cls: 'integrated', score: 1302, lap: 51 },
  { name: 'weakest integrated card (score 0)', cls: 'integrated', score: 0, lap: 55 },
  { name: 'no benchmark', cls: null, score: 0, lap: 58 },
];
/** how far a lap may be from its target: the lap is a simulation, not a table lookup, so a little room; the table's own rows land within 0.1 s */
const TARGET_TOLERANCE = 0.3;
const GOOD_TUNE = { gearing: 0.4, downforce: 0.3, pressure: 0.4, steering: 0, nitro: 2 };

const bench = (cls, score) => (cls ? { score, class: cls, benchmarkVersion: 1, gpuId: 'calibration', date: 0 } : null);
const cache = new Map();
const slipOf = (cls, score, tune = {}) => {
  const key = JSON.stringify([cls, score, tune]); if (!cache.has(key)) cache.set(key, driveAutopilotLap({ spec: formulaSpecForBenchmark(bench(cls, score)), tune }).timeslip());
  return cache.get(key);
};
const lapOf = (cls, score, tune) => slipOf(cls, score, tune).lapTime;
const mphOf = (cls, score, tune) => slipOf(cls, score, tune).topSpeed * 0.621371;
const sweep = cls => { const cap = classScoreCap(cls), step = cls === 'integrated' ? 500 : 1000, out = []; for (let s = 0; s < cap; s += step) out.push(s); out.push(cap, ...(cls === 'integrated' ? [1302, 5005] : [])); return out.sort((a, b) => a - b); };

/** the engine level that gives a default-tune lap (bisection: a stronger engine is always a quicker lap) */
function engineForLap(target) {
  let lo = -8, hi = 14;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2, lap = driveAutopilotLap({ spec: { ...STOCK_SPEC, engine: mid }, tune: {} }).timeslip().lapTime; if (lap > target) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

if (process.env.PRINT_LAP_TABLE) {
  console.log('class | score | engine | lap, default tune | top mph | lap, good tune | good tune gain');
  for (const cls of CLASS_IDS) for (const s of sweep(cls)) { const d = lapOf(cls, s), g = lapOf(cls, s, GOOD_TUNE); console.log(`${cls} | ${s} | ${formulaSpecForBenchmark(bench(cls, s)).engine} | ${d.toFixed(2)} | ${mphOf(cls, s).toFixed(0)} | ${g.toFixed(2)} | ${((d - g) / d * 100).toFixed(1)}%`); }
  console.log(`no benchmark | - | ${UNBENCHMARKED_ENGINE} | ${lapOf(null, 0).toFixed(2)} | ${mphOf(null, 0).toFixed(0)} | ${lapOf(null, 0, GOOD_TUNE).toFixed(2)}`);
}

test('THE TARGET TABLE: every named card lands on its lap time with the default tune', () => {
  for (const t of TARGETS) { const lap = lapOf(t.cls, t.score); assert.ok(Math.abs(lap - t.lap) <= TARGET_TOLERANCE, `${t.name}: ${lap.toFixed(2)} s, target ${t.lap} s`); }
});

test('the real cards: the measured score of the 8060S and the S24 Ultra are the ones the table is solved for', () => {
  const rows = TARGETS.filter(t => t.cls === 'integrated' && t.score > 0);
  assert.deepEqual(rows.map(t => t.score).sort((a, b) => a - b), [1302, 5005]);
  assert.ok(REFERENCE_CARDS.some(c => c.name.includes('8060S') && c.source === 'measured') && REFERENCE_CARDS.some(c => c.name.includes('S24') && c.source === 'measured'));
});

test('the class windows and the engine curve are what the target laps solve to (so the table was not hand-nudged)', () => {
  const near = (a, b, what) => assert.ok(Math.abs(a - b) < 0.01, `${what}: ${a} vs solved ${b.toFixed(4)}`);
  near(FORMULA_CLASS_WINDOWS.integrated.engine[0], engineForLap(55), 'integrated, score 0');
  near(FORMULA_CLASS_WINDOWS.integrated.engine[1], engineForLap(44.5), 'integrated, class cap');
  near(FORMULA_CLASS_WINDOWS.discrete.engine[0], engineForLap(43), 'discrete, score 0');
  near(UNBENCHMARKED_ENGINE, engineForLap(58), 'no benchmark');
  assert.equal(FORMULA_CLASS_WINDOWS.discrete.engine[1], STOCK_SPEC.engine, 'the best card has the source game\'s top engine');
});

test('monotonic: a higher score is never a slower lap, across the whole score range of both classes', () => {
  for (const cls of CLASS_IDS) {
    const cap = classScoreCap(cls); let lastEngine = -Infinity, lastLap = Infinity;
    for (let s = 0; s <= cap; s += 50) { const e = formulaSpecForBenchmark(bench(cls, s)).engine; assert.ok(e >= lastEngine, `${cls} ${s}: engine fell`); lastEngine = e; }
    for (let s = 0; s <= cap; s += 250) { const lap = lapOf(cls, s); assert.ok(lap <= lastLap + 1e-9, `${cls} ${s}: ${lap} after ${lastLap}`); lastLap = lap; }
    const rows = FORMULA_SCORE_TO_ENGINE[cls]; for (let i = 1; i < rows.length; i++) assert.ok(rows[i].share > rows[i - 1].share && rows[i].engineShare > rows[i - 1].engineShare, `${cls} row ${i}`);
    assert.equal(rows[0].engineShare, 0); assert.equal(rows[rows.length - 1].engineShare, 1); assert.equal(engineShareFor(cls, 2), 1); assert.equal(engineShareFor(cls, -1), 0);
  }
});

test('the classes: the discrete class is faster than the integrated class at every score of the weakest card (as in Drag), no benchmark is the slowest of all, a score above the class cap is capped', () => {
  assert.ok(lapOf('integrated', 8000) > lapOf('discrete', 0) + 1, `best integrated ${lapOf('integrated', 8000)} vs weakest discrete ${lapOf('discrete', 0)}`);
  for (const cls of CLASS_IDS) for (const s of sweep(cls)) assert.ok(lapOf(null, 0) > lapOf(cls, s) + 1, `no benchmark ${lapOf(null, 0)} vs ${cls} ${s}: ${lapOf(cls, s)}`);
  assert.ok(lapOf(null, 0, GOOD_TUNE) > lapOf('integrated', 0, GOOD_TUNE), 'also with a good tune');
  assert.equal(lapOf('discrete', 1e9), lapOf('discrete', 10000)); assert.equal(lapOf('integrated', 1e9), lapOf('integrated', 8000));
  assert.ok(lapOf('integrated', 0) / lapOf('discrete', 10000) > 1.4, 'the class gap is large, like Drag\'s (best discrete about 1.45 times quicker than the weakest integrated card)');
  assert.ok(lapOf(null, 0) / lapOf('discrete', 10000) > 1.5);
});

test('the discrete window spreads cards: every 1000 points is worth at least 0.1 s, and 0.6 s at the bottom (steep at the low end, flat at the top, like Drag)', () => {
  for (let s = 0; s < 10000; s += 1000) assert.ok(lapOf('discrete', s) - lapOf('discrete', s + 1000) >= (s < 3000 ? 0.6 : 0.1), `discrete ${s}->${s + 1000}: ${(lapOf('discrete', s) - lapOf('discrete', s + 1000)).toFixed(2)} s`);
});

test('TUNE BALANCE: a good tune is worth about 1 to 4 percent of the lap at every score, and the default tune is a sensible near-optimum', () => {
  const cards = [['integrated', 0], ['integrated', 1302], ['integrated', 5005], ['integrated', 8000], ['discrete', 0], ['discrete', 5000], ['discrete', 10000], [null, 0]];
  for (const [cls, s] of cards) {
    const d = lapOf(cls, s), g = lapOf(cls, s, GOOD_TUNE), gain = (d - g) / d * 100;
    assert.ok(gain >= 1 && gain <= 4, `${cls} ${s}: a good tune gains ${gain.toFixed(1)} percent (${d.toFixed(2)} to ${g.toFixed(2)} s)`);
  }
});

test('TUNE BALANCE: no single extreme setting wins; each trade has its best value inside the range; a search of the whole tune box gains under 4.5 percent', () => {
  for (const [cls, s] of [['integrated', 0], ['integrated', 5005], ['discrete', 10000]]) {
    const d = lapOf(cls, s);
    // every setting pushed alone to either end of its range is no better than 1 percent under the default (2.5 percent for downforce: on a plain oval you can run flat out, a weak car needs almost none; the best car still needs it) (the source game had tall gears at 7 percent and hard tyres at 3 percent better)
    for (const [key, [lo, hi]] of Object.entries(FORMULA_TUNE_LIMITS)) {
      if (key === 'shiftLight') continue;
      for (const v of [lo, hi]) { if (v === DEFAULT_FORMULA_TUNE[key]) continue; const lap = lapOf(cls, s, { [key]: v }); assert.ok(lap >= d * (key === 'downforce' ? 0.975 : 0.99), `${cls} ${s}: ${key} ${v} gives ${lap.toFixed(2)} s against the default ${d.toFixed(2)} s`); }
    }
    // gearing and pressure: the best value is inside the range (the curve), so both ends lose to the middle
    for (const key of ['gearing', 'pressure']) { const mid = lapOf(cls, s, { [key]: 0.4 }), ends = [-1, 1].map(v => lapOf(cls, s, { [key]: v })); assert.ok(mid < d && ends.every(e => e > mid + 0.2), `${cls} ${s}: ${key} ends ${ends.map(e => e.toFixed(2))} vs inside ${mid.toFixed(2)}`); }
    // a coordinate search from the good tune over the whole box: the best a player can find
    let cur = { ...GOOD_TUNE }, best = lapOf(cls, s, cur);
    for (let pass = 0; pass < 2; pass++) for (const key of ['gearing', 'downforce', 'pressure', 'steering']) for (const dv of [-0.2, 0.2]) {
      const [lo, hi] = FORMULA_TUNE_LIMITS[key], next = { ...cur, [key]: Math.round((cur[key] + dv) * 10) / 10 }; if (next[key] < lo || next[key] > hi) continue;
      const lap = lapOf(cls, s, next); if (lap < best - 0.005) { best = lap; cur = next; }
    }
    assert.ok((d - best) / d < 0.045 && (d - best) / d > 0.01, `${cls} ${s}: the best tune found gains ${((d - best) / d * 100).toFixed(1)} percent`);
  }
});

test('FALLBACK LEADERS: a default tune on the best card of the class only just fails to beat the leader, a good tune beats it, in both categories', () => {
  for (const cls of CLASS_IDS) {
    const cap = classScoreCap(cls), def = lapOf(cls, cap), good = lapOf(cls, cap, GOOD_TUNE);
    for (const category of ['manual', 'autopilot']) {
      const leader = fallbackFormulaLeader(cls, category).timeS;
      assert.ok(def > leader && def - leader < 0.2, `${cls} ${category}: the default tune ${def.toFixed(2)} s should only just miss the leader ${leader} s`);
      assert.ok(good < leader - 0.3, `${cls} ${category}: a good tune ${good.toFixed(2)} s should beat the leader ${leader} s`);
    }
    // a weak card of the class cannot take the leader's place
    assert.ok(lapOf(cls, 0, GOOD_TUNE) > fallbackFormulaLeader(cls).timeS + 3, cls);
    assert.ok(fallbackFormulaLeader(cls, 'autopilot').timeS >= fallbackFormulaLeader(cls).timeS);
  }
  assert.ok(fallbackFormulaLeader('discrete').timeS < fallbackFormulaLeader('integrated').timeS);
  // the leaders are accepted by the backend as laps of the best card (the sectors and top speed are made up from the lap)
  for (const cls of CLASS_IDS) for (const category of ['manual', 'autopilot']) {
    const l = fallbackFormulaLeader(cls, category), out = validateSubmission({ mode: 'formula', playerName: 'Leader One', class: cls, category, benchmarkScore: CLASS_SCORE_CAP[cls], benchmarkVersion: '1', gpuId: 'x', splits: l.sectors, topSpeed: l.topSpeed, seed: l.seed, tune: {} });
    assert.equal(out.ok, true, `${cls} ${category}: ${out.error}`);
  }
  assert.ok(FORMULA_FALLBACK_LEADERS.topSpeedMph.integrated > 243 && FORMULA_FALLBACK_LEADERS.topSpeedMph.discrete > 284, 'above the average speed of each leader lap');
});

test('BACKEND WINDOWS: the table is the sim (default tune within 0.12 s and 3 mph at a dense sweep of scores) and is flagged calibrated but not validated on real hardware', () => {
  assert.equal(FORMULA_LAP_TABLE.calibrated, true); assert.equal(FORMULA_LAP_TABLE.hardwareValidated, false, 'the owner\'s 8060S and S24 Ultra have not raced these laps yet');
  assert.equal('placeholder' in FORMULA_LAP_TABLE, false);
  for (const cls of CLASS_IDS) {
    const cap = classScoreCap(cls), step = cls === 'integrated' ? 400 : 500;
    for (let s = 0; s <= cap; s += step) { const c = formulaCurveAt(cls, s); assert.ok(Math.abs(c.lap - lapOf(cls, s)) < 0.12, `${cls} ${s}: table ${c.lap.toFixed(2)} sim ${lapOf(cls, s).toFixed(2)}`); assert.ok(Math.abs(c.top - mphOf(cls, s)) < 3, `${cls} ${s}: table ${c.top.toFixed(0)} mph, sim ${mphOf(cls, s).toFixed(0)}`); }
  }
});

test('BACKEND WINDOWS: the default tune, a good tune and the extreme tunes of every score in a dense sweep land inside the window, with the sectors, the top speed and the average speed', () => {
  const tunes = {
    default: {}, good: GOOD_TUNE, auto: { ...GOOD_TUNE, gearbox: 'auto' },
    // the best a search finds, the fastest top speed a tune can make, and the slowest tunes
    searched: { gearing: 0.4, downforce: 0.2, pressure: 0.4, steering: 0.5, nitro: 2 }, topSpeed: { gearing: 1, downforce: 0, pressure: 1, steering: 1, nitro: 3 }, wing: { gearing: -1, downforce: 1, pressure: -1, steering: -1, nitro: 0 },
  };
  for (const cls of CLASS_IDS) for (const s of sweep(cls)) {
    const w = formulaWindow(cls, s);
    for (const [name, tune] of Object.entries(tunes)) {
      const slip = slipOf(cls, s, tune), mph = slip.topSpeed * 0.621371, at = `${cls} score ${s} ${name} tune`;
      assert.ok(slip.lapTime >= w.minLapS && slip.lapTime <= w.maxLapS, `${at}: lap ${slip.lapTime.toFixed(2)} outside ${w.minLapS.toFixed(2)}-${w.maxLapS.toFixed(2)}`);
      assert.ok(mph >= w.minTopMph && mph <= w.maxTopMph, `${at}: top ${mph.toFixed(0)} outside ${w.minTopMph.toFixed(0)}-${w.maxTopMph.toFixed(0)}`);
      assert.equal(formulaImplausibleReason(cls, s, 'beach', { sector1: slip.splits[1], sector2: slip.splits[4], lap: slip.lapTime, topSpeed: mph }), null, at);
    }
    // not loose: the fast edge is within 8 percent of the default lap (the outer class limit may only tighten it)
    assert.ok(w.minLapS >= lapOf(cls, s) * 0.92 - 1e-9, `${cls} ${s}: the fast edge ${w.minLapS.toFixed(2)} is loose`);
  }
});

test('BACKEND WINDOWS: a weak card cannot post a strong card\'s lap, a lap beyond what the best tune of the class can do is refused, and the slow side stays open', () => {
  const refused = (cls, score, lap) => formulaImplausibleReason(cls, score, 'beach', { sector1: lap * 0.29, sector2: lap * 0.717, lap, topSpeed: 4828 / lap * 2.236936 + 3 }) !== null;
  // the weakest card, the phone, and a strong iGPU cannot post the default laps of the cards above them
  assert.ok(refused('integrated', 0, lapOf('integrated', 5005)), 'score 0 posting the 8060S\'s lap');
  assert.ok(refused('integrated', 0, lapOf('integrated', 1302) - 0.5), 'score 0 posting the S24\'s lap');
  assert.ok(refused('integrated', 1302, lapOf('integrated', 5005)), 'the S24 posting the 8060S\'s lap');
  assert.ok(refused('integrated', 5005, lapOf('integrated', 8000) - 2.5), '8060S posting well beyond the best integrated card');
  assert.ok(refused('discrete', 0, lapOf('discrete', 10000)), 'the weakest discrete card posting the best card\'s lap');
  assert.ok(refused('discrete', 2000, lapOf('discrete', 10000)), 'a score-2000 discrete card posting the best card\'s lap');
  assert.ok(refused('discrete', 10000, 34), 'nobody posts 34 s');
  assert.ok(refused('integrated', 8000, 40), 'nobody in the integrated class posts 40 s');
  // a lap faster than the best tune of the card (beyond 7 percent under the default) is refused at every score
  for (const cls of CLASS_IDS) for (const s of sweep(cls)) { const lap = lapOf(cls, s) * 0.9; assert.ok(refused(cls, s, lap), `${cls} ${s}: ${lap.toFixed(2)} s`); }
  // the owner's own cards: the strong iGPU with a good tune, and the slowest honest drive
  assert.equal(refused('integrated', 5005, lapOf('integrated', 5005, GOOD_TUNE)), false); assert.equal(refused('integrated', 1302, lapOf('integrated', 1302) + 8), false);
  // the autopilot is the calibration's own driver: its default-tune laps are the curve itself, so the autopilot category needs no extra allowance on the fast side, and a clumsy lap is allowed on the slow side
  assert.equal(refused('discrete', 10000, lapOf('discrete', 10000)), false);
  // the unbenchmarked car (58 s) does not rank: it has no score; its lap would still be plausible for the weakest card's window
  assert.ok(lapOf(null, 0) <= formulaWindow('integrated', 0).maxLapS);
});
