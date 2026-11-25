// The full staging sequence (water box, burnout, run-out, back up, pre-stage, stage, deep stage, roll out, launch) and the physics realism that came with it:
// the dark tree, red lights and over-staging, air density in the engine, trap speed over the last 66 ft, tire pressure with an optimum, weight transfer and anti-squat,
// the manual downshift, the ghost's staging path and a deterministic race.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_DRIVER, CONDITIONS, DRAG, GHOST, STAGE, STAGE_LABELS, airDensity, conditionsForSeed, conditionsText, createDrag, densityAltitudeOf, densityTorqueShare, ghostStagingPath, hotPressure, pressureGrip, stageLabel, stagingPlanFor, stagingPoseAt, timeslip } from '../src/drag/physics.ts';
import { DRAG_CARS, STOCK_PARTS, dragCarById } from '../src/drag/data.ts';
import { BOOST, TIRE, cleanTune, defaultTune, specFor } from '../src/drag/tune.ts';
import { drawProgress, drawTree, stagingPrompt } from '../src/drag/hud.ts';
import { createDragTopDown, puffNoise } from '../src/drag/topdown.ts';
import { DEFAULT_BINDS, BIND_ROWS } from '../src/options/model.ts';
import { readFileSync } from 'node:fs';

const neutral = { airC: CONDITIONS.refAirC, rho: CONDITIONS.rhoRef, trackC: CONDITIONS.trackGripRefC, grip: CONDITIONS.neutralGrip };
const car = dragCarById('streeter');
const mine = (partsOrSpec = STOCK_PARTS, tuneOver = {}, ai = null, name = 'YOU') => { const spec = specFor(car, partsOrSpec); return { name, spec, tune: cleanTune({ ...defaultTune(car), ...tuneOver }, car, spec), ai }; };
const full = o => createDrag({ conditions: neutral, ...o });

/** a sensible human: rolls to the water box, burns out, runs out past the tree, stops, backs up, creeps to the beam and launches on the green. Every option is a deliberate mistake or choice. */
function driver(d, r, o = {}) {
  const { burn = true, deep = false, launchEarly = false, creepGas = 0.06, runOutAt = 8, noLaunch = false } = o;
  if (r.launched) { d.setInput(0, { throttle: 1, launch: true, brake: r.finished, chute: r.finished }); return; }
  const brakeDistance = r.v * r.v / (2 * STAGE.brakeDecel), inp = { throttle: 0, burnout: false, brake: false, backUp: false, deepStage: false, launch: false, steer: 0 };
  if (r.stage === 'waterBoxApproach' || r.stage === 'burnout') {
    if (r.x < STAGE.waterBoxStart + 1) inp.throttle = 0.6; else if (burn && r.x < STAGE.waterBoxEnd + 4) { inp.throttle = 1; inp.burnout = true; } else inp.throttle = 0.75;
  } else if (r.stage === 'runOut') {
    if (r.x + brakeDistance < runOutAt) inp.throttle = 0.75; else if (r.v > STAGE.stopSpeed) inp.brake = true; else inp.backUp = true;
  } else if (r.stage === 'backup') {
    if (r.v < -STAGE.stopSpeed) { if (r.x - brakeDistance > -0.65) inp.backUp = true; else inp.brake = true; } else if (r.x > -0.6) inp.backUp = true; else inp.throttle = creepGas;
  } else if (r.stage === 'preStage') inp.throttle = creepGas;
  if (r.stage === 'staged' && deep) inp.deepStage = true;
  if (!noLaunch && (launchEarly ? (r.stage === 'staged' || r.stage === 'deepStaged') : d.state.green && (r.stage === 'staged' || r.stage === 'deepStaged' || r.stage === 'rolling'))) inp.launch = true;
  d.setInput(0, inp);
}
/** run a scripted race to its end, recording the stage changes (with the time) and the biggest jump the car made in one tick */
function drive(d, o = {}, limit = 240 * 150) {
  const r = d.state.runners[0], order = [], seen = []; let last = '', biggestJump = 0, n = 0;
  while (d.state.phase !== 'over' && n++ < limit) {
    driver(d, r, o); const x0 = r.x, was = r.launched; d.step(); if (!was) biggestJump = Math.max(biggestJump, Math.abs(r.x - x0));
    if (r.stage !== last) { order.push(r.stage); seen.push([r.stage, +d.state.t.toFixed(3)]); last = r.stage; }
  }
  return { order, seen, biggestJump, r };
}

test('the full sequence: water box, burnout, run-out, back up, pre-stage, staged, rolling, launched, with no teleports', () => {
  const d = full({ seed: 5, entrants: [mine()] }), out = drive(d);
  assert.deepEqual(out.order, ['waterBoxApproach', 'burnout', 'runOut', 'backup', 'preStage', 'staged', 'rolling', 'launched']);
  assert.ok(out.biggestJump < STAGE.rollMaxSpeed * DRAG.dt * 1.2 + 1e-6, `the car never jumps: the biggest step was ${out.biggestJump.toFixed(4)} m`);
  assert.ok(out.r.finished && !out.r.foul && out.r.reaction >= 0, 'a clean pass');
  assert.equal(d.state.reason, 'a clean run');
});

test('the deep stage is a creep from stage after a real stop, and the stage comes before it', () => {
  const d = full({ seed: 5, entrants: [mine()] }), out = drive(d, { deep: true });
  assert.deepEqual(out.order, ['waterBoxApproach', 'burnout', 'runOut', 'backup', 'preStage', 'staged', 'deepStaged', 'rolling', 'launched']);
  assert.equal(timeslip(out.r).deepStage, true); assert.ok(Math.abs(out.r.reaction - DRAG.deepStageRollout / DRAG.stageCreep) < 0.03, `a short rollout: ${out.r.reaction}`);
  assert.ok(STAGE.preStageRollout > DRAG.stageRollout && DRAG.stageRollout > DRAG.deepStageRollout && DRAG.deepStageRollout > STAGE.overstageLimit, 'three distinct beams and an over-stage limit');
});

test('the tree stays dark until final stage, then arms, and the seed sets the amber-to-green delay', () => {
  const d = full({ seed: 5, entrants: [mine()] }), r = d.state.runners[0], seenEvents = []; let darkTicks = 0, armedWhen = null;
  while (d.state.phase !== 'over' && d.state.t < 100) {
    driver(d, r); d.step(); for (const e of d.events) seenEvents.push([e.t, +d.state.t.toFixed(3)]);
    if (!d.state.armed) { darkTicks++; assert.equal(d.state.ambers, 0, 'no amber while staging'); assert.ok(!d.state.green); assert.equal(d.state.greenAt, Infinity); assert.ok(r.stage !== 'staged' || r.stagedFor < STAGE.armHold, `${r.stage}`); }
    else if (armedWhen === null) { armedWhen = d.state.t; assert.ok(r.stage === 'staged' || r.stage === 'deepStaged'); assert.ok(r.stagedFor >= STAGE.armHold - DRAG.dt, 'armed only after it held still in final stage'); }
  }
  assert.ok(darkTicks > 240 * 10, 'a long dark staging before the tree'); assert.ok(armedWhen !== null);
  const names = seenEvents.map(e => e[0]); assert.deepEqual(names.filter(n => n === 'amber' || n === 'green'), ['amber', 'amber', 'amber', 'green']);
  assert.ok(Math.abs(d.state.greenAt - (d.state.armedAt + d.state.treeDelay)) < 1e-9, 'green comes the seeded delay after the tree arms');
  assert.ok(d.state.treeDelay >= DRAG.green[0] && d.state.treeDelay <= DRAG.green[1]);
  const other = full({ seed: 6, entrants: [mine()] }); assert.notEqual(other.state.treeDelay, d.state.treeDelay, 'another seed, another delay');
});

test('foul: crossing the final beam before the green is a red light, with the tree still dark or lit; crossing it on the run-out is not', () => {
  const dark = full({ seed: 5, entrants: [mine()] }), a = dark.state.runners[0];
  while (a.stage !== 'preStage' && dark.state.t < 60) { driver(dark, a, { noLaunch: true }); dark.step(); }
  assert.equal(a.stage, 'preStage'); assert.ok(!dark.state.armed, 'the tree is dark');
  dark.setInput(0, { throttle: 0.2, launch: false, brake: false, backUp: false, burnout: false }); while (!a.launched && dark.state.t < 80) dark.step();
  assert.ok(a.launched && a.foul && a.reaction < 0, 'creeping across the beam with a dark tree is a red light'); assert.equal(a.reaction, -1);
  const lit = full({ seed: 5, entrants: [mine()] }), b = lit.state.runners[0], out = drive(lit, { launchEarly: true });
  assert.ok(b.foul && b.reaction < 0 && out.r.reaction < 0, 'rolling out before the green is a red light'); assert.match(lit.state.reason, /red light/); assert.equal(lit.state.winner, -1);
  const run = full({ seed: 5, entrants: [mine()] }), c = run.state.runners[0]; let crossedDuringRunOut = false;
  while (c.stage !== 'backup' && run.state.t < 60) { driver(run, c, { noLaunch: true }); run.step(); if (c.x > 0 && c.stage === 'runOut') crossedDuringRunOut = true; }
  assert.ok(crossedDuringRunOut && !c.foul && !c.launched, 'running out past the tree is not a foul');
  const abort = full({ seed: 5, entrants: [mine()] }), e = abort.state.runners[0];
  while (e.stage !== 'staged' && abort.state.t < 60) { driver(abort, e, { noLaunch: true }); abort.step(); }
  abort.setInput(0, { chute: true }); abort.step(); assert.ok(e.aborted && e.foul, 'a chute on the beams aborts the start');
});

test('over-staging: creeping too fast past the stage beam resets the stage bulb until the car backs out, and the tree stays dark', () => {
  const d = full({ seed: 5, entrants: [mine()] }), r = d.state.runners[0];
  while (r.stage !== 'preStage' && d.state.t < 60) { driver(d, r, { noLaunch: true }); d.step(); }
  assert.ok(r.preBulb && !r.stageBulb, 'only the pre-stage bulb in pre-stage');
  d.setInput(0, { throttle: 0.09, launch: false, burnout: false, brake: false, backUp: false, deepStage: false });      // 0.72 m/s: too fast for the trans-brake (0.5 m/s) to catch it in stage
  let sawStaged = false, steps = 0; while (!r.overstaged && !r.launched && steps++ < 2400) { if (r.x > -0.09) d.setInput(0, { throttle: 0, brake: true }); d.step(); sawStaged = sawStaged || r.stage === 'staged'; }
  assert.ok(r.overstaged && !r.launched, 'the car crept past the over-stage limit and the driver stopped it too late'); assert.ok(r.x >= -STAGE.overstageLimit && r.x < 0); assert.ok(!sawStaged || r.stage === 'preStage');
  d.setInput(0, { throttle: 0, brake: true }); for (let i = 0; i < 60; i++) d.step();
  assert.equal(r.stage, 'preStage'); assert.equal(stageLabel(r), 'OVER-STAGED'); assert.ok(!r.stageBulb, 'the stage bulb is out'); assert.ok(r.preBulb); assert.ok(!d.state.armed && d.state.ambers === 0, 'the tree never armed');
  for (let i = 0; i < 240 * 2; i++) d.step(); assert.ok(!d.state.armed, 'it stays dark however long the car sits over-staged');
  d.setInput(0, { brake: false, backUp: true }); while (r.x > -DRAG.stageRollout - 0.05 && d.state.t < 120) d.step(); d.setInput(0, { backUp: false, brake: true }); for (let i = 0; i < 120; i++) d.step();
  assert.ok(!r.overstaged, 'backing out past the stage beam clears the over-stage'); assert.ok(r.x < -DRAG.stageRollout);
  d.setInput(0, { brake: false, throttle: 0.06 }); let n = 0; while (r.stage !== 'staged' && n++ < 4000) d.step(); assert.equal(r.stage, 'staged', 'and it can stage again'); assert.ok(r.stageBulb);
});

test('an armed tree goes dark again if the car leaves final stage before the green', () => {
  const d = full({ seed: 5, entrants: [mine()] }), r = d.state.runners[0];
  while (!d.state.armed && d.state.t < 80) { driver(d, r, { noLaunch: true }); d.step(); } assert.ok(d.state.armed && d.state.greenAt < Infinity); const first = d.state.treeDelay;
  d.setInput(0, { backUp: true, throttle: 0 }); for (let i = 0; i < 120; i++) d.step();
  assert.ok(!d.state.armed && d.state.greenAt === Infinity && d.state.ambers === 0, 'backing out puts the tree out'); assert.ok(d.state.treeDelay >= DRAG.green[0] && d.state.treeDelay <= DRAG.green[1]); void first;
});

test('backing up is slow, with a reverse light, and shows its speed and distance to the pre-stage beam', () => {
  const d = full({ seed: 5, entrants: [mine()] }), r = d.state.runners[0]; let fastest = 0, lit = 0, reverseTicks = 0;
  while (r.stage !== 'preStage' && d.state.t < 80) { driver(d, r, { noLaunch: true }); d.step(); if (r.stage === 'backup') { fastest = Math.max(fastest, -r.v); if (r.reversing) lit++; if (r.v < -0.1) reverseTicks++; } }
  assert.ok(fastest > 1 && fastest <= STAGE.backupSpeed + 1e-9, `slow: ${fastest.toFixed(2)} m/s`); assert.ok(lit > 240 * 3, 'the reverse light stays on while reversing'); assert.ok(reverseTicks > 240 * 3, 'a back up takes seconds, not a teleport');
  const text = { launch: 'X', nitro: 'N', manual: false, gas: 'W', burnout: 'J', brake: 'S', chute: 'N', backUp: 'R' };
  r.stage = 'backup'; r.v = -1.5; r.x = 3; const shown = stagingPrompt(r, d.state, text); assert.equal(shown.title, 'BACK UP');
  assert.ok(shown.lines.some(l => /ROLLBACK 1\.5 M\/S\s+3\.80 M TO PRE-STAGE/.test(l[0])), shown.lines.map(l => l[0]).join(' | '));
});

test('the HUD names every stage and the tree draws a dark tree before staging and its bulbs after', () => {
  const d = full({ seed: 5, entrants: [mine(), mine(STOCK_PARTS, {}, AUTO_DRIVER, 'OTHER')] }), r = d.state.runners[0], keys = { launch: 'X', nitro: 'N', manual: false, gas: 'W', burnout: 'J', brake: 'S', chute: 'N', deepStage: 'H', backUp: 'R' };
  const expect = [['waterBoxApproach', 'WATER BOX'], ['burnout', 'BURNOUT'], ['runOut', 'RUN OUT'], ['backup', 'BACK UP'], ['preStage', 'PRE-STAGE'], ['staged', 'STAGED'], ['deepStaged', 'DEEP STAGED']];
  for (const [stage, label] of expect) { r.stage = stage; r.deepStage = stage === 'deepStaged'; assert.equal(STAGE_LABELS[stage], label); const rec = recorder(); drawProgress(rec.ctx, 1280, 720, d.state, 0, 1, keys); assert.ok(rec.texts.some(t => t.startsWith(label)), `${label}: ${rec.texts.join(' | ')}`); }
  const dark = recorder(); drawTree(dark.ctx, 1280, d.state, 1); assert.equal(dark.fills.length, 14, 'two lanes of seven bulbs'); assert.ok(dark.fills.every(f => f === 'rgba(255,255,255,0.1)'), 'every bulb is dark while nobody is staged');
  r.preBulb = r.stageBulb = true; d.state.ambers = 2; const lit = recorder(); drawTree(lit.ctx, 1280, d.state, 1); assert.equal(lit.fills.filter(f => f !== 'rgba(255,255,255,0.1)').length, 2 + 4, 'two stage bulbs and the lit ambers');
  r.stage = 'preStage'; r.overstaged = true; r.deepStage = false; assert.equal(stageLabel(r), 'OVER-STAGED');
});

test('a burnout is physical: it rolls, heats the slicks and lays rubber from slip over distance, and the water box makes the grip low', () => {
  const run = (startX, secs) => { const d = full({ seed: 1, entrants: [mine()] }), r = d.state.runners[0]; r.x = startX; d.setInput(0, { throttle: 1, burnout: true }); for (let i = 0; i < secs * 240; i++) d.step(); return r; };
  const wet = run(STAGE.waterBoxStart + 0.5, 1), dry = run(STAGE.waterBoxEnd + 1, 1);
  assert.ok(wet.wet > 0.5 && dry.wet === 0); assert.ok(dry.tireTemp > wet.tireTemp + 15, `dry burnout heats more: ${dry.tireTemp.toFixed(0)} vs ${wet.tireTemp.toFixed(0)} C`);
  assert.ok(dry.burnDistance > 1.5 && dry.burnDistance <= STAGE.burnoutSpeed, `1 s of burnout from rest is a couple of metres: ${dry.burnDistance.toFixed(2)}`);
  const long = run(STAGE.waterBoxEnd + 1, 5); assert.ok(Math.abs(long.v - STAGE.burnoutSpeed) < 0.1, 'it rolls at the burnout speed'); assert.ok(long.tireTemp > dry.tireTemp + 40, 'a longer burnout gets the tires hotter');
});

test('rolling a wet car straight out of the water box into a launch loses grip against a dry one', () => {
  const et = wet => { const d = createDrag({ seed: 1, conditions: neutral, quickStart: true, entrants: [mine(STOCK_PARTS, {}, { react: 0.1, spread: 0, shiftErr: 0, foul: 0 })] }), r = d.state.runners[0]; r.wet = wet; r.tireTemp = 95; while (d.state.phase !== 'over') d.step(); return r.marks.ft60; };
  assert.ok(et(1) > et(0) + 0.02, `wet slicks launch slower: ${et(1).toFixed(3)} vs ${et(0).toFixed(3)} s`);
});

test('air density reaches the engine: a thin or hot day costs a naturally aspirated engine torque, a blower makes part of it up (and heats the engine), and density altitude is shown', () => {
  assert.equal(densityTorqueShare(CONDITIONS.rhoRef), 1); assert.ok(densityTorqueShare(1.0) < 0.85 && densityTorqueShare(1.0) > 0.8);
  assert.ok(densityTorqueShare(1.0, 1, 0.3) > densityTorqueShare(1.0), 'boost makes up some'); assert.ok(densityTorqueShare(1.0, 1, 0.3) < 1, 'but not all'); assert.equal(densityTorqueShare(1.0, 1, 0), densityTorqueShare(1.0), 'no blower, no help');
  assert.equal(densityTorqueShare(1.3), densityTorqueShare(1.3, 1, 0.3), 'thick air gives a blower nothing to make up');
  assert.ok(Math.abs(densityAltitudeOf(CONDITIONS.isaRho)) < 1, 'the standard sea-level air is 0 m'); assert.ok(densityAltitudeOf(airDensity(40, 1500)) > densityAltitudeOf(airDensity(20, 1500)) && densityAltitudeOf(airDensity(20, 1500)) > 1500 - 1, 'hot air raises the density altitude above the altitude');
  assert.match(conditionsText(conditionsForSeed(3)), /DA -?\d+M/, 'the HUD text shows it');
  const quarter = (rho, parts, torque = 450) =>      // (a torque the tires can hold: a spinning car's ET jumps about with every small change)
     { const e = mine(parts); e.spec.torque = torque; const d = createDrag({ seed: 1, quickStart: true, conditions: { ...neutral, rho }, entrants: [{ ...e, ai: { react: 0.2, spread: 0, shiftErr: 0, foul: 0 } }] }); while (d.state.phase !== 'over') d.step(); return d.state.runners[0]; };
  const thick = quarter(1.25, {}), thin = quarter(1.0, {}); assert.ok(thin.marks.quarter > thick.marks.quarter + 0.2, `a thin day is slower for an NA engine: ${thick.marks.quarter.toFixed(2)} vs ${thin.marks.quarter.toFixed(2)} s`);
  const parts = { turbo: 6 }, boostedThick = quarter(1.25, parts), boostedThin = quarter(1.0, parts);
  assert.ok(boostedThin.marks.quarter - boostedThick.marks.quarter < thin.marks.quarter - thick.marks.quarter, 'the blower loses less to a thin day than the NA engine');
  assert.ok(boostedThin.enginePeakTemp > boostedThick.enginePeakTemp, 'and pays for it in engine heat');
  assert.ok(BOOST.densityCompensation > 0 && BOOST.densityCompensation < 1);
});

test('the trap speed is the average over the last 66 ft, from the trapStart mark to the finish', () => {
  assert.ok(Math.abs(DRAG.marks.trapStart - (DRAG.marks.quarter - DRAG.trapWindow)) < 1e-9); assert.ok(Math.abs(DRAG.trapWindow - 66 * 0.3048) < 1e-6);
  const d = createDrag({ seed: 1, quickStart: true, conditions: neutral, entrants: [mine(STOCK_PARTS, {}, { react: 0.2, spread: 0, shiftErr: 0, foul: 0 })] }), r = d.state.runners[0], track = [];
  while (d.state.phase !== 'over') { d.step(); track.push([d.state.t - r.launchT, r.x, r.v]); }
  assert.ok(r.marks.trapStart > r.marks.ft1000 && r.marks.trapStart < r.marks.quarter, 'the trap mark comes before the finish');
  const t0 = r.marks.trapStart, t1 = r.marks.quarter; assert.ok(Math.abs(r.trap / 3.6 - DRAG.trapWindow / (t1 - t0)) < 1e-9, 'trap = the 66 ft divided by the time it took');
  const at = x => { const i = track.findIndex(p => p[1] >= x), a = track[i - 1], b = track[i], f = (x - a[1]) / (b[1] - a[1]); return a[0] + f * (b[0] - a[0]); };
  const measured = DRAG.trapWindow / (at(DRAG.marks.quarter) - at(DRAG.marks.trapStart)) * 3.6; assert.ok(Math.abs(measured - r.trap) / r.trap < 0.002, `${measured.toFixed(2)} vs ${r.trap.toFixed(2)} km/h`);
  const atFinish = track.find(p => p[1] >= DRAG.marks.quarter)[2] * 3.6; assert.ok(Math.abs(r.trap - atFinish) > 0.5 && r.trap < atFinish, `an accelerating car's average (${r.trap.toFixed(1)}) is under its finish speed (${atFinish.toFixed(1)})`);
  assert.equal(timeslip(r).trapStart, r.marks.trapStart);
});

test('tire pressure has an optimum on the hot pressure: too low squirms and overheats, too high shrinks the patch, and the timeslip and HUD show hot and cold', () => {
  assert.ok(hotPressure(28, 100, 20) > 28 && hotPressure(28, 20, 20) === 28, 'tires gain pressure as they heat'); assert.equal(hotPressure(28, 5, 20), 28, 'never below the cold pressure');
  const peak = TIRE.optimalHotPsi + TIRE.psiWindow / 2; assert.equal(pressureGrip(TIRE.optimalHotPsi), pressureGrip(TIRE.optimalHotPsi + TIRE.psiWindow), 'a flat top');
  assert.ok(pressureGrip(peak) > pressureGrip(peak + 6) && pressureGrip(peak) > pressureGrip(peak - 6), 'it falls on both sides'); assert.ok(pressureGrip(peak - 6) < pressureGrip(peak - 3) && pressureGrip(peak + 6) < pressureGrip(peak + 3));
  assert.ok(pressureGrip(5) < pressureGrip(TIRE.optimalHotPsi), 'lower is NOT always better');
  const run = pressure => { const d = createDrag({ seed: 1, quickStart: true, conditions: neutral, entrants: [mine(STOCK_PARTS, { pressure }, { react: 0.1, spread: 0, shiftErr: 0, foul: 0 })] }), r = d.state.runners[0]; r.tireTemp = 95; while (d.state.phase !== 'over') d.step(); return r; };
  const low = run(13), good = run(21), high = run(36); assert.ok(good.marks.quarter < low.marks.quarter && good.marks.quarter < high.marks.quarter, `${low.marks.quarter.toFixed(2)} / ${good.marks.quarter.toFixed(2)} / ${high.marks.quarter.toFixed(2)} s`);
  assert.ok(low.tireTemp > good.tireTemp, 'an under-inflated tire runs hotter'); assert.ok(good.hotPsi > 21 && timeslip(good).hotPsi === good.hotPsi, 'the timeslip carries the hot pressure');
});

test('dynamic weight transfer loads the rear with acceleration, and anti-squat delivers it sooner on a stiff setup', () => {
  const at = (stiffness, seconds) => { const d = createDrag({ seed: 1, quickStart: true, conditions: neutral, entrants: [mine(STOCK_PARTS, { stiffness, wheelieBar: 0 }, { react: 0.1, spread: 0, shiftErr: 0, foul: 0 })] }), r = d.state.runners[0]; r.tireTemp = 95; while (d.state.t < d.state.greenAt + 0.1 + seconds) d.step(); return r; };
  const idleShare = createDrag({ seed: 1, quickStart: true, conditions: neutral, entrants: [mine()] }).state.runners[0].rearShare;
  const soft = at(0, 0.3), stiff = at(10, 0.3); assert.ok(soft.accel > 5, `it is accelerating hard: ${soft.accel.toFixed(1)} m/s2`); assert.ok(soft.rearShare > idleShare + 0.03, `the rear gains weight: ${idleShare.toFixed(3)} to ${soft.rearShare.toFixed(3)}`);
  assert.ok(stiff.rearShare > soft.rearShare, `anti-squat loads the rear sooner on the stiff setup: ${soft.rearShare.toFixed(3)} vs ${stiff.rearShare.toFixed(3)}`); assert.ok(soft.sprungTransfer < stiff.sprungTransfer + 0.05);
});

test('the manual downshift: a shift-down key drops a gear when the revs allow it and is refused when it would over-rev', () => {
  const d = createDrag({ seed: 2, quickStart: true, conditions: neutral, entrants: [mine(STOCK_PARTS, { shift: 'manual' })] }), r = d.state.runners[0], events = [];
  d.setInput(0, { throttle: 1 }); while (!d.state.green) d.step(); d.setInput(0, { launch: true });
  const tap = (key, ticks = 1) => { d.setInput(0, { [key]: true }); d.step(); events.push(...d.events); d.setInput(0, { [key]: false }); for (let i = 0; i < ticks; i++) { d.step(); events.push(...d.events); } };
  let m = 0; while (r.x < 20 && m++ < 240 * 20) d.step(); tap('shiftUp', 120); assert.equal(r.gear, 2); const g2 = r.gear;
  tap('shiftDown', 120); assert.equal(r.gear, g2 - 1, 'shifted down'); assert.ok(events.some(e => e.t === 'shift' && e.gear === 1), 'with a shift event');
  tap('shiftUp', 120); let n = 0; while (r.v < 50 && n++ < 240 * 30) d.step();
  const fast = r.gear; tap('shiftDown', 120); assert.equal(r.gear, fast, 'at speed the lower gear would over-rev: refused'); assert.ok(r.rpm < r.spec.redline + 1);
  const auto = createDrag({ seed: 2, quickStart: true, conditions: neutral, entrants: [mine(STOCK_PARTS, { shift: 'auto' })] }), ar = auto.state.runners[0]; auto.setInput(0, { throttle: 1, shiftDown: true }); for (let i = 0; i < 1200; i++) auto.step(); assert.equal(ar.gear, 1, 'the automatic ignores it');
  assert.ok('shiftDown' in DEFAULT_BINDS && 'backUp' in DEFAULT_BINDS && BIND_ROWS.some(r => r[0] === 'backUp'), 'both keys are rebindable actions');
});

test('the AI/ghost staging plan is deterministic, and the ghost path animates the whole procedure ending staged', () => {
  const a = ghostStagingPath(9, 1, false), b = ghostStagingPath(9, 1, false); assert.deepEqual(a, b); assert.deepEqual(stagingPlanFor(9, 1, AUTO_DRIVER), stagingPlanFor(9, 1, AUTO_DRIVER));
  assert.notDeepEqual(stagingPlanFor(9, 1, AUTO_DRIVER), stagingPlanFor(10, 1, AUTO_DRIVER), 'another seed, another run-out');
  const plan = stagingPlanFor(9, 1, AUTO_DRIVER); assert.ok(plan.runOutStop > STAGE.runOutPastTree - 1e-9 && plan.runOutStop < STAGE.runOutPastTree + STAGE.aiRunOutJitter + 1e-9); assert.ok(plan.backupStop < -DRAG.stageRollout && plan.backupStop > -STAGE.preStageRollout); assert.equal(stagingPlanFor(9, 1, { ...AUTO_DRIVER, deepStage: true }).deepStage, true);
  assert.ok(a.duration > 10 && a.duration < 40, `${a.duration} s`); const stages = [...new Set(a.samples.map(s => s.stage))];
  assert.deepEqual(stages, ['waterBoxApproach', 'burnout', 'runOut', 'backup', 'preStage', 'staged']);
  assert.ok(a.samples.some(s => s.burnout) && a.samples.some(s => s.reversing)); assert.ok(a.samples.some(s => s.v < -1), 'it really reverses');
  assert.ok(Math.abs(stagingPoseAt(a, 0).x - STAGE.startX) < 0.1); const end = stagingPoseAt(a, a.duration + 5); assert.ok(end.x >= -DRAG.stageRollout - 1e-6 && end.x < -DRAG.deepStageRollout && end.stage === 'staged', 'held in stage at the end');
  for (let i = 1; i < a.samples.length; i++) assert.ok(Math.abs(a.samples[i].x - a.samples[i - 1].x) < 0.5, 'no jumps'); assert.ok(a.samples[1].t - a.samples[0].t <= GHOST.step + 1e-6);
  assert.equal(ghostStagingPath(9, 1, true).samples.at(-1).stage, 'deepStaged');
});

test('a ghost car stages along its canned path, the tree waits for it, and the live car launches into a race with it', () => {
  const quarter = DRAG.marks.quarter, ghost = { car: 'streeter', name: 'LEADER', reaction: 0.15, marks: { quarter: 8 }, trap: 300, total: 8.15, samples: [{ t: -1, x: -0.45, y: 0, psi: 0, v: 0 }, { t: 0.15, x: 0, y: 0, psi: 0, v: 0 }, { t: 8, x: quarter, y: 0, psi: 0, v: 90 }] };
  const d = full({ seed: 9, entrants: [mine(), { ...mine(), name: 'LEADER', ghost }] }), r = d.state.runners[0], g = d.state.runners[1], path = ghostStagingPath(9, 1, false);
  let sawBurnout = false, sawReverse = false;
  while (d.state.t < path.duration - 0.2) { driver(d, r, { noLaunch: true }); d.step(); sawBurnout = sawBurnout || g.burnout; sawReverse = sawReverse || g.reversing; assert.ok(!d.state.armed); }
  assert.ok(sawBurnout && sawReverse, 'the ghost does the procedure'); assert.ok(Math.abs(g.x - stagingPoseAt(path, d.state.t).x) < 0.01);
  const out = drive(d); void out; assert.ok(d.state.armedAt >= path.duration - 1e-6, 'the tree armed after the ghost was staged'); assert.ok(g.finished || g.launched, 'the ghost raced'); assert.ok(r.finished && !r.foul);
});

test('the same seed is the same race, and a different seed is not', () => {
  const run = seed => { const d = full({ seed, conditions: undefined, entrants: [mine(), mine(STOCK_PARTS, {}, AUTO_DRIVER, 'AUTO')] }), out = drive(d); return { out, t: d.state.t, r: d.state.runners.map(r => [r.marks.quarter, r.trap, r.reaction, r.x, r.tireTemp, r.engineTemp]), seen: out.seen, armedAt: d.state.armedAt }; };
  const a = run(21), b = run(21), c = run(22); assert.deepEqual(a, b, 'identical'); assert.notDeepEqual(a.r, c.r); assert.notEqual(a.armedAt, c.armedAt);
  const auto = () => { const d = createDrag({ seed: 21, entrants: [mine(STOCK_PARTS, {}, AUTO_DRIVER, 'A')] }); while (d.state.phase !== 'over') d.step(); const r = d.state.runners[0]; return [r.marks.quarter, r.trap, r.reaction, d.state.armedAt]; };
  assert.deepEqual(auto(), auto()); const [et, , reaction] = auto(); assert.ok(et > 6 && reaction > 0.05, 'the autopilot makes a clean pass through the whole procedure');
});

test('the auto driver stages itself: it burns out, backs up, deep stages when asked, and trims its burnout when hot', () => {
  const deep = createDrag({ seed: 3, entrants: [mine(STOCK_PARTS, {}, { ...AUTO_DRIVER, deepStage: true })] }), r = deep.state.runners[0], order = []; while (deep.state.phase !== 'over') { deep.step(); if (r.stage !== order.at(-1)) order.push(r.stage); }
  assert.deepEqual(order, ['waterBoxApproach', 'burnout', 'runOut', 'backup', 'preStage', 'staged', 'deepStaged', 'rolling', 'launched']); assert.ok(r.finished && !r.foul);
  assert.ok(r.tireTemp > 0 && r.burnDistance > STAGE.waterBoxEnd - STAGE.waterBoxStart, 'it burned out through the water box and beyond');
});

test('the top-down smoke is seeded: the same race draws the same smoke twice, and nothing in the drawing uses Math.random', () => {
  assert.equal(puffNoise(3, 1), puffNoise(3, 1)); assert.notEqual(puffNoise(3, 1), puffNoise(4, 1)); for (let i = 0; i < 200; i++) { const v = puffNoise(i, 2); assert.ok(v >= 0 && v < 1); }
  const frames = () => { const d = createDrag({ seed: 4, entrants: [mine(STOCK_PARTS, {}, AUTO_DRIVER)] }), td = createDragTopDown(), rec = recorder(), r = d.state.runners[0]; const arcs = []; let k = 0;
    while (d.state.phase !== 'over' && k < 240 * 60) { d.step(); if (k++ % 6 === 0) { rec.arcs.length = 0; td.draw(rec.ctx, 1280, 720, d.state, 0, 0.025, k / 240); arcs.push(rec.arcs.map(a => a.map(n => +n.toFixed(2)).join(','))); } if (r.finished) break; }
    return arcs; };
  assert.deepEqual(frames(), frames(), 'identical frames');
  for (const f of ['topdown', 'hud', 'physics', 'tune', 'types']) assert.doesNotMatch(readFileSync(new URL(`../src/drag/${f}.ts`, import.meta.url), 'utf8'), /Math\.random/, `${f}.ts`);
});

function recorder() {
  const texts = [], fills = [], arcs = [], noop = () => {}; let fillStyle = '';
  const ctx = new Proxy({}, {
    get: (t, k) => {
      if (k === 'fillText') return s => { texts.push(String(s)); };
      if (k === 'arc') return (...args) => { arcs.push(args); fills.push(null); };
      if (k === 'fill') return () => { fills[fills.length - 1] = fillStyle; };
      if (k === 'measureText') return s => ({ width: String(s).length * 6 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
      return k in t ? t[k] : noop;
    },
    set: (t, k, v) => { t[k] = v; if (k === 'fillStyle') fillStyle = v; return true; },
  });
  return { ctx, texts, arcs, get fills() { return fills.filter(f => f !== null); } };
}
