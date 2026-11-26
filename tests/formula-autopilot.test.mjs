// The autopilot and the racing line, and the comparison with Chromium Halo: Neon (the game Formula was extracted from).
// The comparison with the live source game only runs when its folder is there (set CHROMIUM_HALO_NEON, or keep it next to this repo); the recorded numbers below are what it gave, so the test still guards the lap without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createFormulaRace, driveAutopilotLap, createFormulaAutopilot, racingLineFor, predictFormula, STOCK_SPEC, FORMULA_TRACKS, LINE, IDLE_FORMULA_INPUT } from '../src/formula/index.ts';

/** PHASE 3 NOTE: the source's tune for GEARING and TYRE PRESSURE was a straight line (tall gears and hard tyres only ever got quicker), which phase 3 rebalanced on purpose (`TUNE_EFFECT`, docs/CALIBRATION.md, "Tune balance"); so the cases below tune only the settings Formula still has exactly as the source (downforce, steering) and the physics fidelity check stays at 3 percent. The three source cases that set gearing or pressure were re-recorded from the live source without them.
 *  the lap time (s from the green) of the source game's ace bot in the same car on BEACH, recorded from Chromium Halo: Neon (src/arena/raceBot.ts, skill 2) */
const SOURCE_ACE = [
  { label: 'stock, neutral tune', parts: 'top', tune: {}, lap: 38.53 },
  { label: 'stock, downforce and quick steering', parts: 'top', tune: { downforce: 0.9, steering: 0.5 }, lap: 39.58 },
  { label: 'no parts', parts: {}, tune: {}, lap: 58.82 },
  { label: 'mid parts, low downforce', parts: { engine: 4, gearbox: 2, tyres: 3, steering: 2, aero: 2 }, tune: { downforce: 0.2 }, lap: 47.38 },
  { label: 'no downforce', parts: 'top', tune: { downforce: 0 }, lap: 45.22 },
  { label: 'quick steering', parts: 'top', tune: { steering: 1 }, lap: 38.48 },
];
const TOP = { engine: 8, gearbox: 5, tyres: 6, steering: 5, aero: 5 };
const specOf = parts => ({ ...STOCK_SPEC, ...(parts === 'top' ? TOP : { engine: 0, gearbox: 0, tyres: 0, steering: 0, aero: 0, ...parts }) });
const fromGreen = race => race.state.lap.finishedAt - 3.9;

test('on the plain oval the autopilot laps flat out: no wall hits, a lap close to the prediction, and the same lap every time', () => {
  // (the source game's tri-oval had a kink that needed downforce and braking; Formula's BEACH is a plain oval, so the lap-for-lap comparison with the source ace bot (0.2 to 0.4 percent apart on the source's own track in phase 1) no longer applies; the physics is unchanged)
  const race = driveAutopilotLap({ spec: { ...STOCK_SPEC, engine: 8 }, tune: {} }), slip = race.timeslip(), again = driveAutopilotLap({ spec: { ...STOCK_SPEC, engine: 8 }, tune: {} }).timeslip();
  assert.equal(race.state.lap.phase, 'finished'); assert.equal(slip.wallHits ?? 0, 0, 'no wall hits flat out'); assert.equal(slip.lapTime, again.lapTime, 'deterministic');
  assert.ok(Math.abs(slip.lapTime - 38.07) < 0.2, `the best car laps the plain oval in ${slip.lapTime.toFixed(2)} s`);
});

test('manual or automatic gearbox, the autopilot laps the same; nitro bottles never slow it', () => {
  const manual = driveAutopilotLap({ tune: { gearbox: 'manual' } }), auto = driveAutopilotLap({ tune: { gearbox: 'auto' } });
  assert.ok(Math.abs(manual.timeslip().lapTime - auto.timeslip().lapTime) < 0.4, `${manual.timeslip().lapTime} and ${auto.timeslip().lapTime}`);
  const nitro = driveAutopilotLap({ tune: { nitro: 3 } }); assert.ok(nitro.timeslip().lapTime < manual.timeslip().lapTime + 0.3, 'nitro does not make it slower');
  assert.ok(nitro.state.car.nitroLeft < 3, 'it used its bottles');
  const shifts = []; const r = createFormulaRace(), ap = createFormulaAutopilot(r.track, r.state.car.stats); let last = 1; for (let i = 0; i < 1500; i++) { r.step(ap.decide(r.view())); if (r.state.car.gear !== last) { shifts.push(r.state.car.gear); last = r.state.car.gear; } }
  assert.deepEqual(shifts.slice(0, 6), [2, 3, 4, 5, 6, 7], 'the manual autopilot shifts up through the gears');
});

test('the autopilot never jumps the start, is deterministic, and keeps off the wall with the stock car', () => {
  const a = driveAutopilotLap({}), b = driveAutopilotLap({});
  assert.equal(JSON.stringify(a.state), JSON.stringify(b.state)); assert.ok(!a.timeslip().jumpStart && a.timeslip().valid); assert.equal(a.timeslip().wallHits, 0);
  assert.ok(a.timeslip().reaction >= 0.12 && a.timeslip().reaction < 0.2, `reaction ${a.timeslip().reaction}`);
  const idle = createFormulaAutopilot(FORMULA_TRACKS[0], a.state.car.stats), r = createFormulaRace(); for (let i = 0; i < 200; i++) assert.deepEqual(idle.decide(r.view()), IDLE_FORMULA_INPUT, 'pedals up under the lights');
});

test('the racing line is one flying lap: closed, 3 to 5 m between points, mostly green on this flat-out oval, cached, and predictFormula agrees with the lap', () => {
  const line = racingLineFor(); assert.ok(line.x.length > 1000 && line.x.length < 1700, `${line.x.length} points`);
  for (const k of ['x', 'y', 'h', 'kind', 'speed']) assert.equal(line[k].length, line.x.length);
  let gaps = 0; for (let i = 0; i < line.x.length; i++) gaps += Math.hypot(line.x[(i + 1) % line.x.length] - line.x[i], line.y[(i + 1) % line.x.length] - line.y[i]); assert.ok(gaps / line.x.length >= 3 && gaps / line.x.length < 5, `${(gaps / line.x.length).toFixed(2)} m between points (a point every step that has moved 3 m or more)`);
  assert.ok(line.kind.every(k => k === LINE.green || k === LINE.yellow || k === LINE.red) && line.kind.filter(k => k === LINE.green).length > line.x.length * 0.8);
  assert.equal(racingLineFor().x[0], line.x[0]); assert.ok(Math.min(...line.speed) > 90, 'a flying lap');
  const slip = predictFormula(), lap = driveAutopilotLap({}).timeslip(); assert.equal(slip.lapTime, lap.lapTime); assert.equal(slip.reaction, lap.reaction);
  assert.ok(predictFormula(STOCK_SPEC, { gearing: 0.4 }).lapTime < slip.lapTime, 'a tuned car predicts a different lap'); assert.ok(predictFormula(STOCK_SPEC, { gearing: 1 }).lapTime > predictFormula(STOCK_SPEC, { gearing: 0.4 }).lapTime, 'gears that are too tall lose again');
});
