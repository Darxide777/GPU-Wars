// The autopilot: it drives the REAL staging sequence (water box, burnout, run-out, back up, creep into the beams, launch) with the same inputs a player has,
// is deterministic per seed, finishes a clean pass in a sane time, and its runs are their own leaderboard category.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDrag, predictDrag, timeslip } from '../src/drag/physics.ts';
import { readyCar } from '../src/drag/model.ts';
import { emptySave } from '../src/save.ts';
import { createAutopilot, viewOf, steerFor, AUTOPILOT_CATEGORY, AUTOPILOT } from '../src/drag/autopilot.ts';
import { IDLE_INPUT } from '../src/input/controls.ts';
import { RANKED, rankedStart, rankedStrip } from '../src/leaderboard/ranked.ts';

const page = readFileSync(new URL('../src/drag/page.ts', import.meta.url), 'utf8');
const car = () => readyCar(emptySave());
/** a whole race, from the water box (no quick start): the autopilot sees only what the page gives it (`viewOf(race, 0, the engine's phase)`) */
const drive = (seed, tuneChange = {}, ranked = false) => {
  const { spec, tune } = car(), entrant = { name: 'AUTOPILOT', spec, tune: { ...tune, ...tuneChange }, ai: null, ...(ranked ? rankedStart() : {}) };
  const d = createDrag(ranked ? { seed: RANKED.seed, conditions: RANKED.conditions, strip: rankedStrip(), entrants: [entrant] } : { seed, entrants: [entrant] }), ap = createAutopilot(), r = d.state.runners[0], inputs = [], phases = [], times = {}, gears = new Set([r.gear]); let n = 0, last = '';
  while (d.state.phase !== 'over' && n++ < 240 * 120) {
    const inp = ap.decide(viewOf(d, 0, r.stage)); inputs.push(inp); d.setInput(0, inp); d.step(); gears.add(r.gear);
    if (r.stage !== last) { phases.push(r.stage); times[r.stage] = d.state.t; last = r.stage; }
  }
  return { d, r, slip: timeslip(r), inputs, phases, times, gears: [...gears], ticks: n, ap };
};
const FULL = ['waterBoxApproach', 'burnout', 'runOut', 'backup', 'preStage', 'staged', 'rolling', 'launched'];

test('the autopilot is deterministic: the same seed gives the same run, input for input', () => {
  const a = drive(42), b = drive(42);
  assert.deepEqual(a.inputs, b.inputs); assert.equal(a.slip.quarter, b.slip.quarter); assert.equal(a.slip.reaction, b.slip.reaction); assert.deepEqual(a.phases, b.phases);
  assert.equal(drive(43).d.state.winner, 0);
});

test('it drives the whole staging sequence with player inputs: burnout, run out, back up, creep into the beams, roll out, launch', () => {
  for (const seed of [1, 2, 3, 77, 1234, 99999]) {
    const { phases, inputs, slip, r } = drive(seed);
    assert.deepEqual(phases, FULL, `seed ${seed}: the engine went through every stage, in order`);
    assert.ok(inputs.some(i => i.burnout && i.throttle === 1), 'it held gas and burnout'); assert.ok(inputs.some(i => i.backUp), 'it backed up'); assert.ok(inputs.some(i => i.launch), 'it pressed launch to roll out');
    assert.ok(r.burnDistance > 1, 'the burnout really spun the tires'); assert.ok(!slip.foul && !slip.aborted && !slip.deepStage, 'a normal stage, no red light');
  }
});

test('it finishes a clean pass on several seeds, in a sane ET, with the tree read light by light', () => {
  const { spec, tune } = car();
  for (const seed of [1, 2, 3, 77, 1234, 99999]) {
    const { d, slip, ticks } = drive(seed), perfect = predictDrag(spec, tune, seed).slip;
    assert.equal(d.state.winner, 0, `clean pass for seed ${seed}: ${d.state.reason}`); assert.equal(d.state.reason, 'a clean run');
    assert.ok(!slip.foul && !slip.crossed && !slip.crashed && !slip.aborted);
    assert.ok(slip.reaction >= 0.05 && slip.reaction <= 0.25 && Math.abs(slip.reaction - AUTOPILOT.reaction) < 0.03, `reaction ${slip.reaction}`);
    assert.ok(slip.quarter > perfect.quarter * 0.95 && slip.quarter < perfect.quarter * 1.12, `ET ${slip.quarter} against the perfect driver's ${perfect.quarter}`);
    assert.ok(slip.trap > 0 && ticks / 240 < 70, 'the run is over in a sane time');
  }
});

test('the autopilot pays for the whole staging: the launch comes late in the race clock, but the ET starts at the green', () => {
  const a = drive(5);
  assert.ok(a.times.launched > 10, `it launched at ${a.times.launched.toFixed(1)} s on the clock`); assert.ok(a.slip.quarter < 15, 'the quarter is timed from the launch');
});

test('it works for a manual-shift tune and a nitro-by-hand tune through the same inputs', () => {
  const manual = drive(5, { shift: 'manual' }), hand = drive(5, { nitroGear: 0 }), atLimiter = drive(5, { shift: 'manual', shiftRpm: car().spec.redline }), autoAtLimiter = drive(5, { shift: 'auto', shiftRpm: car().spec.redline });
  for (const r of [manual, hand, atLimiter, autoAtLimiter]) { assert.equal(r.d.state.winner, 0, r.d.state.reason); assert.ok(r.slip.quarter < 15); }
  assert.ok(manual.inputs.some(i => i.shiftUp), 'it pressed shift up itself'); assert.ok(hand.slip.nitroUsed > 0 || car().spec.nitroSecs === 0, 'it fired the bottle');
  assert.ok(atLimiter.inputs.some(i => i.shiftUp) && atLimiter.gears.length > 1, 'a manual shift point at the limiter still shifts on the shift lamp');
  assert.ok(autoAtLimiter.gears.length > 1, 'an automatic shift point at the limiter still shifts');
});

test('it works on the ranked class day too (the same strip and weather as a manual ranked run)', () => {
  const { d, slip, phases } = drive(0, {}, true);
  assert.equal(d.state.winner, 0, d.state.reason); assert.deepEqual(phases, FULL); assert.ok(slip.quarter > 5 && slip.quarter < 16);
  assert.deepEqual(drive(0, {}, true).slip, slip);
});

test('it only returns what a player can: the DriverInput shape, taps for the presses, and no chute before the line', () => {
  const { inputs, d, r } = drive(7);
  const keys = Object.keys(IDLE_INPUT).sort(); for (const i of inputs) assert.deepEqual(Object.keys(i).sort(), keys);
  let prev = false; for (const i of inputs) { assert.ok(!(i.nitro && prev), 'nitro is a tap'); prev = i.nitro; }
  const firstChute = inputs.findIndex(i => i.chute), launchedAt = inputs.findIndex((_, k) => k > 0 && d.state.t > 0 && r.launchT > 0 && k / 240 >= r.launchT);
  assert.ok(firstChute > launchedAt && launchedAt > 0, 'no chute (which would abort) before the launch'); assert.ok(r.chute);
  assert.ok(inputs.every(i => i.throttle >= 0 && i.throttle <= 1 && Math.abs(i.steer) <= 1));
});

test('it waits for the tree: it never presses launch before the first amber and leaves after the predicted green', () => {
  const { r, inputs } = drive(11);
  assert.ok(r.reaction > 0 && Math.abs(r.reaction - AUTOPILOT.reaction) < 0.03, 'a steady reaction near its setting: ' + r.reaction);
  const { spec, tune } = car(), e = createDrag({ seed: 11, entrants: [{ name: 'X', spec, tune, ai: null }] }), ap = createAutopilot(), me = e.state.runners[0], presses = [];
  while (!e.state.green && e.state.t < 200) { const inp = ap.decide(viewOf(e, 0, me.stage)); if (inp.launch) presses.push(e.state.ambers); e.setInput(0, inp); e.step(); }
  assert.ok(presses.length > 0 && presses.every(a => a >= 1), 'it rolls out only after an amber is lit'); assert.ok(inputs.length > 0);
});

test('each staging phase gets the right press (the engine reports it, the autopilot does not work it out)', () => {
  const { spec, tune } = car(), d = createDrag({ seed: 1, entrants: [{ name: 'X', spec, tune, ai: null }] }), v = viewOf(d, 0, 'backup');
  const run = (phase, over = {}) => createAutopilot().decide({ ...v, stagePhase: phase, runner: { ...v.runner, ...over } });
  assert.equal(run('backup', { x: -0.1, v: 0 }).backUp, true, 'backing up'); assert.equal(run('backup', { x: -0.7, v: 0 }).backUp, false); assert.ok(run('backup', { x: -0.7, v: 0 }).throttle > 0, 'creeps in from behind the beam');
  const burn = run('burnout', { x: -20 }); assert.ok(burn.burnout && burn.throttle === 1, 'burnout is gas + burnout'); assert.ok(!run('waterBoxApproach', { x: -33 }).burnout, 'no burnout before the water box');
  assert.equal(run('runOut', { x: 9, v: 0 }).backUp, true, 'stopped past the tree: reverse'); assert.equal(run('runOut', { x: 9, v: 3 }).brake, true, 'still rolling past the tree: brake');
  assert.equal(run('preStage').launch, false, 'it does not press launch until the tree is up'); assert.ok(run('preStage').throttle > 0);
  assert.equal(steerFor({ v: 0, y: 1, psi: 0, yawRate: 0, gripLeft: 1 }), 0); assert.ok(steerFor({ v: 50, y: 1, psi: 0, yawRate: 0, gripLeft: 1 }) < 0, 'right of the middle: steer left');
  assert.equal(AUTOPILOT_CATEGORY, 'autopilot'); assert.equal(createAutopilot().category, 'autopilot');
  assert.doesNotMatch(readFileSync(new URL('../src/drag/autopilot.ts', import.meta.url), 'utf8'), /stagePhaseOf/, 'no staging derivation of its own');
});

test('the page: DRIVER, the engine phase goes in through viewOf, autopilot runs are their own category on the ranked day and skip local records', () => {
  assert.match(page, /label: 'DRIVER'/); assert.match(page, /viewOf\(race, 0, \(race\.state\.runners\[0\] as Runner\)\.stage\)/);
  assert.match(page, /lb\.setCategory\(c\)/, 'the leaderboard category follows the driver'); assert.match(page, /options\.driver === 'autopilot' \? AUTOPILOT_CATEGORY : 'manual'/);
  assert.match(page, /category === 'autopilot' \? \{ save, records: \[\] as string\[\] \}/, 'no local records for the autopilot');
  assert.match(page, /seed: RANKED\.seed, conditions: RANKED\.conditions, strip: rankedStrip\(\)/, 'the same class day for both drivers');
});
