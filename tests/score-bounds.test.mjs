// The server's score-aware plausibility window (backend/src/plausible.ts) against the game's physics. For a dense sweep of scores in each class, the perfect-driver
// ET of the default tune AND of a good tune (and their trap speed, 60 ft and 1/8 mile) must fall inside the window, so the lookup table cannot drift from the physics unnoticed.
// If this fails after a physics change, copy the new default-tune rows into SCORE_CURVE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrag, predictDrag } from '../src/drag/physics.ts';
import { readyCar } from '../src/drag/model.ts';
import { emptySave } from '../src/save.ts';
import { cleanTune } from '../src/drag/tune.ts';
import { CLASS_IDS } from '../src/classes.ts';
import { BENCHMARK } from '../src/benchmark/constants.ts';
import { classScoreCap } from '../src/benchmark/score.ts';
import { RANKED, rankedStart, rankedStrip } from '../src/leaderboard/ranked.ts';
import { loadBackend } from './helpers/load-backend.mjs';

const { plausible: { plausibleWindow, implausibleReason, PLAUSIBLE_TOLERANCE }, classes: { CLASS_SCORE_CAP, CLASS_BOUNDS }, validate: { validateSubmission } } = await loadBackend();

const card = (cls, score, over = null) => {
  const { car, spec, tune } = readyCar({ ...emptySave(), benchmark: { score, class: cls, benchmarkVersion: BENCHMARK.version, gpuId: 'bounds', date: 1 } });
  const t = over ? cleanTune({ ...tune, ...over(spec, tune) }, car, spec) : tune, st = rankedStart();
  const s = predictDrag(spec, t, RANKED.seed, RANKED.conditions, st.fuel, st.engineTemp, rankedStrip()).slip;
  return { quarter: s.quarter, ft60: s.ft60, eighth: s.eighth, trapSpeed: s.trap / 1.609344, foul: s.foul };
};
const goodTune = (cls, score) => {
  let best = card(cls, score);
  for (const dfin of [-0.3, 0, 0.3, 0.6]) for (const lr of [0.7, 0.9, 1.0]) for (const ag of [7, 9]) {
    const c = card(cls, score, (spec, tune) => ({ final: tune.final + dfin, launchRpm: Math.round(spec.peakRpm * lr / 100) * 100, launchAggression: ag }));
    if (c.quarter < best.quarter && !c.foul) best = c;
  }
  return best;
};

test('the backend score caps equal the game class caps', () => {
  for (const cls of CLASS_IDS) assert.equal(CLASS_SCORE_CAP[cls], classScoreCap(cls), cls);
});

test('physics ETs of the default tune and a good tune fall inside the backend window across a dense sweep of scores', () => {
  for (const cls of CLASS_IDS) {
    const cap = classScoreCap(cls), step = cap / 40; // 41 scores per class, off the table's own knots too
    for (let i = 0; i <= 40; i++) {
      const score = Math.round(step * i), w = plausibleWindow(cls, score);
      for (const [name, run] of [['default', card(cls, score)], ['good', goodTune(cls, score)]]) {
        const at = `${cls} score ${score} ${name} tune`;
        assert.ok(run.quarter >= w.minEt && run.quarter <= w.maxEt, `${at}: ET ${run.quarter.toFixed(3)} outside ${w.minEt.toFixed(2)}-${w.maxEt.toFixed(2)}`);
        assert.ok(run.trapSpeed >= w.minTrapMph && run.trapSpeed <= w.maxTrapMph, `${at}: trap ${run.trapSpeed.toFixed(1)} outside ${w.minTrapMph.toFixed(0)}-${w.maxTrapMph.toFixed(0)}`);
        assert.ok(run.ft60 >= w.minFt60 && run.eighth >= w.minEighth, `${at}: 60 ft ${run.ft60.toFixed(2)} / eighth ${run.eighth.toFixed(2)} below ${w.minFt60.toFixed(2)} / ${w.minEighth.toFixed(2)}`);
        assert.equal(implausibleReason(cls, score, run), null, at);
      }
      // the window is not loose: the default-tune ET sits within the tune and margin allowance of the fast edge (the class bound may only tighten it)
      const def = card(cls, score).quarter;
      assert.ok(def - w.minEt <= PLAUSIBLE_TOLERANCE.goodTune + PLAUSIBLE_TOLERANCE.physicsMargin + 0.06 + Math.max(0, CLASS_BOUNDS[cls].minQuarterEt - w.minEt + 1), `${cls} ${score}: the fast edge is ${(def - w.minEt).toFixed(2)} s under the default`);
    }
  }
});

test('a time faster than the window for the score is rejected, the scenarios the owner named behave', () => {
  assert.notEqual(implausibleReason('discrete', 1000, { quarter: 3.7, ft60: 0.74, eighth: 2.4, trapSpeed: 330 }), null, 'score 1000 + 3.7 s');
  assert.equal(implausibleReason('discrete', 10000, { quarter: 4.1, ft60: 0.8, eighth: 2.6, trapSpeed: 330 }), null, 'score 10000 + 4.1 s');
  assert.notEqual(implausibleReason('integrated', 0, { quarter: 9, ft60: 1.5, eighth: 5.8, trapSpeed: 140 }), null, 'score 0 integrated + 9 s');
  assert.equal(implausibleReason('integrated', 0, { quarter: 12.9, ft60: 2.4, eighth: 8.2, trapSpeed: 102 }), null, 'weakest score at a slow time');
  assert.equal(implausibleReason('discrete', 0, { quarter: 7.6, ft60: 1.25, eighth: 4.7, trapSpeed: 175 }), null, 'weakest discrete, slow');
  // for every score a run 0.8 s under the physics default is refused
  for (const cls of CLASS_IDS) for (let score = 0; score <= classScoreCap(cls); score += 500) {
    const d = card(cls, score);
    if (d.quarter - 0.8 < CLASS_BOUNDS[cls].minQuarterEt) continue;
    assert.notEqual(implausibleReason(cls, score, { ...d, quarter: d.quarter - 0.8 }), null, `${cls} ${score}`);
  }
});

test('validateSubmission: the 422 reason is clear and a score above the class cap is refused', () => {
  const run = (cls, score, et, mph) => ({ playerName: 'Racer One', class: cls, category: 'manual', benchmarkScore: score, benchmarkVersion: '2', gpuId: 'x', reactionTime: 0.05, seed: 1, tune: {},
    splits: { ft60: +(et * 0.2).toFixed(3), ft330: +(et * 0.44).toFixed(3), eighth: +(et * 0.65).toFixed(3), ft1000: +(et * 0.84).toFixed(3), quarter: et }, trapSpeed: mph });
  const bad = validateSubmission(run('discrete', 1000, 3.7, 330));
  assert.equal(bad.ok, false); assert.match(bad.error, /faster than plausible for a card of class discrete with benchmark score 1000/);
  assert.equal(validateSubmission(run('discrete', 10000, 4.1, 330)).ok, true);
  assert.match(validateSubmission(run('integrated', 9000, 9.6, 139)).error, /class cap of 8000/);
});
