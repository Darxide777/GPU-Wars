// The calibration table: the quarter-mile ET of every class across its scores, on the ranked class day, with the default tune and with a good one.
// This is the test that keeps the classes far apart (a strong integrated card is a 10 s car, a current discrete card a 4 s top fuel car), follows the score,
// keeps the trap speed believable for the ET, and keeps the bundled class leaders and the server's bounds in step with the physics. docs/CALIBRATION.md explains the numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrag, predictDrag } from '../src/drag/physics.ts';
import { readyCar } from '../src/drag/model.ts';
import { emptySave } from '../src/save.ts';
import { cleanTune } from '../src/drag/tune.ts';
import { CLASS_BOUNDS, CLASS_IDS, eraOf } from '../src/classes.ts';
import { BENCHMARK } from '../src/benchmark/constants.ts';
import { classScoreCap, scoreFromRate } from '../src/benchmark/score.ts';
import { REFERENCE_CARDS } from '../src/benchmark/reference.ts';
import { allFallbackLeaders, fallbackLeader } from '../src/leaderboard/leader.ts';
import { RANKED, rankedStart, rankedStrip } from '../src/leaderboard/ranked.ts';

/** the ET bands of each class for a card of any score with the default tune (a good tune is faster, so the bands are for the default) */
const BANDS = { integrated: [9.4, 12.8], retro: [5.8, 7.2], classic: [5.0, 6.4], modern: [4.4, 5.5], current: [3.95, 4.7] };
const bandOf = cls => BANDS[eraOf(cls) ?? 'integrated'];
const card = (cls, score, over = null) => {
  const { car, spec, tune } = readyCar({ ...emptySave(), benchmark: { score, class: cls, benchmarkVersion: BENCHMARK.version, gpuId: 'calibration', date: 1 } });
  const t = over ? cleanTune({ ...tune, ...over(spec, tune) }, car, spec) : tune, st = rankedStart();
  const slip = predictDrag(spec, t, RANKED.seed, RANKED.conditions, st.fuel, st.engineTemp, rankedStrip()).slip;
  return { et: slip.quarter, mph: slip.trap / 1.609344, slip, spec, tune: t };
};
/** a good tune: the best of a small grid around the defaults (a shorter final drive, a higher launch rpm, a firmer launch) */
const goodTune = (cls, score) => {
  let best = card(cls, score);
  for (const dfin of [-0.3, 0, 0.3, 0.6]) for (const lr of [0.7, 0.9, 1.0]) for (const ag of [7, 9]) {
    const c = card(cls, score, (spec, tune) => ({ final: tune.final + dfin, launchRpm: Math.round(spec.peakRpm * lr / 100) * 100, launchAggression: ag }));
    if (c.et < best.et && !c.slip.foul) best = c;
  }
  return best;
};

test('calibration: every class stays in its ET band across the whole score range, and a higher score is never slower', () => {
  const table = [];
  for (const cls of CLASS_IDS) {
    const cap = classScoreCap(cls), [lo, hi] = bandOf(cls); let last = Infinity;
    for (let i = 0; i <= 10; i++) {
      const score = Math.round(cap * i / 10), c = card(cls, score);
      assert.ok(c.et >= lo && c.et <= hi, `${cls} score ${score}: ET ${c.et.toFixed(3)} is outside ${lo}-${hi}`);
      assert.ok(c.et <= last + 0.004, `${cls}: score ${score} is slower (${c.et.toFixed(3)}) than the score before (${last.toFixed(3)})`);
      const b = CLASS_BOUNDS[cls]; assert.ok(c.et > b.minQuarterEt && c.mph < b.maxTrapSpeed, `${cls} ${score}: ET ${c.et} / ${c.mph} mph is outside the server's bounds`);
      assert.ok(c.mph * c.et > 1200 && c.mph * c.et < 1450, `${cls} ${score}: trap ${c.mph.toFixed(0)} mph is not believable for ${c.et.toFixed(2)} s`);
      last = c.et; if (cls.endsWith('nvidia-retro') || cls.endsWith('nvidia-classic') || cls.endsWith('nvidia-modern') || cls.endsWith('nvidia-current') || cls === 'integrated') table.push(`${cls}\t${score}\t${c.et.toFixed(2)}\t${c.mph.toFixed(0)}`);
    }
  }
  if (process.env.PRINT_ET_TABLE) console.log(['class', 'score', 'ET', 'mph'].join('\t') + '\n' + table.join('\n'));
});

test('calibration: the classes are far apart (top integrated about 10 s, retro about 6 to 7 s, current about 4 s) and every vendor of an era is the same car', () => {
  const top = cls => card(cls, classScoreCap(cls)).et, floor = cls => card(cls, 0).et;
  assert.ok(top('integrated') > 9.4 && top('integrated') < 10.2, `integrated top ${top('integrated')}`);
  assert.ok(floor('integrated') > 11.8 && floor('integrated') < 12.8, `integrated floor ${floor('integrated')}`);
  assert.ok(floor('discrete-amd-retro') > 6.5 && floor('discrete-amd-retro') < 7.2 && top('discrete-amd-retro') > 5.8 && top('discrete-amd-retro') < 6.3, 'retro is 6 to 7 s');
  assert.ok(top('discrete-nvidia-current') >= 3.95 && top('discrete-nvidia-current') <= 4.2, `the best current card is a 4.0 s car: ${top('discrete-nvidia-current')}`);
  assert.ok(card('discrete-nvidia-current', classScoreCap('discrete-nvidia-current')).mph < 345 && card('discrete-nvidia-current', classScoreCap('discrete-nvidia-current')).mph > 300, 'at about 300 to 340 mph');
  for (const era of ['retro', 'classic', 'modern', 'current']) assert.ok(top(`discrete-amd-${era}`) < floor(`discrete-amd-${era}`) - 0.3, `${era}: the score matters inside the class`);
  // the best of a weaker class is slower than the worst of the next one up, by a clear margin where the classes meet
  const order = ['integrated', 'discrete-amd-retro', 'discrete-amd-classic', 'discrete-amd-modern', 'discrete-amd-current'];
  for (let i = 1; i < order.length; i++) assert.ok(floor(order[i]) < floor(order[i - 1]) - 0.4 && top(order[i]) < top(order[i - 1]) - 0.4, `${order[i]} is clearly quicker than ${order[i - 1]}`);
  for (const era of ['retro', 'classic', 'modern', 'current']) for (const score of [0, 4000, 7000]) assert.equal(card(`discrete-amd-${era}`, score).et, card(`discrete-nvidia-${era}`, score).et, 'the vendor does not change the physics');
});

test('calibration: the reference iGPU (AMD Radeon 8060S) lands near 10 s, and the weakest un-benchmarked car is slower than every benchmarked one', () => {
  const ref = REFERENCE_CARDS.find(c => c.name === 'AMD Radeon 8060S');
  assert.ok(ref, 'the reference table lists the 8060S');
  const score = Math.min(scoreFromRate(ref.rate, 'webgl2'), classScoreCap('integrated')), c = card('integrated', score);
  assert.ok(Math.abs(c.et - 10) < 0.35, `the 8060S: score ${score} gives ${c.et.toFixed(2)} s`);
  assert.ok(score < classScoreCap('integrated'), 'near the top of integrated but not capped, so a faster iGPU can still score higher');
  const none = readyCar(emptySave()), st = rankedStart();
  const noneEt = predictDrag(none.spec, none.tune, RANKED.seed, RANKED.conditions, st.fuel, st.engineTemp, rankedStrip()).slip.quarter;
  assert.ok(noneEt >= 12, `un-benchmarked ${noneEt.toFixed(2)} s`);
  for (const cls of CLASS_IDS) for (const f of [0, 0.5, 1]) assert.ok(noneEt > card(cls, Math.round(classScoreCap(cls) * f)).et, `slower than ${cls} at ${f}`);
});

test('calibration: the tune still decides races: a good tune beats the default tune in every class, and too firm a launch on a bad day spins', () => {
  for (const cls of ['integrated', 'discrete-nvidia-retro', 'discrete-nvidia-classic', 'discrete-nvidia-modern', 'discrete-nvidia-current']) {
    const score = Math.round(classScoreCap(cls) * 0.8), base = card(cls, score), good = goodTune(cls, score);
    assert.ok(good.et < base.et - 0.04, `${cls}: a good tune (${good.et.toFixed(3)}) beats the default (${base.et.toFixed(3)})`);
    assert.ok(good.et > base.et - 0.9, `${cls}: but the tune is not worth a whole class`);
  }
  // the clutch manager does not know a cold, soft-tired launch: the most aggressive launch there spins where the gentle one does not
  const strong = classScoreCap('discrete-nvidia-current');
  const rough = ag => card('discrete-nvidia-current', strong, () => ({ launchAggression: ag, pressure: 14 })).slip.spin;
  assert.ok(rough(10) > rough(2), `spin ${rough(10)} vs ${rough(2)}`);
});

test('calibration: the top-fuel traction at work: the clutch sheds power at the launch, the power ramps in, tires grow and the run is the same every time', () => {
  const run = () => {
    const { spec, tune } = readyCar({ ...emptySave(), benchmark: { score: 10000, class: 'discrete-nvidia-current', benchmarkVersion: BENCHMARK.version, gpuId: 'x', date: 1 } }), st = rankedStart();
    const d = createDrag({ seed: RANKED.seed, conditions: RANKED.conditions, strip: rankedStrip(), quickStart: true, entrants: [{ name: 'YOU', spec, tune, ai: { react: 0, spread: 0, shiftErr: 0, foul: 0, heatSense: 1, deepStage: true }, fuel: st.fuel, engineTemp: st.engineTemp }] });
    const r = d.state.runners[0]; let shed = 0, slipRpm = 0, early = 0; r.tireTemp = 95; r.plan.burnout = 0;
    while (d.state.phase !== 'over') { d.step(); if (r.launched && !r.finished) { shed = Math.max(shed, r.managedShed); slipRpm = Math.max(slipRpm, r.managedSlip); if (r.x < 20) early = Math.max(early, r.managedShed); } }
    return { shed, slipRpm, early, et: r.marks.quarter };
  };
  const a = run(), b = run();
  assert.deepEqual(a, b, 'deterministic');
  assert.ok(a.early > 0.1, `the clutch holds power back in the first metres: ${a.early.toFixed(2)}`);
  assert.ok(a.slipRpm > 500, `the engine revs above the wheels while it does: ${a.slipRpm.toFixed(0)} rpm`);
});

test('calibration: the bundled class leaders sit inside the ET bands and the server bounds, are believable, and are beatable by a good tune but not by a default one', () => {
  for (const l of allFallbackLeaders()) {
    const [lo, hi] = bandOf(l.class), b = CLASS_BOUNDS[l.class], et = l.splits.quarter;
    assert.ok(et >= lo && et <= hi, `${l.class} ${l.category}: leader ET ${et} is outside ${lo}-${hi}`);
    assert.ok(et > b.minQuarterEt && l.trapSpeed < b.maxTrapSpeed && l.trapSpeed > b.minTrapSpeed, `${l.class}: leader is outside the server's bounds`);
    assert.ok(et * l.trapSpeed > 1250 && et * l.trapSpeed < 1450, `${l.class}: leader trap ${l.trapSpeed} mph does not fit ${et} s`);
  }
  for (const cls of ['integrated', 'discrete-nvidia-retro', 'discrete-amd-classic', 'discrete-nvidia-modern', 'discrete-amd-current']) {
    const leader = fallbackLeader(cls, 'manual').splits.quarter, cap = classScoreCap(cls);
    const typical = goodTune(cls, Math.round(cap * 0.7)).et, weak = card(cls, Math.round(cap * 0.5)).et, strongDefault = card(cls, cap).et;
    assert.ok(typical < leader, `${cls}: a good tune of a typical card at 70% of the class's top score (${typical.toFixed(3)}) beats the leader (${leader})`);
    assert.ok(weak > leader, `${cls}: a default tune of a middling card (${weak.toFixed(3)}) does not (${leader})`);
    assert.ok(strongDefault < leader + 0.15 && goodTune(cls, cap).et < leader - 0.05, `${cls}: the top card with a good tune beats it with room to spare`);
  }
  assert.ok(fallbackLeader('discrete-nvidia-current', 'manual').splits.quarter < fallbackLeader('discrete-nvidia-retro', 'manual').splits.quarter - 1.5, 'the leaders of the classes are far apart');
});
