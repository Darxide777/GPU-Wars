// Formula's lap simulation: the track, the car, the standing start, the lap timing and the timeslip. (Autopilot, ghost, tune and drawing have their own files.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormulaRace, stepLap, newLapState, driveStep, carStats, STOCK_SPEC, DEFAULT_FORMULA_TUNE, FORMULA_TRACKS, trackById, FORMULA_DT, LIGHTS, LAP, driveAutopilotLap, IDLE_FORMULA_INPUT } from '../src/formula/index.ts';
import { crossesGate, roadHit } from '../src/formula/road.ts';

const track = FORMULA_TRACKS[0];
const gas = { ...IDLE_FORMULA_INPUT, throttle: 1 };

test('BEACH is a banked oval built from data: about 3 miles, 7 gates, a standing start behind the line, and more tracks are just more data', () => {
  assert.equal(track.id, 'beach'); assert.equal(trackById('nope'), track, 'an unknown id falls back to the first track');
  assert.ok(Math.abs(track.length - 4828) < 15, `lap length ${track.length}`);
  assert.equal(track.gates.length, 7); assert.ok(track.road.bank && Math.max(...track.road.bank) > 0.5 && Math.min(...track.road.bank) >= 0, 'banked turns, flat straights');
  assert.equal(track.road.width, 24);
  const g = track.gates[0], d = Math.hypot(track.grid.x - (g.x1 + g.x2) / 2, track.grid.y - (g.y1 + g.y2) / 2);
  assert.ok(d > 4 && d < 8, `the grid is ${d.toFixed(1)} m from the start line`);
  assert.ok(!roadHit(track.road, track.grid.x, track.grid.y, 1.1), 'the grid is on the road');
  for (const t of FORMULA_TRACKS) assert.ok(t.gates.length >= 2 && t.w > 0 && t.h > 0);
});

test('the car is the source game\'s formula car: the stock top parts with the neutral tune give its exact numbers', () => {
  const s = carStats(STOCK_SPEC, DEFAULT_FORMULA_TUNE);
  // (read off Chromium Halo: Neon's raceCarStats with every part at its top level and DEFAULT_TUNE)
  assert.ok(Math.abs(s.vmax - 128.56116) < 1e-4); assert.ok(Math.abs(s.accel - 79.488) < 1e-6); assert.ok(Math.abs(s.grip - 22.2) < 1e-9); assert.ok(Math.abs(s.turn - 4.86) < 1e-9); assert.ok(Math.abs(s.aero - 0.8) < 1e-9);
});

test('the same car and the same inputs give the same lap, byte for byte, and driveStep never changes what it is given', () => {
  const run = () => { const r = createFormulaRace(); for (let i = 0; i < 1200; i++) r.step({ ...gas, steer: Math.sin(i / 40) * 0.3, shiftUp: i % 90 === 0 }); return JSON.stringify([r.state, r.trace()]); };
  assert.equal(run(), run());
  const car = newLapState(track, STOCK_SPEC, null).car, frozen = JSON.stringify(car), input = { ...gas, steer: 0.2 }, inputFrozen = JSON.stringify(input);
  const next = driveStep(car, input, track); assert.equal(JSON.stringify(car), frozen); assert.equal(JSON.stringify(input), inputFrozen); assert.notEqual(next, car);
  const state = newLapState(track, STOCK_SPEC, null), before = JSON.stringify(state); stepLap(state, gas); assert.equal(JSON.stringify(state), before, 'stepLap is pure too');
});

test('the start: three lights, held on the grid until the green, a jump start is flagged and the car does not move', () => {
  const r = createFormulaRace({ tune: { gearbox: 'auto' } }), seen = new Set(); let x0 = r.state.car.x, y0 = r.state.car.y;
  for (let i = 0; i < Math.round(LIGHTS.go / FORMULA_DT) - 2; i++) { r.step(gas); seen.add(r.view().lights); assert.ok(!r.view().green); }
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3], 'the lights come on one by one'); assert.equal(r.state.car.x, x0); assert.equal(r.state.car.y, y0); assert.equal(r.view().car.speed, 0, 'held on the grid');
  assert.ok(r.view().jumpStart, 'gas before the green is a jump start');
  while (!r.view().green) r.step(gas); r.step(gas); assert.equal(r.view().lights, 0, 'the lights go out at the green');
  for (let i = 0; i < 240; i++) r.step(gas); assert.ok(r.view().car.speed > 30, 'it drives after the green (the automatic gearbox shifts for it)');
  assert.ok(r.timeslip().jumpStart && !r.timeslip().valid, 'a jump start is never a valid lap');
});

test('a clean standing start: the reaction is the time from the green to the first gas, and the car starts from rest', () => {
  const r = createFormulaRace(); let started = false;
  for (let i = 0; i < 3000 && !r.over; i++) { const green = r.view().green, late = r.view().raceTime >= 0.25; assert.ok(!started || green); r.step(late ? gas : IDLE_FORMULA_INPUT); if (late) started = true; if (r.view().raceTime < 0.2) assert.equal(r.view().car.speed, 0, 'nothing moves before the gas'); }
  const s = r.timeslip(); assert.ok(!s.jumpStart); assert.ok(Math.abs(s.reaction - 0.25) < 0.03, `reaction ${s.reaction}`);
});

test('the lap is timed from the start line, with a split at every gate, and finishes after one lap', () => {
  const race = driveAutopilotLap({}), s = race.timeslip(), lap = race.state.lap;
  assert.ok(s.finished && s.valid, 'finished'); assert.equal(lap.phase, 'finished');
  assert.equal(s.splits.length, track.gates.length, 'a split at each gate, the last is the finish'); assert.equal(s.splits[s.splits.length - 1], s.lapTime);
  for (let i = 1; i < s.splits.length; i++) assert.ok(s.splits[i] > s.splits[i - 1], 'the splits rise');
  assert.ok(Math.abs(s.sectors.reduce((a, b) => a + b, 0) - s.lapTime) < 0.01, 'the sectors add up to the lap');
  assert.ok(s.launchTime > s.reaction && s.launchTime < 1.5, `from the green to the line ${s.launchTime}`);
  assert.ok(Math.abs(lap.finishedAt - LIGHTS.go - s.launchTime - s.lapTime) < 0.02, 'lap time is measured from the line, not the green');
  assert.ok(s.topSpeed > 400 && s.topSpeed < 520, `top speed ${s.topSpeed}`);
});

test('lap time sanity: a stock car laps the 3 mile oval in about 38 s, and weaker engines are slower', () => {
  const stock = driveAutopilotLap({}).timeslip().lapTime; assert.ok(stock > 37 && stock < 40, `stock lap ${stock}`);
  let last = stock; for (const engine of [6, 3, 0, -0.4]) { const t = driveAutopilotLap({ spec: { ...STOCK_SPEC, engine } }).timeslip().lapTime; assert.ok(t > last, `engine ${engine} lapped in ${t}, the stronger one in ${last}`); last = t; }
  assert.ok(last < 70, `even the weakest car laps in ${last}`);
});

test('the wall scrubs speed and is counted; the gates must be crossed in order', () => {
  const r = createFormulaRace(); for (let i = 0; i < 20; i++) r.step({}); while (!r.view().green) r.step({});
  for (let i = 0; i < 360; i++) r.step({ ...gas, steer: 1 }); // turning right at full lock on a straight: into the wall
  assert.ok(r.state.car.wallHits > 0, 'hit the wall'); assert.ok(r.view().car.speed < 128, 'and slower for it'); assert.ok(Math.hypot(r.state.car.x - track.grid.x, r.state.car.y - track.grid.y) < 900);
  const g = track.gates[3]; assert.ok(!crossesGate(g, g.x1 - 50, g.y1, g.x1 - 40, g.y1), 'a move that does not reach the gate is not a crossing');
  const mid = { x: (g.x1 + g.x2) / 2, y: (g.y1 + g.y2) / 2 }, ahead = { x: mid.x + Math.cos(g.a) * 5, y: mid.y + Math.sin(g.a) * 5 }, behind = { x: mid.x - Math.cos(g.a) * 5, y: mid.y - Math.sin(g.a) * 5 };
  assert.ok(crossesGate(g, behind.x, behind.y, ahead.x, ahead.y) && !crossesGate(g, ahead.x, ahead.y, behind.x, behind.y), 'a gate only counts the way you drive through it');
});

test('a car that never moves times out, and a finished car rolls out and then stands still', () => {
  const r = createFormulaRace(); for (let i = 0; i < Math.ceil((LIGHTS.go + LAP.maxSeconds + 2) / FORMULA_DT) && !r.over; i++) r.step({});
  assert.equal(r.state.lap.phase, 'timeout'); assert.ok(!r.timeslip().finished);
  const done = driveAutopilotLap({}); for (let i = 0; i < 600; i++) done.step({}); const a = JSON.stringify(done.state); done.step({}); assert.equal(JSON.stringify(done.state), a, 'frozen after the roll-out'); assert.ok(done.view().car.speed < 5, 'stopped');
});

test('missing or broken input fields never poison the physics', () => {
  const r = createFormulaRace(); while (!r.view().green) r.step({});
  for (let i = 0; i < 300; i++) r.step({ throttle: NaN, steer: undefined, brake: Infinity });
  const c = r.state.car; for (const k of ['x', 'y', 'a', 'vx', 'vy']) assert.ok(Number.isFinite(c[k]), k);
});

const PAGE_LAYER = ['page.ts', 'online.ts', 'model.ts'];
test('nothing in src/formula uses Math.random, the clock or the page: it is pure and deterministic (apart from the page layer), and it does not touch Drag or the backend', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('../src/formula/', import.meta.url);
  for (const f of readdirSync(dir)) {
    const code = readFileSync(new URL(f, dir), 'utf8').split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('/**')).join('\n');
    // page.ts, model.ts and online.ts are the page layer (phase 2: the clock, the leaderboard and the canvas are theirs); the simulation files stay pure
    assert.ok(!/Math\.random/.test(code), `${f} has no Math.random`);
    if (!PAGE_LAYER.includes(f)) assert.ok(!/Date\.now|performance\.now|new Date|localStorage|document\.|window\./.test(code), `${f} is pure`);
    if (f !== 'topdown.ts' && f !== 'hud.ts' && !PAGE_LAYER.includes(f)) assert.ok(!/CanvasRenderingContext2D/.test(code), `${f} draws nothing`);
    assert.ok(!/from '\.\.\/drag\/|from '\.\.\/\.\.\/backend/.test(code), `${f} does not import Drag or the backend`);
  }
});
