// The class-leader ghost's looks: it stages like a real car, runs past the finish line and stops in the run-out with its chute out, launches with a
// realistic 60 ft, and only the player's car carries the clutch / boost / tire / fuel readouts in the top-down view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_DRIVER, DRAG, SHUTDOWN, STAGE, createDrag, cleanDragGhost } from '../src/drag/physics.ts';
import { createDragTopDown } from '../src/drag/topdown.ts';
import { specForBenchmark } from '../src/drag/spec-source.ts';
import { defaultTune } from '../src/drag/tune.ts';
import { DRAG_CARS } from '../src/drag/data.ts';
import { buildLeaderGhost, completeSplits, launchShareFor } from '../src/leaderboard/ghost.ts';
import { fallbackLeader } from '../src/leaderboard/leader.ts';
import { RANKED, rankedStart, rankedStrip } from '../src/leaderboard/ranked.ts';

const spec = specForBenchmark(null), tune = defaultTune(DRAG_CARS[0]);
const record = (extra = {}) => ({ name: 'SPEEDY', class: 'discrete', category: 'manual', reactionTime: 0.061, splits: { quarter: 7.2 }, trapSpeed: 190, seed: 4242, source: 'fallback', ...extra });
const raceWith = (ghost, quick = false) => createDrag({ seed: RANKED.seed, conditions: RANKED.conditions, strip: rankedStrip(), quickStart: quick, entrants: [{ name: 'YOU', spec, tune, ai: { ...AUTO_DRIVER }, ...rankedStart() }, { name: ghost.name, spec, tune, ghost }] });
const runToEnd = (race, onStep) => { for (let i = 0; i < 240 * 120 && race.state.phase !== 'over'; i++) { race.step(); onStep?.(race.state); } return race.state; };

/** a canvas that records the text it is asked to write and accepts every other call */
function recorder() {
  const texts = [], calls = [], fns = new Set(['strokeText', 'fillRect', 'strokeRect', 'moveTo', 'lineTo', 'arc', 'ellipse', 'fill', 'stroke', 'beginPath', 'closePath', 'save', 'restore', 'translate', 'rotate', 'setLineDash', 'clearRect', 'scale', 'quadraticCurveTo', 'bezierCurveTo', 'rect', 'clip']);
  const ctx = new Proxy({}, { get: (t, k) => { if (k === 'measureText') return (s) => ({ width: String(s).length * 7.8 }); if (k === 'fillText') return s => { texts.push(String(s)); }; if (k === 'arc') return () => { calls.push('arc'); }; if (fns.has(k)) return () => {}; if (k === 'measureText') return s => ({ width: String(s).length * 8 }); return t[k]; }, set: (t, k, v) => { t[k] = v; return true; } });
  return { ctx, texts, calls };
}

test('the leader ghost runs past the finish line, slows with its chute out and stops inside the run-out', () => {
  for (const rec of [record(), fallbackLeader('integrated'), record({ splits: { quarter: 4.2 }, trapSpeed: 290 }), record({ splits: { quarter: 3.7 }, trapSpeed: 330 })]) {
    const g = buildLeaderGhost(rec), race = raceWith(g, true), ghost = race.state.runners[1];
    let chuteSeen = 0, slowedAfter = false, crossed = false;
    runToEnd(race, s => { if (ghost.finished) { crossed = true; chuteSeen = Math.max(chuteSeen, ghost.chuteOpen); if (ghost.x > DRAG.marks.quarter + 30 && ghost.v < g.trap / 3.6 * 0.9) slowedAfter = true; } });
    assert.ok(crossed, 'it finished'); assert.ok(ghost.stopped && ghost.v === 0, 'and it stopped');
    assert.ok(ghost.x > DRAG.marks.quarter + 40, `it carried on past the line: stopped at ${ghost.x.toFixed(0)} m`);
    assert.ok(ghost.x < SHUTDOWN.end && !ghost.crashed, `inside the run-out (${ghost.x.toFixed(0)} m of ${SHUTDOWN.end})`);
    assert.equal(chuteSeen, 1, 'its chute was fully out'); assert.ok(slowedAfter, 'it slowed down gradually');
    assert.equal(ghost.marks.quarter, rec.splits.quarter, 'the ET is still the leader ET'); assert.equal(ghost.reaction, g.reaction);
  }
});

test('any ghost entrant, not just the leader, carries on past the quarter mile instead of stopping dead at the line', () => {
  const g = cleanDragGhost({ car: 'x', name: 'BEST PASS', reaction: 0.2, marks: { quarter: 13, ft60: 2 }, trap: 180, total: 13.2, samples: [{ t: 0, x: 0, y: 0, psi: 0, v: 0 }, { t: 1, x: 10, y: 0, psi: 0, v: 20 }, { t: 13.2, x: DRAG.marks.quarter, y: 0, psi: 0, v: 50 }] });
  const race = raceWith(g, true), ghost = race.state.runners[1]; runToEnd(race);
  assert.ok(ghost.stopped && ghost.x > DRAG.marks.quarter + 20, `stopped at ${ghost.x.toFixed(0)} m`);
});

test('the ghost stages like a real car: burnout, run-out, back up, pre-stage, stage, with smoke, reverse light and stage bulbs, and its ET starts at the green', () => {
  const g = buildLeaderGhost(record()), race = raceWith(g), ghost = race.state.runners[1], td = createDragTopDown(), seen = new Set(), labels = new Set();
  let smokeFrames = 0, reverseSeen = false, preBulb = false, stageBulb = false, pastTreeX = -Infinity, k = 0;
  runToEnd(race, s => {
    if (s.green || k++ % 8) { if (s.green && ghost.stage !== 'launched' && !ghost.launched) seen.add(ghost.stage); return; }
    seen.add(ghost.stage); pastTreeX = Math.max(pastTreeX, ghost.x); reverseSeen ||= ghost.reversing; preBulb ||= ghost.preBulb; stageBulb ||= ghost.stageBulb;
    const r = recorder(); td.draw(r.ctx, 1280, 720, s, 0, 0.033, k / 30); if (ghost.burnout) smokeFrames += r.calls.length > 0 ? 1 : 0;
    for (const t of r.texts) labels.add(t);
  });
  for (const stage of ['waterBoxApproach', 'burnout', 'runOut', 'backup', 'preStage', 'staged']) assert.ok(seen.has(stage), `the ghost was seen in ${stage}`);
  assert.ok(pastTreeX > STAGE.runOutPastTree - 1, `it ran out past the tree (${pastTreeX.toFixed(1)} m)`);
  assert.ok(reverseSeen, 'its reverse light came on while backing up'); assert.ok(preBulb && stageBulb, 'its pre-stage and stage bulbs lit');
  assert.ok(smokeFrames > 3, 'its burnout smoke was drawn'); assert.ok(labels.has('BURNOUT') && labels.has('BACK UP'), 'the staging steps are written next to it');
  assert.equal(ghost.marks.quarter, g.marks.quarter, 'its ET is the leader ET (it starts at the green)'); assert.ok(race.state.greenAt > 0);
});

test('the ghost launch is a realistic share of its ET: 60 ft is about 15 to 22 percent (top fuel 0.8 s of 3.7, a ten second car 1.6 s)', () => {
  assert.ok(Math.abs(launchShareFor(3.7) - 0.198) < 1e-9 && launchShareFor(10) < 0.19 && launchShareFor(10) > 0.17);
  for (const [et, trap] of [[3.7, 330], [4.2, 290], [6.6, 210], [7.9, 170], [10, 135], [13, 105]]) {
    const s = completeSplits(record({ splits: { quarter: et }, trapSpeed: trap })), share = s.ft60 / et;
    assert.ok(share > 0.145 && share < 0.23, `${et} s ET: 60 ft ${s.ft60.toFixed(2)} s is ${(share * 100).toFixed(1)} percent`);
    assert.ok(s.ft330 / et > 0.37 && s.ft330 / et < 0.45 && s.eighth / et > 0.6 && s.eighth / et < 0.67 && s.ft1000 / et > 0.8 && s.ft1000 / et < 0.86, `${et}: the other marks are real-car shares`);
  }
  const g = buildLeaderGhost(record({ splits: { quarter: 9.4 }, trapSpeed: 140 })), at60 = g.samples.find(s => s.x >= DRAG.marks.ft60);
  assert.ok((at60.t - g.reaction) / 9.4 > 0.14, 'the x(t) curve itself reaches 60 ft after a realistic time');
  // the leader's own splits are kept and the made-up ones fit around them
  const own = completeSplits(record({ splits: { ft60: 1.9, ft1000: 6.6, quarter: 7.2 } }));
  assert.equal(own.ft60, 1.9); assert.equal(own.ft1000, 6.6); assert.ok(own.ft330 > 1.9 && own.eighth > own.ft330 && own.eighth < 6.6);
  // the same record always gives the same ghost
  assert.deepEqual(buildLeaderGhost(record()), buildLeaderGhost(record()));
});

test('only the player car carries the clutch, boost, tire and fuel readouts; the ghost has no text at all', () => {
  const race = raceWith(buildLeaderGhost(record()), true), td = createDragTopDown();
  for (let i = 0; i < 240 * 6; i++) race.step();
  const r = recorder(); td.draw(r.ctx, 1280, 720, race.state, 0, 0.016, 3);
  const count = word => r.texts.filter(t => t.startsWith(word)).length;
  for (const word of ['CLUTCH', 'TIRE', 'FUEL']) assert.equal(count(word), 1, `${word} once (the player's)`);
  assert.ok(count('BOOST') <= 1, 'BOOST at most once');
  assert.ok(!r.texts.includes('SPEEDY') && !r.texts.some(t => /^ET \d/.test(t)), 'the ghost has no name, stage or ET text beside it');
  const stageWords = ['STAGED', 'PRE-STAGED', 'DEEP STAGED', 'ROLLING', 'ABORT', 'FRONT UP'], onlyYou = r.texts.filter(t => stageWords.includes(t)).length; assert.ok(onlyYou <= 1, 'a stage word is written at most once (for your car), never for the ghost');
  // with the camera on the ghost's lane the player's readouts are still the only ones
  const other = recorder(); td.draw(other.ctx, 1280, 720, race.state, 1, 0.016, 3); assert.ok(other.texts.filter(t => t.startsWith('CLUTCH')).length <= 1);
});

test('ghost splits follow the physics: every class leader ghost reaches 60 ft, 330 ft, the eighth and 1000 ft at the same share of its ET as the simulated car (within 5 percent), and a given split is never moved', async () => {
  const { predictDrag } = await import('../src/drag/physics.ts');
  const { readyCar } = await import('../src/drag/model.ts');
  const { emptySave } = await import('../src/save.ts');
  const { BENCHMARK } = await import('../src/benchmark/constants.ts');
  const { classScoreCap } = await import('../src/benchmark/score.ts');
  const marks = ['ft60', 'ft330', 'eighth', 'ft1000'];
  for (const cls of ['integrated', 'discrete', 'discrete', 'discrete', 'discrete']) {
    // the bundled leader's own ET, and then the whole score range (the one discrete class spans 4 s to 7 s, so the share is checked all the way)
    for (const fraction of [0.7, 0, 0.1, 0.25, 0.5, 1]) {
      const { spec, tune } = readyCar({ ...emptySave(), benchmark: { score: Math.round(classScoreCap(cls) * fraction), class: cls, benchmarkVersion: BENCHMARK.version, gpuId: 'ghost-test', date: 1 } }), st = rankedStart();
      const slip = predictDrag(spec, tune, RANKED.seed, RANKED.conditions, st.fuel, st.engineTemp, rankedStrip()).slip;
      const ghost = completeSplits(fraction === 0.7 ? fallbackLeader(cls) : { ...fallbackLeader(cls), splits: { quarter: slip.quarter }, trapSpeed: slip.trap / 1.609344 });
      for (const m of marks) {
        const physics = slip[m] / slip.quarter, generated = ghost[m] / ghost.quarter;
        assert.ok(Math.abs(generated / physics - 1) < 0.05, `${cls} at ${fraction} of the class's top score (${slip.quarter.toFixed(2)} s) ${m}: the ghost takes ${(generated * 100).toFixed(1)}% of its ET, the physics ${(physics * 100).toFixed(1)}%`);
      }
    }
    const ghost = completeSplits(fallbackLeader(cls));
    // a split the leader's record provides stays exactly as given
    const given = { ...fallbackLeader(cls), splits: { quarter: ghost.quarter, ft60: ghost.ft60 * 1.1 } };
    assert.equal(completeSplits(given).ft60, ghost.ft60 * 1.1);
  }
});
