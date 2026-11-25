// The autopilot: deterministic, uses only the DriverInput shape, finishes a clean pass in a sane time, and the leaderboard category.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrag, predictDrag, timeslip, DRAG } from '../src/drag/physics.ts';
import { readyCar } from '../src/drag/model.ts';
import { emptySave } from '../src/save.ts';
import { createAutopilot, viewOf, stagePhaseOf, steerFor, AUTOPILOT_CATEGORY, AUTOPILOT } from '../src/drag/autopilot.ts';
import { IDLE_INPUT } from '../src/input/controls.ts';

const car = () => readyCar(emptySave());
const drive = (seed, tuneChange = {}) => {
  const { spec, tune } = car(), d = createDrag({ seed, entrants: [{ name: 'AUTOPILOT', spec, tune: { ...tune, ...tuneChange }, ai: null }] }), ap = createAutopilot(), inputs = []; let n = 0;
  while (d.state.phase !== 'over' && n++ < 240 * 60) { const inp = ap.decide(viewOf(d)); inputs.push(inp); d.setInput(0, inp); d.step(); }
  return { d, slip: timeslip(d.state.runners[0]), inputs, ticks: n, ap };
};
test('the autopilot is deterministic: the same seed gives the same run, tick for tick', () => {
  const a = drive(42), b = drive(42);
  assert.deepEqual(a.inputs, b.inputs); assert.equal(a.slip.quarter, b.slip.quarter); assert.equal(a.slip.reaction, b.slip.reaction);
  assert.notEqual(drive(43).slip.reaction, undefined);
});
test('it finishes a clean pass: no red light, no centre line, stops before the end of the strip, in a sane ET window', () => {
  const { spec, tune } = car();
  for (const seed of [1, 2, 3, 77, 1234, 99999]) {
    const { d, slip, ticks } = drive(seed), perfect = predictDrag(spec, tune, seed).slip;
    assert.equal(d.state.winner, 0, `clean pass for seed ${seed}: ${d.state.reason}`); assert.ok(!slip.foul && !slip.crossed && !slip.crashed && !slip.aborted);
    assert.ok(slip.reaction >= 0.05 && slip.reaction <= 0.25, `reaction ${slip.reaction}`);
    assert.ok(slip.quarter > perfect.quarter * 0.95 && slip.quarter < perfect.quarter * 1.12, `ET ${slip.quarter} against the perfect driver's ${perfect.quarter}`);
    assert.ok(slip.trap > 0 && ticks / 240 < 40, 'the run is over in a sane time');
  }
});
test('it works for a manual-shift tune and a nitro-by-hand tune through the same inputs', () => {
  const manual = drive(5, { shift: 'manual' }), hand = drive(5, { nitroGear: 0 });
  for (const r of [manual, hand]) { assert.equal(r.d.state.winner, 0, r.d.state.reason); assert.ok(r.slip.quarter < 12); }
  assert.ok(manual.inputs.some(i => i.shiftUp), 'it pressed shift up itself'); assert.ok(hand.slip.nitroUsed > 0 || car().spec.nitroSecs === 0, 'it fired the bottle');
});
test('it only returns what a player can: the DriverInput shape, one-tick presses (never held), and no chute before the line', () => {
  const { inputs, d } = drive(7);
  const keys = Object.keys(IDLE_INPUT).sort(); for (const i of inputs) assert.deepEqual(Object.keys(i).sort(), keys);
  for (const k of ['nitro', 'chute']) { let prev = false; for (const i of inputs.slice(0, -1)) { if (k === 'nitro') assert.ok(!(i.nitro && prev), 'nitro is a tap'); prev = i[k]; } }
  const firstChute = inputs.findIndex(i => i.chute); assert.ok(firstChute > 240 * 3, 'no chute (which would abort) before the launch'); assert.ok(d.state.runners[0].chute);
  assert.ok(inputs.every(i => i.throttle >= 0 && i.throttle <= 1 && Math.abs(i.steer) <= 1));
});
test('it waits for the tree: it never launches before the first amber and leaves after the predicted green', () => {
  const { d, inputs } = drive(11), r = d.state.runners[0];
  assert.ok(r.reaction > 0 && r.reaction < AUTOPILOT.reaction + 0.05, 'a steady reaction near its setting: ' + r.reaction);
  const ambers = []; const { spec, tune } = car(), e = createDrag({ seed: 11, entrants: [{ name: 'X', spec, tune, ai: null }] }), ap = createAutopilot();
  while (!e.state.green) { const inp = ap.decide(viewOf(e)); if (inp.launch) ambers.push(e.state.ambers); e.setInput(0, inp); e.step(); }
  assert.ok(ambers.length > 0 && ambers.every(a => a >= 1), 'it starts rolling in only after an amber is lit'); assert.equal(inputs.length > 0, true);
});
test('staging phases: it reads an engine-reported phase (backup, preStage) and falls back to the car otherwise', () => {
  const { spec, tune } = car(), d = createDrag({ seed: 1, entrants: [{ name: 'X', spec, tune, ai: null }] }), ap = createAutopilot(), v = viewOf(d);
  assert.equal(ap.decide({ ...v, stagePhase: 'backup' }).backUp, true); assert.equal(ap.decide({ ...v, stagePhase: 'preStage' }).launch, true);
  const burn = ap.decide({ ...v, stagePhase: 'burnout' }); assert.ok(burn.burnout && burn.throttle === 1);
  assert.equal(stagePhaseOf({ launched: false, rolling: false, deepStage: false, x: -0.45, burnout: false }), 'staged'); assert.equal(stagePhaseOf({ launched: true, rolling: false, deepStage: false, x: 10, burnout: false }), 'launched');
  assert.equal(steerFor({ v: 0, y: 1, psi: 0, yawRate: 0, gripLeft: 1 }), 0); assert.ok(steerFor({ v: 50, y: 1, psi: 0, yawRate: 0, gripLeft: 1 }) < 0, 'right of the middle: steer left');
  assert.equal(AUTOPILOT_CATEGORY, 'autopilot'); assert.equal(ap.category, 'autopilot'); assert.ok(DRAG.dt > 0);
});
test('the page offers DRIVER: MANUAL / AUTOPILOT and tags the result category', async () => {
  const { readFileSync } = await import('node:fs'), page = readFileSync(new URL('../src/drag/page.ts', import.meta.url), 'utf8');
  assert.match(page, /label: 'DRIVER'/); assert.match(page, /category/); assert.match(page, /autopilot\.decide/);
});
