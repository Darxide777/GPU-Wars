// The drag engine (src/drag): the tree and red lights, the physics behaving like a car (parts, launch revs, tire pressure, gearing, nitro), manual and automatic shifting,
// the saved best-pass ghost, the timeslip, and tunes kept within what a car allows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGE, STAGE_LABELS, stageLabel, ghostStagingPath, stagingPoseAt, stagingPlanFor, densityAltitudeOf, densityTorqueShare, hotPressure, pressureGrip, CONDITIONS, WIND, WEATHER, GHOST, FUEL, RUBBER, TRACTION, airDensity, autoThrottle, betterDragGhost, bottlePressure, brakeFadeOf, boostLimitOf, boostRetardAt, boostRisk, chuteOpening, cleanDragGhost, clutchAfterRun, clutchBiteTime, clutchTorqueScale, clutchTorqueShare, conditionsForSeed, conditionsText, conditionsAt, forecastText, createDrag, createDragStrip, clearDragStrip, engineHotShare, engineTrim, fuelKg, fuelTorqueShare, ghostFromRunner, gearEfficiency, lateralShare, loadGrip, nitroShotGain, predictDrag, rubberAt, rubberShare, runnerMass, slipGrip, stageRolloutTime, staticRearShare, throttleOf, timeslip, trackGrip, tireTarget, wearGrip, windAt, weatherText, DRAG, SHUTDOWN, SUSP } from '../src/drag/physics.ts';
import { DRAG_CARS, PARTS, dragCarById } from '../src/drag/data.ts';
import { BOOST, CLUTCH, ENGINE, TURBO, limiterTorqueShare, specFor, cleanTune, defaultTune, torqueShape } from '../src/drag/tune.ts';
import { TUNE_HINTS, tuneHint } from '../src/drag/tune-help.ts';
import { drawLane, drawProgress, drawTach } from '../src/drag/hud.ts';

const perfect = { react: 0.2, spread: 0, shiftErr: 0, foul: 0 };
const OLD_STOCK_TORQUE = 650;
const neutral = { airC: CONDITIONS.refAirC, rho: CONDITIONS.rhoRef, trackC: CONDITIONS.trackGripRefC, grip: CONDITIONS.neutralGrip };
const calm = { ...neutral, headwind: 0, crosswind: 0, gust: 0, headPhase: 0, crossPhase: 0 };
const quick = o => createDrag({ quickStart: true, ...o });
const race = o => quick({ conditions: neutral, ...o });
const fullRace = o => createDrag({ conditions: neutral, ...o });
const entrant = (id, tune = {}, parts = {}, ai = perfect, name = id, torque = null) => { const car = dragCarById(id), spec = specFor(car, parts); if (torque !== null) spec.torque = torque; return { name, spec, tune: cleanTune({ ...defaultTune(car), ...tune }, car, spec), ai }; };
const runAll = d => { let n = 0; while (d.state.phase !== 'over' && n++ < 240 * 60) d.step(); return d; };
const rolloutTicks = () => Math.ceil(stageRolloutTime() / DRAG.dt) + 2;
/** the car with every part at this share of its top level */
const built = f => Object.fromEntries(PARTS.map(p => [p.id, Math.round(p.max * f)]).filter(([, n]) => n > 0));
const bestGhost = (total, quarter, car = 'streeter') => cleanDragGhost({ car, name: 'BEST PASS', reaction: +(total - quarter).toFixed(3), marks: { quarter }, trap: 181, samples: [{ t: 0, x: 0, y: 0, psi: 0, v: 0 }, { t: quarter, x: DRAG.marks.quarter, y: 0, psi: 0, v: 50 }], total });
const et = (id, tune, parts, torque = null) => runAll(race({ seed: 1, entrants: [entrant(id, tune, parts, perfect, id, torque)] })).state.runners[0].marks.quarter;
const clutchRun = (tune = {}, parts = {}, torque = null) => {
  const car = dragCarById('streeter'), spec = specFor(car, parts); if (torque !== null) spec.torque = torque;
  const d = race({ seed: 1, entrants: [{ name: 'YOU', spec, tune: cleanTune({ ...defaultTune(car), ...tune }, car, spec), ai: perfect }] }), r = d.state.runners[0];
  let minScale = 1;
  while (d.state.phase !== 'over') { d.step(); if (r.launched && r.clutchSlip > 0) minScale = Math.min(minScale, clutchTorqueScale(r)); }
  return { r, minScale };
};

test('the tree: three ambers half a second apart, then green; launching before green is a red light and loses', () => {
  const d = race({ seed: 4, entrants: [entrant('streeter', {}, {}, null, 'YOU'), entrant('streeter', {}, {}, { ...perfect, react: 0.5 }, 'OTHER')] }), seen = [];
  d.setInput(0, { throttle: 1 });
  while (!d.state.green) { d.step(); for (const e of d.events) seen.push([e.t + (e.n ?? ''), +d.state.t.toFixed(3)]); }
  assert.deepEqual(seen.map(e => e[0]), ['amber1', 'amber2', 'amber3', 'green']);
  assert.ok(Math.abs(seen[1][1] - seen[0][1] - DRAG.amberGap) < 0.01 && Math.abs(seen[3][1] - seen[2][1] - DRAG.amberGap) < 0.01, 'half a second apart');
  assert.ok(d.state.greenAt >= DRAG.green[0] && d.state.greenAt <= DRAG.green[1]);
  const early = race({ seed: 4, entrants: [entrant('streeter', {}, built(0.9), null, 'YOU'), entrant('streeter', {}, {}, { ...perfect, react: 0.6 }, 'OTHER')] });
  early.setInput(0, { throttle: 1 }); for (let i = 0; i < 240; i++) early.step(); early.setInput(0, { launch: true }); runAll(early);
  assert.ok(early.state.runners[0].foul && early.state.runners[0].reaction < 0); assert.equal(early.state.winner, 1, 'the much faster car still loses: red light'); assert.match(early.state.reason, /red light/);
});

test('staging: a launch rolls from the staging beam to the line, and the beam break gives the R/T and starts the ET', () => {
  const d = race({ seed: 4, entrants: [entrant('streeter', {}, {}, null, 'YOU')] }), r = d.state.runners[0], seen = [];
  const collect = () => { for (const e of d.events) seen.push(e.t); };
  d.setInput(0, { throttle: 1 }); while (!d.state.green) { d.step(); collect(); }
  assert.equal(r.x, -DRAG.stageRollout, 'staged behind the line'); assert.ok(!r.launched && !r.rolling);
  const greenAt = d.state.greenAt;
  d.setInput(0, { launch: true }); d.step(); collect();
  assert.ok(r.rolling && !r.launched && r.x < 0 && r.x > -DRAG.stageRollout, 'the car creeps to the beam');
  for (let i = 1; i < rolloutTicks(); i++) { d.step(); collect(); }
  assert.ok(r.launched && !r.rolling && r.x >= 0, 'the beam breaks at the line');
  assert.deepEqual(seen.filter(t => t === 'rollout' || t === 'launch'), ['rollout', 'launch']);
  assert.ok(Math.abs(r.launchT - (greenAt + stageRolloutTime())) < 0.02, `the beam breaks after the rollout: ${r.launchT.toFixed(3)} vs ${(greenAt + stageRolloutTime()).toFixed(3)}`);
  assert.ok(Math.abs(r.reaction - stageRolloutTime()) < 0.02, `the R/T is from the beam: ${r.reaction}`);
  runAll(d); const slip = timeslip(r); assert.equal(slip.reaction, r.reaction); assert.ok(Math.abs(slip.total - (slip.reaction + slip.quarter)) < 1e-9);
});

test('deep staging creeps nearer the line, shortens the R/T window, and the automatic driver uses it', () => {
  assert.ok(stageRolloutTime(true) < stageRolloutTime(), 'the deep rollout is shorter');
  const d = race({ seed: 4, entrants: [entrant('streeter', {}, {}, null, 'YOU')] }), r = d.state.runners[0];
  d.setInput(0, { throttle: 1, deepStage: true }); while (!d.state.green) d.step();
  assert.equal(r.deepStage, true, 'holding the deep-stage key keeps the deep position'); assert.equal(r.x, -DRAG.deepStageRollout);
  d.setInput(0, { launch: true }); d.step(); assert.ok(r.rolling && !r.launched && r.x > -DRAG.deepStageRollout);
  for (let i = 1; i < Math.ceil(stageRolloutTime(true) / DRAG.dt) + 2; i++) d.step();
  assert.ok(r.launched && r.x >= 0, 'the beam breaks from the deep spot');
  assert.ok(Math.abs(r.reaction - stageRolloutTime(true)) < 0.02, `the shorter rollout gives a shorter R/T: ${r.reaction}`);
  const slip = timeslip(r); assert.equal(slip.deepStage, true);
  const ai = race({ seed: 4, entrants: [entrant('streeter', {}, {}, { ...perfect, deepStage: true }, 'YOU')] }); runAll(ai);
  const ar = ai.state.runners[0], aslip = timeslip(ar);
  assert.equal(ar.deepStage, true, 'the autopilot deep-stages without a driver holding a key'); assert.equal(aslip.deepStage, true);
  const ghost = ghostFromRunner(ar, ai.state.greenAt, 'streeter'); assert.equal(ghost.deepStage, true, 'and the saved ghost keeps it');
});

test('a chute before the beam aborts the start: the run is disqualified and cannot be saved by a quicker car', () => {
  const d = race({ seed: 4, entrants: [entrant('streeter', {}, built(1), null, 'YOU'), entrant('streeter', {}, {}, { ...perfect, react: 0.4 }, 'OTHER')] }), r = d.state.runners[0], seen = [];
  d.setInput(0, { throttle: 1 }); for (let i = 0; i < 240; i++) d.step();
  d.setInput(0, { chute: true }); d.step(); for (const e of d.events) seen.push(e.t);
  assert.ok(r.aborted && r.foul && r.stopped && r.chute && !r.launched);
  assert.ok(seen.includes('abort'), 'the abort is announced');
  runAll(d);
  assert.equal(d.state.winner, 1, 'the other car wins'); assert.match(d.state.reason, /aborted the start/);
  const slip = timeslip(r); assert.equal(slip.aborted, true); assert.equal(slip.reaction, null); assert.equal(slip.total, undefined); assert.ok(!r.finished);

  const rolling = race({ seed: 4, entrants: [entrant('streeter', {}, {}, null, 'YOU')] }), rr = rolling.state.runners[0];
  while (!rolling.state.green) rolling.step();
  rolling.setInput(0, { throttle: 1, launch: true }); rolling.step();
  assert.ok(rr.rolling && !rr.launched);
  rolling.setInput(0, { chute: true }); rolling.step();
  assert.ok(rr.aborted && !rr.launched, 'a chute during the rollout is also an abort');
});

test('it is a car: one dragster, slow stock and a top fuel monster fully built; more parts are quicker, and every part helps', () => {
  assert.equal(DRAG_CARS.length, 1, 'one car, upgraded');
  const stock = et('streeter'), times = [0.25, 0.5, 0.75, 1].map(f => et('streeter', {}, built(f)));
  assert.ok(stock > 12.5 && stock < 15.5, `stock ${stock.toFixed(2)} s`);   assert.ok(times[3] > 6.5 && times[3] < 8, `fully built ${times[3].toFixed(2)} s`);
  for (let i = 0; i < times.length; i++) assert.ok(times[i] < (i ? times[i - 1] : stock), JSON.stringify([stock, ...times]));
  const maxed = Object.fromEntries(PARTS.map(p => [p.id, p.max])); assert.ok(et('streeter', { nitroGear: 1, nitroShot: 0.6 }, maxed) < stock - 4, 'fully built is seconds quicker');
  const gripped = et('streeter', {}, { tires: 6 }); assert.ok(stock > gripped + 0.02, 'tires help');
  for (const p of PARTS.filter(x => x.id !== 'tires')) { const tune = p.id === 'nitro' ? { nitroGear: 1 } : {}; assert.ok(et('streeter', tune, { tires: 6, [p.id]: p.max }) < gripped - 0.02, `${p.id} helps with grip`); }
});

test('the launch: revs too low bog, too high spin the tires; somewhere in the middle is quickest. Hard tires spin, and holding the gas on the line raises the revs to the launch revs', () => {
  const t = l => runAll(race({ seed: 1, entrants: [entrant('streeter', { launchRpm: l }, {}, perfect, 'streeter', OLD_STOCK_TORQUE)] })).state.runners[0].marks.ft60;
  const low = t(1400), mid = t(1800), high = t(5000); assert.ok(mid < low && mid < high, `60 ft (the sweet spot moved down a little with weight transfer): ${low.toFixed(3)} / ${mid.toFixed(3)} / ${high.toFixed(3)}`);
  assert.ok(et('streeter', { pressure: 38, launchRpm: 2600 }, {}, OLD_STOCK_TORQUE) > et('streeter', { pressure: 28, launchRpm: 2600 }, {}, OLD_STOCK_TORQUE) + 0.3, 'hard tires lose time to wheelspin');
  const d = race({ seed: 1, entrants: [entrant('streeter', { launchRpm: 4000 }, {}, null)] }); d.setInput(0, { throttle: 1 }); for (let i = 0; i < 240; i++) d.step(); assert.equal(Math.round(d.state.runners[0].rpm), 4000, 'held at the launch revs');
  d.setInput(0, { throttle: 0 }); for (let i = 0; i < 240; i++) d.step(); assert.equal(Math.round(d.state.runners[0].rpm), d.state.runners[0].spec.idle, 'back to idle off the gas');
});

test('the timeslip keeps the wheelspin seconds from the run and the prediction', () => {
  const d = race({ seed: 1, entrants: [entrant('streeter', { launchRpm: 7000, pressure: 38 }, {}, null)] }), r = d.state.runners[0];
  d.setInput(0, { throttle: 1 }); while (!d.state.green) d.step(); r.tireTemp = DRAG.tire.ambient; d.setInput(0, { launch: true }); runAll(d); const slip = timeslip(r);
  assert.ok(r.spinTime > 0, 'the cold high launch spun'); assert.equal(slip.spin, r.spinTime);
  const car = dragCarById('streeter'), spec = specFor(car, {}), tune = cleanTune({ ...defaultTune(car), launchRpm: 7000, pressure: 38 }, car, spec), p = predictDrag(spec, tune, 1, neutral);
  assert.equal(p.slip.spin, p.spin);
});

test('the timeslip reports the run-out brake, chute and rear weight the runner held', () => {
  const d = runAll(race({ seed: 1, entrants: [entrant('streeter', {}, built(1), perfect, 'YOU')] })), r = d.state.runners[0], s = timeslip(r);
  assert.ok(r.stopped && !r.crashed, 'the automatic driver stops the car');
  assert.equal(s.brakeTemp, r.brakeTemp); assert.equal(s.brakeFade, r.brakeFade);
  assert.equal(s.chuteOpen, r.chuteOpen); assert.equal(s.rearShare, r.rearShare);
  assert.ok((s.brakeTemp ?? 0) > neutral.airC, 'the brakes got hot');
  assert.ok((s.brakeFade ?? 0) >= SHUTDOWN.brakeFadeMin && (s.brakeFade ?? 1) <= 1, `braking left: ${s.brakeFade}`);
  assert.ok((s.chuteOpen ?? 0) > 0.9, `the chute opened: ${s.chuteOpen}`);
  assert.ok((s.rearShare ?? 0) > 0 && (s.rearShare ?? 1) <= 1, `rear weight: ${s.rearShare}`);
});

test('fuel burns with engine work and a low tank lightens the car without breaking the tune', () => {
  const e = entrant('streeter'), spec = e.spec, tune = e.tune, d = race({ seed: 1, entrants: [{ ...e, fuel: FUEL.capacity }] }), r = d.state.runners[0];
  assert.equal(r.fuel, FUEL.capacity); assert.equal(r.fuelUsed, 0);
  assert.equal(runnerMass(r), spec.mass + tune.ballast + DRAG.driver, 'a full tank is the tuned weight, not extra weight');
  assert.equal(staticRearShare(spec, tune, FUEL.capacity), staticRearShare(spec, tune), 'a full tank keeps the old rear weight');
  const lowFuel = fuelKg(0.25), low = { ...r, fuel: lowFuel };
  assert.ok(lowFuel < FUEL.capacity); assert.ok(runnerMass(low) < runnerMass(r));
  assert.ok(staticRearShare(spec, tune, lowFuel) < staticRearShare(spec, tune, FUEL.capacity));
  assert.ok(fuelTorqueShare(low) < fuelTorqueShare(r));
  runAll(d); const s = timeslip(r);
  assert.ok(s.fuelUsed > 0.5, `the engine burned fuel: ${s.fuelUsed}`);
  assert.ok(s.fuelLeft < FUEL.capacity && s.fuelLeft >= FUEL.reserve, `fuel left: ${s.fuelLeft}`);
  assert.equal(s.fuelLeft, r.fuel); assert.equal(s.fuelUsed, r.fuelUsed);
  const missing = race({ seed: 1, entrants: [entrant('streeter')] });
  assert.equal(missing.state.runners[0].fuel, FUEL.capacity, 'an old caller defaults to a full tank');
});

test('the auto driver trims a low tank and finishes straight at every fuel load', () => {
  for (const share of [0.25, 0.5, 1]) {
    const kg = fuelKg(share), d = race({ seed: 6, entrants: [{ ...entrant('streeter', {}, built(1), AUTO_DRIVER), fuel: kg }] }), r = d.state.runners[0];
    assert.equal(r.fuel, kg); runAll(d);
    assert.ok(r.finished, `${share}: the auto driver finished`);
    assert.ok(!r.foul && !r.crossed && !r.crashed, `${share}: no foul, cross or crash`);
    assert.ok(Math.abs(r.y) < 0.8, `${share}: stayed in the lane at y=${r.y}`);
    assert.ok(r.fuelUsed > 0.5, `${share}: burned ${r.fuelUsed} kg`);
  }
});

test('the tune prediction runs at the chosen fuel load instead of assuming a full tank', () => {
  const car = dragCarById('streeter'), spec = specFor(car, built(1)), tune = cleanTune(defaultTune(car), car, spec);
  const full = predictDrag(spec, tune, 1, neutral, FUEL.capacity), low = predictDrag(spec, tune, 1, neutral, fuelKg(0.25));
  assert.ok(low.slip.fuelLeft < full.slip.fuelLeft, `${low.slip.fuelLeft} < ${full.slip.fuelLeft}`);
  assert.ok(low.slip.fuelUsed > 0, `burned ${low.slip.fuelUsed} kg`);
  assert.notEqual(low.slip.quarter, full.slip.quarter, 'the load changes the predicted run');
});

test('tire temperature: cold tires grip less, a warmed car launches harder, and wheelspin heats them', () => {
  const at = temp => { const d = race({ seed: 1, entrants: [entrant('streeter', {}, {}, perfect, 'streeter', OLD_STOCK_TORQUE)] }), r = d.state.runners[0]; r.plan.burnout = 0; r.tireTemp = temp; return runAll(d).state.runners[0]; };
  const cold = at(DRAG.tire.ambient), warm = at((DRAG.tire.windowLo + DRAG.tire.windowHi) / 2);
  assert.ok(warm.marks.ft60 < cold.marks.ft60, `60 ft: cold ${cold.marks.ft60.toFixed(3)} s, warm ${warm.marks.ft60.toFixed(3)} s`);
  assert.ok(warm.marks.quarter < cold.marks.quarter, `1/4: cold ${cold.marks.quarter.toFixed(3)} s, warm ${warm.marks.quarter.toFixed(3)} s`);
  const s = race({ seed: 1, entrants: [entrant('streeter', { launchRpm: 7000, pressure: 38 }, {}, null, 'YOU')] }), sr = s.state.runners[0];
  s.setInput(0, { throttle: 1 }); while (!s.state.green) s.step();
  sr.tireTemp = DRAG.tire.ambient; const before = sr.tireTemp; s.setInput(0, { launch: true });
  let spun = false; for (let i = 0; i < 120; i++) { s.step(); spun = spun || sr.spin || sr.spinL || sr.spinR; }
  assert.ok(spun, 'the launch spins the tires'); assert.ok(sr.tireTemp > before + 1, `wheelspin heats them: ${before.toFixed(1)} to ${sr.tireTemp.toFixed(1)} C`);
});

test('each rear slick keeps its own temperature and slip wear, and worn rubber loses grip', () => {
  const d = race({ seed: 1, entrants: [entrant('streeter', {}, {}, null)] }), r = d.state.runners[0];
  assert.equal(r.tires.length, 2);
  assert.equal(r.tireTemp, (r.tires[0].temp + r.tires[1].temp) / 2);
  r.tireTemp = 100; d.step();
  assert.ok(Math.abs(r.tires[0].temp - r.tires[1].temp) < 1e-9, 'writing the shared temperature moves both slicks');
  assert.ok(Math.abs(r.tires[0].temp - 100) < 1, 'and warms them both');
  assert.equal(wearGrip(0), 1);
  assert.ok(Math.abs(wearGrip(1) - DRAG.tire.wornGrip) < 1e-9, 'a worn slick keeps only the last of its grip');
  assert.equal(wearGrip(DRAG.tire.wearGripFrom), 1, 'a launch inside the wear window keeps full grip');
  assert.ok(wearGrip(0.5) > DRAG.tire.wornGrip && wearGrip(0.5) < 1, 'wear fades grip between new and worn');
  const hard = runAll(race({ seed: 1, entrants: [entrant('streeter', { pressure: 38 }, {}, perfect, 'streeter', OLD_STOCK_TORQUE)] })).state.runners[0], [left, right] = hard.tires;
  assert.ok(right.wear > 0.02, `the slipping right slick wears during a hard launch: ${right.wear.toFixed(3)}`);
  assert.ok(right.wear > left.wear * 1.5, `the right slick wears more than the left: ${right.wear.toFixed(3)} vs ${left.wear.toFixed(3)}`);
  assert.ok(Math.abs(hard.tireTemp - (left.temp + right.temp) / 2) < 1e-9, 'the shared reading stays their mean');
  const slip = timeslip(hard);
  assert.equal(slip.tireWearL, left.wear); assert.equal(slip.tireWearR, right.wear);
});

test('the clutch: each gear has its own efficiency, long slip heats it and fades torque, and a better clutch runs cooler and wears less', () => {
  const car = dragCarById('streeter'), spec = specFor(car, {});
  assert.deepEqual(spec.gearEff, car.gearEff, 'the car gives each gear its own efficiency');
  for (let g = 1; g <= car.gears.length; g++) assert.equal(gearEfficiency(spec, g), car.gearEff[g - 1]);
  const extra = specFor(car, { gearbox: 2 }); assert.equal(extra.gearEff.length, car.gears.length + 1); assert.equal(extra.gearEff.at(-1), car.gearEff.at(-1), 'an added gear inherits the top gear');
  assert.equal(gearEfficiency({ ...spec, gearEff: [] }, 2), DRAG.eff, 'a missing efficiency falls back to the old constant');

  const slick = { tires: 6, weight: 6 }, launch = { launchAggression: 0, launchRpm: 7000 };
  const stock = clutchRun(launch, slick, OLD_STOCK_TORQUE), strong = clutchRun(launch, { ...slick, clutch: 4 }, OLD_STOCK_TORQUE);
  assert.ok(stock.r.clutchSlip > 0.3 && stock.r.clutchPeakTemp > CLUTCH.fadeFrom + 20, `long slip heats it: ${stock.r.clutchSlip.toFixed(2)} s, ${Math.round(stock.r.clutchPeakTemp)} C`);
  assert.ok(stock.minScale < 0.99, `hot clutch fades torque: ${stock.minScale.toFixed(3)}`);
  assert.ok(strong.r.clutchPeakTemp < stock.r.clutchPeakTemp - 20, `the clutch part runs cooler: ${Math.round(stock.r.clutchPeakTemp)} C vs ${Math.round(strong.r.clutchPeakTemp)} C`);
  assert.ok(clutchAfterRun(strong.r) > clutchAfterRun(stock.r) + 0.01, 'and wears less over the run');

  const two = runAll(race({ seed: 2, entrants: [entrant('streeter', launch, slick, perfect, 'YOU'), entrant('streeter', launch, slick, { ...perfect, react: 0.3 }, 'OTHER')] }));
  for (const r of two.state.runners) assert.ok(r.clutchSlip > 0 && r.clutchPeakTemp > neutral.airC, `${r.name} has clutch heat and wear state too`);
});

test('the clutch locks on a closing rev gap before full bite, wheelspin keeps it slipping, and the locked plates cost a little torque', () => {
  const car = dragCarById('streeter'), spec = specFor(car, {}); spec.torque = OLD_STOCK_TORQUE;
  const launch = over => {
    const d = race({ seed: 1, entrants: [{ name: 'YOU', spec, tune: cleanTune({ ...defaultTune(car), ...over }, car, spec), ai: perfect }] }), r = d.state.runners[0];
    let lockAt = null, spinningAtLock = false;
    while (d.state.phase !== 'over' && d.state.t < 20) {
      d.step();
      if (lockAt === null && r.clutchLocked) { lockAt = d.state.t - r.launchT; spinningAtLock = r.spin; }
    }
    return { r, lockAt, spinningAtLock, bite: clutchBiteTime(r.tune) };
  };
  const hooked = launch({ launchRpm: 1600 }), spinning = launch({});
  assert.ok(hooked.lockAt !== null && hooked.lockAt < hooked.bite - DRAG.dt, `the rev gap locks early: ${hooked.lockAt?.toFixed(3)} vs ${hooked.bite.toFixed(3)} s`);
  assert.equal(hooked.spinningAtLock, false, 'with the wheels hooked up');
  assert.ok(hooked.r.clutchSlip < hooked.bite, `slip stops after lock: ${hooked.r.clutchSlip.toFixed(3)} s`);
  assert.ok(spinning.lockAt !== null && spinning.lockAt >= spinning.bite, `wheelspin slips to full bite: ${spinning.lockAt?.toFixed(3)} vs ${spinning.bite.toFixed(3)} s`);
  assert.equal(spinning.spinningAtLock, true, 'with the tires still spinning');
  const locked = hooked.r.marks.quarter, drag = CLUTCH.lockedDrag;
  try {
    CLUTCH.lockedDrag = 0;
    const free = launch({ launchRpm: 1600 }).r.marks.quarter;
    assert.ok(locked > free + 0.005, `post-lock drag costs time: ${locked.toFixed(3)} vs ${free.toFixed(3)} s`);
  } finally { CLUTCH.lockedDrag = drag; }
});

test('a tune sets how hard the clutch is let out, and a bad setting is repaired', () => {
  const car = dragCarById('streeter'), spec = specFor(car, {});
  const gentle = cleanTune({ ...defaultTune(car), launchAggression: 0 }, car, spec), harsh = cleanTune({ ...defaultTune(car), launchAggression: 10 }, car, spec);
  assert.ok(clutchBiteTime(gentle) > clutchBiteTime(harsh), 'a gentle clutch takes longer to bite');
  assert.ok(clutchTorqueShare(gentle, spec) < clutchTorqueShare(harsh, spec), 'and passes less torque while it slips');
  assert.equal(cleanTune({}, car, spec).launchAggression, CLUTCH.aggressionDefault);
  assert.equal(cleanTune({}, car, spec).boostLimit, BOOST.defaultLimit, 'an old tune without a boost limit needs no migration');
  assert.equal(cleanTune({ launchAggression: -99 }, car, spec).launchAggression, CLUTCH.aggressionMin);
  assert.equal(cleanTune({ launchAggression: 99 }, car, spec).launchAggression, CLUTCH.aggressionMax);
});

test('conditions come from the race seed, and both cars race in the same ones', () => {
  const a = conditionsForSeed(7); assert.deepEqual(a, conditionsForSeed(7), 'the same seed gives the same conditions');
  const d = quick({ seed: 7, entrants: [entrant('streeter'), entrant('streeter', {}, {}, perfect, 'OTHER')] });
  assert.deepEqual(d.state.conditions, a); assert.equal(d.state.runners[0].tireTemp, a.airC); assert.equal(d.state.runners[1].tireTemp, a.airC);
  assert.notDeepEqual(quick({ seed: 8, entrants: [entrant('streeter')] }).state.conditions, a);
});

test('conditions: hotter air is less dense and slower, and a grippier surface is faster', () => {
  const c = CONDITIONS, base = conditionsForSeed(11), parts = built(0.9);
  assert.ok(airDensity(c.airRange[0]) > airDensity(c.refAirC) && airDensity(c.refAirC) > airDensity(c.airRange[1]), 'density falls as air warms');
  const etFor = (cond, torque = null) => runAll(race({ seed: 11, entrants: [entrant('streeter', {}, parts, perfect, 'streeter', torque)], conditions: cond })).state.runners[0].marks.quarter;      // (a car that is not traction-limited, torque 650: thin air takes its torque as well as its drag)
  const cold = etFor({ ...base, airC: c.airRange[0], rho: airDensity(c.airRange[0], base.altitude) }, OLD_STOCK_TORQUE), hot = etFor({ ...base, airC: c.airRange[1], rho: airDensity(c.airRange[1], base.altitude) }, OLD_STOCK_TORQUE);
  assert.ok(hot > cold + 0.02, `hot air is slower: ${cold.toFixed(3)} vs ${hot.toFixed(3)} s`);
  const low = etFor({ ...base, grip: c.gripClamp[0] }), high = etFor({ ...base, grip: c.gripClamp[1] });
  assert.ok(high < low - 0.02, `more grip is faster: ${low.toFixed(3)} vs ${high.toFixed(3)} s`);
  assert.ok(trackGrip(c.trackRange[1]) < trackGrip(c.trackRange[0]), 'a hot strip loses grip');
  assert.ok(tireTarget({ ...base, trackC: c.trackRange[1] }) > tireTarget({ ...base, trackC: c.trackRange[0] }), 'a hot strip warms the tires');
});

test('barometric altitude: a seeded high strip is thinner and quicker, and the auto driver still tracks', () => {
  const c = CONDITIONS, base = conditionsForSeed(21), parts = built(1);
  assert.ok(base.altitude >= c.altitudeRange[0] && base.altitude <= c.altitudeRange[1], `the seeded altitude is inside its range: ${base.altitude}`);
  assert.equal(airDensity(c.refAirC, 0), c.rhoRef, 'sea level at the reference air keeps the old density');
  assert.ok(airDensity(c.refAirC, c.altitudeRange[1]) < c.rhoRef * 0.9, 'a high strip is thinner');
  assert.equal(airDensity(c.refAirC, -99), c.rhoRef, 'below sea level clamps');
  assert.equal(airDensity(c.refAirC, c.altitudeRange[1] + 99), airDensity(c.refAirC, c.altitudeRange[1]), 'above the range clamps');
  assert.match(conditionsText(base), new RegExp(`ALT ${Math.round(base.altitude)}M`));
  const at = altitude => ({ ...base, altitude, rho: airDensity(base.airC, altitude) });
  const etFor = altitude => runAll(quick({ seed: 21, conditions: at(altitude), entrants: [entrant('streeter', {}, parts)] })).state.runners[0];
  const low = etFor(0), high = etFor(c.altitudeRange[1]);
  assert.ok(low.marks.quarter > high.marks.quarter + 0.01, `thin air is quicker: ${low.marks.quarter.toFixed(3)} vs ${high.marks.quarter.toFixed(3)} s`);
  assert.ok(high.trap > low.trap, 'and it traps faster');
  for (const altitude of [0, c.altitudeRange[1] / 2, c.altitudeRange[1]]) {
    const d = runAll(quick({ seed: 21, conditions: at(altitude), entrants: [entrant('streeter', {}, parts, perfect, 'AUTO')] })), r = d.state.runners[0];
    assert.ok(r.finished && !r.foul && !r.crossed && !r.crashed, `${altitude} m: the auto driver finishes a clean pass`);
    assert.ok(Math.abs(r.y) < 0.8, `${altitude} m: and holds its lane (${r.y.toFixed(2)} m)`);
  }
});

test('weather is a seeded forecast that moves the air, track and grip during the run', () => {
  const a = conditionsForSeed(8); assert.deepEqual(a, conditionsForSeed(8)); assert.notDeepEqual(a, conditionsForSeed(9));
  for (const [k, [lo, hi]] of [['air', WEATHER.airRange], ['track', WEATHER.trackRange], ['grip', WEATHER.gripRange]]) assert.ok(a.weather[k] >= lo && a.weather[k] <= hi, `${k} is inside its range`);
  assert.strictEqual(conditionsAt(6, calm), calm, 'old races with no front stay as they were');
  const start = conditionsAt(0, a), mid = conditionsAt(WEATHER.span / 2, a), end = conditionsAt(WEATHER.span, a);
  assert.equal(start.airC, a.airC); assert.equal(start.trackC, a.trackC); assert.equal(start.grip, a.grip);
  assert.ok(mid.airC < a.airC - 1 && mid.trackC > a.trackC + 0.5 && mid.grip > a.grip + 0.01, `a front is moving by mid run: ${JSON.stringify([mid.airC, mid.trackC, mid.grip])}`);
  assert.ok(end.airC < a.airC - 2.5 && end.trackC > a.trackC + 1 && end.grip > a.grip + 0.03, `and reaches most of the forecast: ${JSON.stringify([end.airC, end.trackC, end.grip])}`);
  assert.equal(end.altitude, a.altitude, 'and the strip keeps its altitude');
  assert.equal(end.rho, airDensity(end.airC, end.altitude), 'the air density follows the new air at that altitude');
  assert.ok(end.grip <= CONDITIONS.gripClamp[1] && end.grip >= CONDITIONS.gripClamp[0], 'grip stays clamped');
  assert.equal(weatherText(calm), ''); assert.match(forecastText(a), / FRONT AIR -\d+C TRACK \+\d+C GRIP \+\d\.\d\d/, 'the forecast names the front');
});

test('the weather front is one shared field and a cooler, grippier one runs quicker', () => {
  const d = quick({ seed: 8, entrants: [entrant('streeter'), entrant('streeter', {}, {}, perfect, 'OTHER')] }), forecast = d.state.conditions;
  assert.equal(d.state.runners[0].tireTemp, forecast.airC); assert.equal(d.state.runners[1].tireTemp, forecast.airC);
  for (let i = 0; i < 240 * 6; i++) d.step();
  assert.ok(Math.abs(d.state.weather.airC - forecast.airC) > 1, 'the front has moved both cars');
  assert.equal(d.state.weather.weather, forecast.weather, 'and they share a single forecast');
  const etFor = weather => runAll(quick({ seed: 1, conditions: { ...calm, weather }, entrants: [entrant('streeter', { launchRpm: 5000 })] })).state.runners[0].marks;
  const grippy = etFor({ air: WEATHER.airRange[0], track: WEATHER.trackRange[0], grip: WEATHER.gripRange[1], phase: 0 });
  const slippery = etFor({ air: WEATHER.airRange[1], track: WEATHER.trackRange[1], grip: WEATHER.gripRange[0], phase: 0 });
  assert.ok(grippy.quarter < slippery.quarter - 0.03, `grippy ${grippy.quarter.toFixed(3)} vs slippery ${slippery.quarter.toFixed(3)} s`);
  assert.ok(grippy.ft60 < slippery.ft60 - 0.03, `and it leaves harder: ${grippy.ft60.toFixed(3)} vs ${slippery.ft60.toFixed(3)} s`);
});

test('wind is a seeded field: headwind, crosswind and gusts stay with the seed and move with distance and time', () => {
  const a = conditionsForSeed(7); assert.deepEqual(a, conditionsForSeed(7)); assert.notDeepEqual(a, conditionsForSeed(8));
  assert.ok(a.headwind >= WIND.headRange[0] && a.headwind <= WIND.headRange[1]);
  assert.ok(a.crosswind >= WIND.crossRange[0] && a.crosswind <= WIND.crossRange[1]);
  assert.ok(a.gust >= WIND.gustRange[0] && a.gust <= WIND.gustRange[1]);
  assert.ok(a.headPhase >= 0 && a.headPhase <= Math.PI * 2 && a.crossPhase >= 0 && a.crossPhase <= Math.PI * 2);
  assert.deepEqual(windAt(20, 3, neutral), { head: 0, cross: 0 }, 'older races with no wind stay calm');
  assert.deepEqual(windAt(20, 3, calm), { head: 0, cross: 0 });
  const field = { ...calm, headwind: 4, crosswind: -2, gust: 1.2, headPhase: 0.7, crossPhase: 1.3 }, here = windAt(0, 0, field), later = windAt(70, 15, field);
  assert.deepEqual(here, windAt(0, 0, field));
  assert.ok(Math.abs(here.head - later.head) > 0.2 && Math.abs(here.cross - later.cross) > 0.4, 'gusts vary down the strip and over the run');
  assert.ok(Math.abs(here.head - field.headwind) <= field.gust + 1e-9 && Math.abs(here.cross - field.crosswind) <= field.gust + 1e-9, 'and stay within the forecast gust');
  assert.match(conditionsText(field), /WIND H\+4\.0 X-2\.0 G1\.2/, 'the forecast names the wind');
});

test('wind on the strip: a headwind slows a run, a tailwind speeds it, and the run-out stops short or long', () => {
  const etFor = conditions => runAll(quick({ seed: 1, conditions, entrants: [entrant('streeter')] })).state.runners[0].marks.quarter;
  const still = etFor(calm), against = etFor({ ...calm, headwind: WIND.headRange[1] }), withIt = etFor({ ...calm, headwind: WIND.headRange[0] });
  assert.ok(against > still + 0.15 && withIt < still - 0.1, `head ${against.toFixed(3)} calm ${still.toFixed(3)} tail ${withIt.toFixed(3)}`);
  const stop = headwind => {
    const d = quick({ seed: 1, conditions: { ...calm, headwind }, entrants: [entrant('streeter', {}, built(1), null, 'YOU')] }), r = d.state.runners[0];
    while (d.state.phase !== 'over') { d.setInput(0, { throttle: r.finished ? 0 : 1, launch: d.state.green && !r.finished, brake: r.finished, chute: r.finished, steer: 0 }); d.step(); }
    return r;
  };
  const headStop = stop(WIND.headRange[1]), calmStop = stop(0), tailStop = stop(WIND.headRange[0]);
  for (const r of [headStop, calmStop, tailStop]) assert.ok(r.stopped && !r.crashed);
  assert.ok(headStop.x < calmStop.x - 5 && tailStop.x > calmStop.x + 5, `stopping ${headStop.x.toFixed(1)} / ${calmStop.x.toFixed(1)} / ${tailStop.x.toFixed(1)} m`);
});

test('a crosswind pushes an unsteered car across while the autopilot holds its lane in a seeded wind', () => {
  const drift = (cross, auto) => {
    const d = quick({ seed: 1, conditions: { ...calm, crosswind: cross }, entrants: [{ ...entrant('streeter'), ai: auto ? perfect : null }] }), r = d.state.runners[0];
    while (d.state.phase !== 'over' && d.state.t < 7) { if (!auto) d.setInput(0, { throttle: 1, launch: d.state.green, steer: 0 }); d.step(); }
    return r;
  };
  const left = drift(-WIND.crossRange[1], false), right = drift(WIND.crossRange[1], false);
  assert.ok(right.y > left.y + 0.5 && right.psi > left.psi + 0.02, `wind from the left drifts right: ${left.y.toFixed(2)} / ${right.y.toFixed(2)} m`);
  for (const seed of [1, 2, 3, 4, 5]) {
    const d = runAll(quick({ seed, entrants: [entrant('streeter'), entrant('streeter', {}, {}, perfect, 'OTHER')] }));
    for (const r of d.state.runners) assert.ok(!r.crossed && Math.abs(r.y) < 0.8, `seed ${seed}: an autopilot stays in its lane in the wind (${r.y.toFixed(2)} m)`);
  }
});

/** a car in the water box, ready to burn out */
const inWaterBox = (id = 'streeter', ai = null) => { const d = fullRace({ seed: 1, entrants: [entrant(id, {}, {}, ai, 'YOU')] }), r = d.state.runners[0]; r.x = STAGE.waterBoxStart + 0.5; return { d, r }; };

test('a burnout rolls the car forward: slip over distance heats the slicks and lays rubber on the dry strip, and the water box leaves them wet and low on grip', () => {
  const { d, r } = inWaterBox();
  d.setInput(0, { throttle: 1, burnout: true }); for (let i = 0; i < 240; i++) d.step();
  assert.equal(r.stage, 'burnout'); assert.ok(r.burnout, 'the burnout is reported'); assert.ok(r.x > STAGE.waterBoxStart + 2 && r.v > 0, 'it rolls forward, it is not held on the spot');
  assert.ok(r.wet > 0.5 && r.tireTemp < DRAG.tire.windowLo, `a wet burnout makes little heat: ${r.tireTemp.toFixed(1)} C, wet ${r.wet.toFixed(2)}`);
  const wetGrip = (1 - STAGE.wetGripLoss * r.wet); assert.ok(wetGrip < 1, 'wet slicks have less grip');
  const slow = inWaterBox(); slow.r.x = STAGE.waterBoxEnd + 1; slow.d.setInput(0, { throttle: 1, burnout: true }); for (let i = 0; i < 240; i++) slow.d.step();
  assert.ok(slow.r.tireTemp > r.tireTemp + 20, `the same second on the dry strip heats the tires much more: ${slow.r.tireTemp.toFixed(1)} vs ${r.tireTemp.toFixed(1)} C`);
  const before = r.burnDistance; d.setInput(0, { throttle: 0, burnout: false }); d.step(); assert.equal(r.stage, 'runOut', 'lifting ends the burnout: the run-out'); assert.ok(r.burnDistance === before);
});

test('burnouts across the line lay rubber on the strip for the session, wheelspin lays more, and that rubber gives grip to the next launch', () => {
  const strip = createDragStrip(2), burn = fullRace({ seed: 1, strip, entrants: [entrant('streeter', {}, {}, null, 'YOU')] }), br = burn.state.runners[0]; br.x = STAGE.waterBoxEnd;
  assert.equal(rubberAt(strip, 0, 0, RUBBER.cell), 0, 'a fresh strip has no laid rubber');
  burn.setInput(0, { throttle: 1, burnout: true }); for (let i = 0; i < 240 * 16 && br.x < 20; i++) burn.step();
  assert.ok(br.x >= 20, 'it burned out across the line'); assert.ok(rubberAt(strip, 0, 0, RUBBER.cell) > 0.5, 'the burnout lays rubber past the line'); assert.ok(rubberShare(strip, 0) > 0.5);
  const wet = createDragStrip(2), wr = fullRace({ seed: 1, strip: wet, entrants: [entrant('streeter', {}, {}, null, 'YOU')] }).state.runners[0]; void wr;
  const spinStrip = createDragStrip(2), spin = race({ seed: 1, strip: spinStrip, entrants: [entrant('streeter', { launchRpm: 7000, pressure: 38 }, {}, null, 'YOU')] });
  spin.setInput(0, { throttle: 1 }); while (!spin.state.green) spin.step(); spin.setInput(0, { launch: true });
  const sr = spin.state.runners[0]; let spun = false; for (let i = 0; i < 120; i++) { spin.step(); spun = spun || sr.spin || sr.spinL || sr.spinR; }
  assert.ok(spun, 'the test launch spins'); assert.ok(rubberShare(spinStrip, 0) > 0, 'and the spin lays rubber');
  const benchmark = s => { const d = race({ seed: 1, strip: s, entrants: [entrant('streeter', {}, built(1), { ...perfect, react: 0.1 }, 'YOU')] }); d.state.runners[0].plan.burnout = 0; return runAll(d).state.runners[0]; };
  const sticky = benchmark(strip), dry = benchmark(createDragStrip(2));
  assert.ok(sticky.marks.ft60 < dry.marks.ft60, `laid rubber helps the launch: ${sticky.marks.ft60.toFixed(3)} vs ${dry.marks.ft60.toFixed(3)} s`);
  const before = strip.version; clearDragStrip(strip);
  assert.equal(rubberShare(strip, 0), 0, 'clearing the strip removes it'); assert.ok(strip.version > before, 'the views see the change');
});

test('gearing and nitro: a final drive far too tall is slow, a bottle of nitro (fired in second) is quicker, and a bigger shot quicker still', () => {
  assert.ok(et('streeter', { final: 2.3 }, {}, OLD_STOCK_TORQUE) > et('streeter', {}, {}, OLD_STOCK_TORQUE) + 0.3, 'too tall');
  const base = et('streeter', {}, {}, OLD_STOCK_TORQUE), shot = et('streeter', { nitroGear: 2, nitroShot: 0.2 }, { nitro: 2 }, OLD_STOCK_TORQUE), big = et('streeter', { nitroGear: 2, nitroShot: 0.35 }, { nitro: 2 }, OLD_STOCK_TORQUE);
  assert.ok(shot < base - 0.1 && big < shot, `${base.toFixed(2)} / ${shot.toFixed(2)} / ${big.toFixed(2)}`);
});

test('the bottle: pressure follows the charge and temperature, the shot tapers as it empties, and the timeslip keeps what fired', () => {
  const car = dragCarById('streeter'), spec = specFor(car, { nitro: 4 }), tune = cleanTune({ ...defaultTune(car), nitroGear: 2, nitroShot: 0.3 }, car, spec);
  const d = race({ seed: 1, entrants: [{ name: 'YOU', spec, tune, ai: perfect }] }), r = d.state.runners[0];
  const full = { ...r, nitroLeft: spec.nitroSecs, nitroTemp: 0 };
  assert.ok(bottlePressure(full) < 1 && bottlePressure({ ...full, nitroTemp: 40 }) > bottlePressure(full), 'a warm bottle is a higher-pressure bottle');
  assert.equal(nitroShotGain({ ...full, nitroTemp: neutral.airC }), 0.3, 'a full bottle gives the tune shot');
  const empty = { ...full, nitroLeft: spec.nitroSecs * 0.02, nitroTemp: neutral.airC };
  assert.ok(bottlePressure(empty) < 0.1 && nitroShotGain(empty) < 0.3 * 0.7, `the shot tapers near empty: ${nitroShotGain(empty).toFixed(3)}`);
  runAll(d);
  const slip = timeslip(r);
  assert.ok((slip.nitroUsed ?? 0) > 0 && (slip.nitroPeakGain ?? 0) > 0.25, `the automatic driver fired a real shot: ${JSON.stringify(slip)}`);
  assert.equal(slip.nitroPressure, 0, 'the bottle is empty at the end'); assert.ok((slip.nitroTemp ?? 0) > neutral.airC, 'firing warms the bottle');
});

test('the predicted timeslip shows the bottle\'s worth and its cost: a small shot helps, an overshot one spins and loses', () => {
  const car = dragCarById('streeter'), small = specFor(car, { nitro: 2, tires: 6, weight: 6 }), smallTune = cleanTune({ ...defaultTune(car), nitroGear: 2, nitroShot: 0.25 }, car, small);
  const helped = predictDrag(small, smallTune, 1, calm), helpedDry = predictDrag({ ...small, nitroSecs: 0, nitroMax: 0 }, smallTune, 1, calm);
  assert.ok(helped.nitroDelta < 0 && Math.abs((helped.nitroDelta ?? 0) - ((helped.slip.quarter ?? 0) - (helpedDry.slip.quarter ?? 0))) < 1e-9, `the delta is with minus without: ${helped.nitroDelta}`);
  assert.ok((helped.slip.nitroUsed ?? 0) > 0 && (helped.slip.nitroPeakGain ?? 0) > 0, 'the predicted slip keeps the shot');
  const wild = specFor(car, { nitro: 4 }), wildTune = cleanTune({ ...defaultTune(car), nitroGear: 2, nitroShot: 0.35 }, car, wild);
  const hurt = predictDrag(wild, wildTune, 1, calm), hurtDry = predictDrag({ ...wild, nitroSecs: 0, nitroMax: 0 }, wildTune, 1, calm);
  assert.ok((hurt.nitroDelta ?? 0) > 0 && hurt.spin > hurtDry.spin + 1, `a big shot is reported as a loss through wheelspin: ${hurt.nitroDelta}`);
});

test('shifting by hand: no shifts and it sits on the limiter in first; good shifts are about as quick as the automatic', () => {
  const manual = shiftAt => {
    const d = race({ seed: 2, entrants: [entrant('streeter', { shift: 'manual' }, {}, null, 'YOU', OLD_STOCK_TORQUE)] }), r = d.state.runners[0]; d.setInput(0, { throttle: 1 });
    while (d.state.phase !== 'over' && d.state.t < 40) { if (d.state.green && !r.launched) d.setInput(0, { launch: true }); d.setInput(0, { shiftUp: shiftAt !== null && r.rpm >= shiftAt && r.shiftT <= 0 && !r.prev.shiftUp }); d.step(); }
    return { r, d };
  };
  const shiftAt = defaultTune(dragCarById('streeter')).shiftRpm, none = manual(null), shifted = manual(shiftAt); assert.equal(none.r.gear, 1); assert.ok(!none.r.finished || none.r.trap < shifted.r.trap - 50, `stuck in first sits on the limiter: ${none.r.trap} vs ${shifted.r.trap} km/h`);
  const autoRace = race({ seed: 2, entrants: [entrant('streeter', {}, {}, { ...perfect }, 'YOU', OLD_STOCK_TORQUE)] }); autoRace.state.runners[0].plan.burnout = 0;
  const good = manual(shiftAt), auto = runAll(autoRace).state.runners[0];
  assert.equal(good.r.gear, auto.gear, 'the same gears as the automatic'); assert.ok(Math.abs(good.r.marks.quarter - auto.marks.quarter) < 0.25, `${good.r.marks.quarter.toFixed(2)} vs ${auto.marks.quarter.toFixed(2)}`);
});

test('shift quality: a hot spinning manual shift can miss and add penalty, while auto driver stays clean', () => {
  let missed = null;
  for (let seed = 1; seed < 60; seed++) {
    const d = race({ seed, entrants: [entrant('streeter', { shift: 'manual' }, {}, null, 'YOU', OLD_STOCK_TORQUE)] }), r = d.state.runners[0];
    d.setInput(0, { throttle: 1 });
    while (d.state.phase !== 'over' && d.state.t < 40) {
      if (d.state.green && !r.launched) d.setInput(0, { launch: true });
      if (r.launched && r.gear === 1) { r.clutchTemp = 500; r.spin = true; r.clutchSlip = 1; }
      d.setInput(0, { shiftUp: r.gear === 1 && r.rpm >= 6200 && r.shiftT <= 0 && !r.prev.shiftUp });
      d.step();
      if (r.shiftMissed || r.shiftPenalty > 0) { missed = r; break; }
      if (r.gear >= 2) break;
    }
    if (missed) break;
  }
  assert.ok(missed, 'a hot spinning manual shift can miss');
  assert.ok(missed.shiftPenalty > 0 || missed.shiftMissed, 'missed shift applies penalty');
  const auto = race({ seed: 2, entrants: [entrant('streeter', {}, {}, { ...perfect }, 'AI', OLD_STOCK_TORQUE)] });
  auto.state.runners[0].plan.burnout = 0;
  runAll(auto);
  const ar = auto.state.runners[0];
  assert.equal(ar.shiftMissed, false);
  assert.equal(ar.shiftPenalty, 0);
});

test('a race: the same seed is the same race, the better reaction wins between equal cars, and the timeslip is in order', () => {
  const run = seed => runAll(race({ seed, entrants: [entrant('streeter', {}, {}, { ...perfect, react: 0.15 }, 'A', OLD_STOCK_TORQUE), entrant('streeter', {}, {}, { ...perfect, react: 0.35 }, 'B', OLD_STOCK_TORQUE)] }));
  const a = run(9), b = run(9); assert.deepEqual(a.state.runners.map(timeslip), b.state.runners.map(timeslip)); assert.equal(a.state.winner, 0); assert.match(a.state.reason, /first across/);
  const s = timeslip(a.state.runners[0]); assert.ok(s.ft60 < s.ft330 && s.ft330 < s.eighth && s.eighth < s.ft1000 && s.ft1000 < s.quarter); assert.ok(s.trap > 100 && s.trap < 400); assert.ok(Math.abs(s.total - (s.reaction + s.quarter)) < 1e-9); assert.ok(s.clutchTemp !== undefined && s.clutchCondition !== undefined, 'the slip reports the clutch too');
});

test('a clean pass saves a ghost whose samples run from green, and a foul cannot be saved', () => {
  const d = runAll(race({ seed: 1, entrants: [entrant('streeter', {}, built(1), perfect, 'YOU')] })), r = d.state.runners[0], g = ghostFromRunner(r, d.state.greenAt, 'streeter');
  assert.ok(g, 'a clean run is saved'); assert.equal(g.name, 'BEST PASS'); assert.equal(g.car, 'streeter'); assert.ok(g.samples.length > 100);
  const first = g.samples[0], rawFirst = r.trace[0]; assert.equal(first.t, +(rawFirst.t - d.state.greenAt).toFixed(3)); assert.equal(first.x, +rawFirst.x.toFixed(3));
  assert.ok(g.samples.every(s => s.t >= -GHOST.maxTime && s.t <= GHOST.maxTime && s.x >= -20 && s.x <= 780), 'the saved path is within the strip');
  for (const bad of [{ foul: true }, { crossed: true }, { aborted: true }, { crashed: true }, { reaction: -0.1 }, { finished: false }]) assert.equal(ghostFromRunner({ ...r, ...bad }, d.state.greenAt, 'streeter'), null, JSON.stringify(bad));
});

test('a saved ghost is repaired before replay: bad samples are dropped, values clamped, and a ghost with no quarter is discarded', () => {
  const g = cleanDragGhost({ car: 'streeter', name: 'BEST PASS', reaction: 0.2, marks: { quarter: 12.5, ft60: NaN, ft330: -2 }, trap: 999, total: 'x', samples: [{ t: 'x', x: 0 }, { t: 1, x: 500, y: 99, psi: 9, v: 900 }, { t: 0.95, x: 4, y: -9, psi: -2, v: -5 }] });
  assert.ok(g); assert.deepEqual(g.samples.map(s => s.t), [0.95, 1]);
  assert.deepEqual(g.samples[1], { t: 1, x: 500, y: 4, psi: 1, v: 200 });
  assert.deepEqual(g.marks, { quarter: 12.5 }); assert.equal(g.trap, 500); assert.equal(g.total, 12.7, 'a missing total comes from the reaction and quarter');
  assert.equal(cleanDragGhost({ marks: { quarter: 12 }, samples: [{ t: 0, x: 0 }] }), null);
  assert.equal(cleanDragGhost({ marks: { ft60: 2 }, samples: [{ t: 0 }, { t: 1 }] }), null);
});

test('the best pass is the lower total, with the lower quarter mile as the tie-break', () => {
  const first = bestGhost(13.1, 12.9), slower = bestGhost(13.3, 13.1), faster = bestGhost(12.9, 12.7), tie = bestGhost(13.1, 12.8);
  assert.ok(betterDragGhost(null, first)); assert.equal(betterDragGhost(first, null), false);
  assert.ok(betterDragGhost(first, faster)); assert.equal(betterDragGhost(first, slower), false);
  assert.ok(betterDragGhost(first, tie), 'the same total with a lower ET wins'); assert.equal(betterDragGhost(tie, first), false, 'a higher ET with the same total does not');
  assert.equal(betterDragGhost(first, bestGhost(13.1, 12.9)), false, 'an identical pass does not replace the ghost');
});

test('a saved ghost replays its samples relative to green without driving a second car', () => {
  const g = cleanDragGhost({ car: 'streeter', name: 'BEST PASS', reaction: 0.2, marks: { quarter: 13, ft60: 2 }, trap: 180, total: 13.2, samples: [{ t: 0, x: 0, y: 0, psi: 0, v: 0 }, { t: 1, x: 10, y: 0, psi: 0, v: 20 }, { t: 13.1, x: DRAG.marks.quarter, y: 0, psi: 0, v: 40 }] });
  const car = dragCarById('streeter'), spec = specFor(car, {}), d = quick({ seed: 1, conditions: neutral, entrants: [entrant('streeter', {}, {}, perfect, 'YOU'), { name: 'BEST PASS', spec, tune: defaultTune(car), ghost: g }] }), ghostRunner = d.state.runners[1];
  while (!d.state.green) d.step();
  assert.equal(ghostRunner.trace.length, 0, 'a ghost does not record a new path');
  while (d.state.t < d.state.greenAt + 0.5) d.step();
  assert.ok(Math.abs(ghostRunner.x - 5) < 0.1, `halfway between the samples: ${ghostRunner.x}`);
  assert.equal(ghostRunner.name, 'BEST PASS'); assert.deepEqual(ghostRunner.marks, g.marks); assert.equal(ghostRunner.trap, g.trap); assert.equal(ghostRunner.reaction, g.reaction);
  while (!ghostRunner.stopped && d.state.phase !== 'over') d.step();
  assert.ok(ghostRunner.stopped && ghostRunner.v === 0, 'the replay stops at the end of the saved samples');
});

const suspensionRun = (tune, parts = built(1)) => {
  const d = race({ seed: 1, entrants: [entrant('streeter', tune, parts)] }), r = d.state.runners[0];
  let wheelies = 0, maxPitch = 0, maxLift = 0, maxRearShare = 0;
  while (d.state.phase !== 'over') {
    d.step(); wheelies += d.events.filter(e => e.t === 'wheelie').length;
    maxPitch = Math.max(maxPitch, r.pitch); maxLift = Math.max(maxLift, r.lift); maxRearShare = Math.max(maxRearShare, r.rearShare);
  }
  return { wheelies, maxPitch, maxLift, maxRearShare, quarter: r.marks.quarter };
};

test('suspension: a wheelie loads the rear, wheelie bars set the lift, and stiffness controls how far the nose comes up', () => {
  const gentle = suspensionRun({}, {}), strong = suspensionRun({}, built(1));
  assert.equal(gentle.wheelies, 0); assert.ok(strong.wheelies > 0 && strong.maxLift > 0);
  const short = suspensionRun({ wheelieBar: 0 }), medium = suspensionRun({ wheelieBar: 5 }), long = suspensionRun({ wheelieBar: 10 });
  assert.equal(short.wheelies, 0); assert.equal(short.maxLift, 0);
  assert.ok(medium.maxRearShare > short.maxRearShare + 0.03, 'a wheelie loads the rear more than weight transfer alone'); assert.ok(medium.quarter < short.quarter - 0.1);
  assert.ok(long.maxLift > medium.maxLift + 0.3); assert.ok(long.quarter >= medium.quarter - 0.01);
  assert.ok(long.maxPitch <= SUSP.maxPitch + 1e-9);
  const soft = suspensionRun({ wheelieBar: 10, stiffness: 0 }), stiff = suspensionRun({ wheelieBar: 10, stiffness: 10 });
  assert.ok(stiff.maxPitch < soft.maxPitch - 0.02);
});

test('the predicted timeslip uses the same engine, so suspension and wheelie bar changes show up in it', () => {
  const car = dragCarById('streeter'), spec = specFor(car, built(1));
  const setBar = bar => cleanTune({ ...defaultTune(car), wheelieBar: bar }, car, spec);
  const short = setBar(0), medium = setBar(5), a = predictDrag(spec, short, 1, neutral), b = predictDrag(spec, medium, 1, neutral);
  assert.ok(b.slip.quarter < a.slip.quarter - 0.1);
  const run = (tune) => {
    const d = quick({ seed: 1, conditions: neutral, entrants: [{ name: 'YOU', spec, tune: { ...tune, shift: 'auto' }, ai: { react: 0, spread: 0, shiftErr: 0, foul: 0 } }] }), r = d.state.runners[0];
    r.tireTemp = (DRAG.tire.windowLo + DRAG.tire.windowHi) / 2; r.plan.burnout = 0; runAll(d); return timeslip(r);
  };
  assert.equal(run(medium).quarter, b.slip.quarter);
  const slickSpec = specFor(car, { tires: 6, weight: 6 }), slickTune = cleanTune(defaultTune(car), car, slickSpec);
  const fresh = predictDrag(slickSpec, slickTune, 1, neutral), worn = predictDrag({ ...slickSpec, clutchCondition: CLUTCH.minCondition }, slickTune, 1, neutral);
  assert.ok(worn.slip.quarter > fresh.slip.quarter + 0.05, `a worn clutch shows up in the prediction: ${fresh.slip.quarter.toFixed(3)} vs ${worn.slip.quarter.toFixed(3)}`);
});

test('the blower spools up after launch and loses boost at each shift, with the lag set by its level', () => {
  assert.equal(TURBO.lagByLevel.length, PARTS.find(p => p.id === 'turbo').max);
  for (let i = 1; i < TURBO.lagByLevel.length; i++) assert.ok(TURBO.lagByLevel[i] < TURBO.lagByLevel[i - 1], 'more blower, less lag');
  const car = dragCarById('streeter'), parts = { turbo: 6, tires: 6, weight: 6, gearbox: 2 }, spec = specFor(car, parts), tune = cleanTune({ ...defaultTune(car), boostLimit: BOOST.maxLimit }, car, spec);
  const d = race({ seed: 1, entrants: [{ name: 'YOU', spec, tune, ai: perfect }] }), r = d.state.runners[0];
  let atLaunch = null, peak = 0, afterShift = 0, shifts = 0;
  while (d.state.phase !== 'over' && !r.finished) {
    d.step();
    if (r.launched && atLaunch === null) atLaunch = r.boost;
    peak = Math.max(peak, r.boost);
    if (d.events.some(e => e.t === 'shift')) { afterShift = Math.max(afterShift, r.boost); shifts++; }
  }
  assert.equal(atLaunch, 0, 'no boost before the launch');
  assert.ok(shifts > 1, `${shifts} shifts`);
  assert.ok(peak > BOOST.shiftMax + 0.2, `boost builds over time: ${peak.toFixed(2)}`);
  assert.ok(afterShift <= BOOST.shiftMax + 0.05 && afterShift < peak - 0.2, `each shift drops it: ${peak.toFixed(2)} to ${afterShift.toFixed(2)}`);
});

test('the predicted timeslip includes the blower lag, and an over-boosted tune is riskier', () => {
  const car = dragCarById('streeter'), spec = specFor(car, { turbo: 6, tires: 6, weight: 6 }); spec.torque = OLD_STOCK_TORQUE;
  const tune = limit => cleanTune({ ...defaultTune(car), boostLimit: limit }, car, spec);
  const off = predictDrag(spec, tune(BOOST.minLimit), 1, neutral), on = predictDrag(spec, tune(BOOST.maxLimit), 1, neutral);
  assert.equal(off.slip.boostPeak, 0, 'no blower limit means no boost');
  assert.ok(on.slip.boostPeak > BOOST.safeLimit, `it spooled to ${on.slip.boostPeak?.toFixed(2)}`);
  assert.ok(on.slip.quarter < off.slip.quarter - 0.05, `the lag and boost show up in the prediction: ${off.slip.quarter.toFixed(3)} vs ${on.slip.quarter.toFixed(3)}`);
  assert.equal(boostRisk(tune(BOOST.safeLimit)), BOOST.minLimit);
  assert.ok(Math.abs(boostRisk(tune(BOOST.maxLimit)) - BOOST.maxLimit) < 1e-9);
});

test('boost heat soak: more boost soaks more heat and retards the timing instead of cutting grip', () => {
  assert.equal(boostRetardAt(BOOST.heatFadeFrom), 0, 'no retard below the soak threshold');
  assert.ok(Math.abs(boostRetardAt(BOOST.heatMax) - BOOST.heatFade) < 1e-9, 'the fade is full at the temperature cap');
  const car = dragCarById('streeter'), parts = { turbo: 6, tires: 6, weight: 6 }, spec = specFor(car, parts); spec.torque = OLD_STOCK_TORQUE;
  const tune = limit => cleanTune({ ...defaultTune(car), boostLimit: limit }, car, spec);
  const safe = predictDrag(spec, tune(BOOST.safeLimit), 1, neutral), hot = predictDrag(spec, tune(BOOST.maxLimit), 1, neutral), off = predictDrag(spec, tune(BOOST.minLimit), 1, neutral);
  assert.ok(hot.slip.enginePeakTemp > safe.slip.enginePeakTemp + 30, `more boost soaks more heat: ${Math.round(safe.slip.enginePeakTemp)}C vs ${Math.round(hot.slip.enginePeakTemp)}C`);
  assert.equal(safe.slip.peakRetard, 0, 'the safe limit does not retard the timing');
  assert.ok(hot.slip.peakRetard > 0.1, `overboost retards the timing: ${hot.slip.peakRetard?.toFixed(3)}`);
  assert.ok(hot.slip.quarter < off.slip.quarter - 0.05, 'the blower still helps over a run with no boost at all');
});

test('a hot engine is a slower engine: the same car and tune lose time when the timing is retarded', () => {
  const parts = { turbo: 6, tires: 6, weight: 6 }, d = race({ seed: 1, entrants: [entrant('streeter', {}, parts, perfect, 'COOL', OLD_STOCK_TORQUE), entrant('streeter', {}, parts, perfect, 'HOT', OLD_STOCK_TORQUE)] }), hot = d.state.runners[1];
  while (d.state.phase !== 'over') { if (hot.launched && !hot.finished) hot.engineTemp = BOOST.heatMax; d.step(); }
  const cool = d.state.runners[0];
  assert.ok(hot.marks.quarter > cool.marks.quarter + 0.1, `hot ${hot.marks.quarter?.toFixed(3)} s vs cool ${cool.marks.quarter?.toFixed(3)} s`);
  assert.ok(timeslip(hot).peakRetard > 0.2, 'the timeslip reports the timing lost to heat');
});

test('the engine heats under load, revs and clutch slip even with no blower, and a burnout heats it on the line', () => {
  const pull = runAll(race({ seed: 1, entrants: [entrant('streeter', {}, { tires: 6, weight: 6 }, perfect, 'NO BOOST')] })).state.runners[0];
  assert.equal(pull.boostPeak, 0, 'no boost at all');
  assert.ok(pull.enginePeakTemp > neutral.airC + 5, `a pull heats the engine: ${pull.enginePeakTemp.toFixed(1)} C`);
  const line = burn => {
    const d = fullRace({ seed: 1, entrants: [entrant('streeter', {}, {}, null, 'YOU')] });
    d.state.runners[0].x = STAGE.waterBoxStart + 0.5;
    d.setInput(0, { throttle: 1, burnout: burn });
    for (let i = 0; i < 480; i++) d.step();
    return d.state.runners[0];
  };
  const revving = line(false), burning = line(true);
  assert.ok(burning.engineTemp > revving.engineTemp + 3, `a burnout adds engine heat: ${revving.engineTemp.toFixed(1)} C to ${burning.engineTemp.toFixed(1)} C`);
  assert.ok(!burning.launched && burning.burnout, 'the car is still burning out');
  assert.equal(engineHotShare(BOOST.heatFadeFrom), 0);
  assert.equal(engineHotShare(BOOST.heatMax), 1);
  const soak = quick({ seed: 1, conditions: neutral, entrants: [entrant('streeter', {}, {}, null, 'YOU')] }), s = soak.state.runners[0];
  s.engineTemp = BOOST.heatMax; soak.step(); const hotDrop = (BOOST.heatMax - s.engineTemp) / (BOOST.heatMax - neutral.airC);
  s.engineTemp = 100; soak.step(); const warmDrop = (100 - s.engineTemp) / (100 - neutral.airC);
  assert.ok(hotDrop < warmDrop, `a soaked engine cools slower per degree: ${hotDrop.toFixed(4)} vs ${warmDrop.toFixed(4)} per tick`);
});

test('a hot day retards a safe tune; engine heat carries between races and into the prediction', () => {
  const car = dragCarById('streeter'), spec = specFor(car, { turbo: 6, tires: 6, weight: 6 }), tune = cleanTune({ ...defaultTune(car), boostLimit: BOOST.safeLimit }, car, spec);
  assert.equal(predictDrag(spec, tune, 1, neutral).slip.peakRetard, 0, 'a safe tune is cool on a mild day');
  const hotDay = predictDrag(spec, tune, 1, { ...neutral, airC: 40 });
  assert.ok((hotDay.slip.peakRetard ?? 0) > 0.01, `a hot day retards it too: ${hotDay.slip.peakRetard?.toFixed(3)}`);
  const hot = race({ seed: 1, entrants: [{ ...entrant('streeter', { boostLimit: BOOST.safeLimit }, { turbo: 6, tires: 6, weight: 6 }, perfect), engineTemp: BOOST.heatMax }] });
  const r = hot.state.runners[0];
  assert.equal(r.engineTemp, BOOST.heatMax, 'a runner starts at the session temperature');
  assert.ok(r.retard > 0, 'and is already retarding the timing');
  runAll(hot); assert.equal(timeslip(r).engineTemp, r.engineTemp, 'the timeslip carries the final engine heat to the next race');
  const cold = predictDrag(spec, tune, 1, neutral), carried = predictDrag(spec, tune, 1, neutral, FUEL.capacity, BOOST.heatMax);
  assert.equal(cold.slip.peakRetard, 0, 'a cold prediction does not retard');
  assert.ok((carried.slip.peakRetard ?? 0) > 0.1, `a hot session prediction does: ${carried.slip.peakRetard?.toFixed(3)}`);
});

test('the auto driver opens the wastegate and cuts its burnout when the engine is hot, and still finishes clean', () => {
  const parts = { turbo: 6, tires: 6, weight: 6 }, car = dragCarById('streeter'), spec = specFor(car, parts), tune = cleanTune({ ...defaultTune(car), boostLimit: BOOST.maxLimit }, car, spec);
  const hot = { ...neutral, airC: 20 }, entrants = ai => [{ name: 'YOU', spec, tune, ai, engineTemp: 150 }];
  const run = ai => { const d = race({ seed: 1, conditions: hot, entrants: entrants(ai) }); while (d.state.phase !== 'over') d.step(); return d.state.runners[0]; };
  const managed = run(AUTO_DRIVER), raw = run({ ...AUTO_DRIVER, heatSense: 0 });
  assert.ok(engineTrim({ ...managed, ai: AUTO_DRIVER, engineTemp: BOOST.heatMax }) < engineTrim({ ...managed, ai: { ...AUTO_DRIVER, heatSense: 0 }, engineTemp: BOOST.heatMax }), 'the trim only applies to a driver with heat sense');
  assert.ok(managed.boostPeak < raw.boostPeak - 0.01, `less charge while hot: ${managed.boostPeak.toFixed(2)} vs ${raw.boostPeak.toFixed(2)}`);
  assert.ok(managed.enginePeakTemp < raw.enginePeakTemp - 10, `less heat soak: ${Math.round(managed.enginePeakTemp)} C vs ${Math.round(raw.enginePeakTemp)} C`);
  assert.ok(managed.finished && !managed.foul && !managed.crossed && !managed.crashed, 'the auto driver still makes a clean pass');
  const shallow = { ...AUTO_DRIVER, deepStage: false };
  const staged = fullRace({ seed: 1, entrants: [{ ...entrants(shallow)[0], name: 'HOT', engineTemp: BOOST.heatMax }, { ...entrants(shallow)[0], name: 'COOL', engineTemp: neutral.airC }] });
  while (staged.state.runners.some(r => r.stage === 'waterBoxApproach' || r.stage === 'burnout') && staged.state.t < 60) { staged.state.runners[0].engineTemp = BOOST.heatMax; staged.step(); }      // (the hot car stays hot: an engine cools in the seconds it takes to roll up)
  const [hotCar, coolCar] = staged.state.runners; assert.ok(hotCar.burnDistance < coolCar.burnDistance - 2, `a hot auto driver cuts its burnout short: ${hotCar.burnDistance.toFixed(1)} vs ${coolCar.burnDistance.toFixed(1)} m`);
  assert.ok(coolCar.burnDistance > STAGE.waterBoxEnd - STAGE.waterBoxStart, 'a cool one burns out through the water box and past it');
});

test('the throttle is a position: bad input is repaired and partial gas gives a partial pull', () => {
  assert.equal(throttleOf(true), 1);
  assert.equal(throttleOf(false), 0);
  assert.equal(throttleOf(0.4), 0.4);
  assert.equal(throttleOf(2), 1);
  assert.equal(throttleOf(NaN), 0);
  const staged = gas => {
    const d = race({ seed: 1, entrants: [entrant('streeter', { launchRpm: 4000 }, {}, null, 'YOU')] });
    d.setInput(0, { throttle: gas }); for (let i = 0; i < 240; i++) d.step();
    return d.state.runners[0].rpm;
  };
  const idle = staged(0), half = staged(0.5), full = staged(1);
  assert.ok(half > idle + 100 && half < full - 100, `half throttle holds half the launch revs: ${idle} / ${half} / ${full}`);
  const etFor = gas => {
    const d = race({ seed: 1, entrants: [entrant('streeter', {}, built(1), null, 'YOU')] }), r = d.state.runners[0];
    d.setInput(0, { throttle: gas });
    while (d.state.phase !== 'over') { if (d.state.green && !r.launched) d.setInput(0, { launch: true }); d.step(); }
    return r.marks.quarter;
  };
  const low = etFor(0.4), high = etFor(0.7);
  assert.ok(low > high + 0.5, `less gas is slower: ${low.toFixed(2)} vs ${high.toFixed(2)} s`);
});

test('the named engine map and soft limiter shape the pull before the hard cut', () => {
  const spec = specFor(dragCarById('streeter'), {});
  assert.equal(torqueShape(spec, spec.idle), ENGINE.map.rise[0][1]);
  assert.equal(torqueShape(spec, spec.peakRpm), 1);
  assert.equal(torqueShape(spec, spec.redline), ENGINE.map.fall.at(-1)[1]);
  const mid = (spec.idle + spec.peakRpm) / 2;
  assert.ok(torqueShape(spec, mid) > ENGINE.map.rise[0][1] && torqueShape(spec, mid) < 1, `the map interpolates: ${torqueShape(spec, mid).toFixed(3)}`);
  const band = spec.redline - ENGINE.limiter.span;
  assert.equal(limiterTorqueShare(spec, band - 1), 1);
  assert.ok(limiterTorqueShare(spec, band + ENGINE.limiter.span / 2) < 1 && limiterTorqueShare(spec, band + ENGINE.limiter.span / 2) > 0);
  assert.equal(limiterTorqueShare(spec, spec.redline), 0);
});

test('lifting off the gas costs speed through engine braking', () => {
  const coast = share => {
    const old = ENGINE.brake.share; ENGINE.brake.share = share;
    try {
      const d = race({ seed: 1, entrants: [entrant('streeter', {}, built(1), null, 'YOU')] }), r = d.state.runners[0];
      d.setInput(0, { throttle: 1 });
      while (!d.state.green) d.step();
      d.setInput(0, { launch: true }); for (let i = 0; i < Math.round(2 / DRAG.dt); i++) d.step();
      const before = r.v;
      d.setInput(0, { throttle: 0 }); for (let i = 0; i < Math.round(0.5 / DRAG.dt); i++) d.step();
      return { before, after: r.v, locked: r.clutchLocked };
    } finally { ENGINE.brake.share = old; }
  };
  const braked = coast(ENGINE.brake.share), free = coast(0);
  assert.ok(braked.locked && free.locked, 'the clutch is engaged while lifting');
  assert.equal(braked.before, free.before);
  assert.ok(braked.after < free.after - 0.05, `engine braking costs speed: ${braked.after.toFixed(3)} vs ${free.after.toFixed(3)} m/s`);
});

test('the auto driver lifts for a spin or the limiter and is back on full gas otherwise', () => {
  assert.equal(autoThrottle({ finished: false, spin: false, limiter: false }), 1);
  assert.equal(autoThrottle({ finished: false, spin: true, limiter: false }), ENGINE.ai.spinLift);
  assert.equal(autoThrottle({ finished: false, spin: false, limiter: true }), ENGINE.ai.limitLift);
  assert.equal(autoThrottle({ finished: false, spin: true, limiter: true }), ENGINE.ai.spinLift);
  assert.equal(autoThrottle({ finished: true, spin: false, limiter: false }), 0);
  assert.ok(ENGINE.ai.spinLift < 1 && ENGINE.ai.spinLift >= ENGINE.ai.min);
  assert.ok(ENGINE.ai.limitLift < 1 && ENGINE.ai.limitLift >= ENGINE.ai.min);
});

function canvasRecorder() {
  const calls = [], texts = [], placed = [], rects = [], noop = () => {};
  const fns = new Set(['save', 'restore', 'beginPath', 'arc', 'moveTo', 'lineTo', 'closePath', 'stroke', 'fill', 'setLineDash', 'clearRect', 'translate', 'rotate', 'ellipse']);
  let font = '10px monospace', align = 'left';
  const ctx = new Proxy({}, {
    get: (t, k) => {
      if (k === 'fillText') return (s, x, y) => { const label = String(s); texts.push(label); placed.push({ s: label, x, y, font, align }); calls.push('fillText'); };
      if (k === 'fillRect' || k === 'strokeRect') return (x, y, w, h) => { rects.push({ kind: k, x, y, w, h }); calls.push(k); };
      if (fns.has(k)) return () => { calls.push(k); };
      return k in t ? t[k] : noop;
    },
    set: (t, k, v) => { if (k === 'font') font = String(v); if (k === 'textAlign') align = String(v); t[k] = v; return true; },
  });
  return { ctx, calls, texts, placed, rects };
}
function textBox(t) {
  const px = Number(/(\d+(?:\.\d+)?)px/.exec(t.font)?.[1] ?? 10), width = t.s.length * px * 0.6;
  const x0 = t.align === 'right' ? t.x - width : t.align === 'center' ? t.x - width / 2 : t.x;
  return { x0, x1: x0 + width, y0: t.y - px, y1: t.y + px * 0.25 };
}
function overlaps(a, b) { return a.x0 < b.x1 - 1 && b.x0 < a.x1 - 1 && a.y0 < b.y1 - 1 && b.y0 < a.y1 - 1; }
function assertTachLegible(rec, W, H, S, label) {
  const panel = rec.placed.filter(t => t.x > W - 220 * S && t.y > H - 250 * S);
  assert.ok(panel.length >= 6, `${label}: the tach rows are recorded (${rec.placed.map(t => t.s).join(' | ')})`);
  const boxes = panel.map(textBox), gauges = rec.rects.filter(r => r.kind === 'strokeRect' && r.w > 20 * S && r.h < 20 * S).map(r => ({ x0: r.x, x1: r.x + r.w, y0: r.y, y1: r.y + r.h }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlaps(boxes[i], boxes[j]), `${label}: ${panel[i].s} overlaps ${panel[j].s}`);
    for (const gauge of gauges) assert.ok(!overlaps(boxes[i], gauge), `${label}: ${panel[i].s} overlaps a gauge`);
  }
}

test('the HUD reads clutch temperature and condition as numbers and bars', () => {
  const car = dragCarById('streeter'), spec = specFor(car, {}), d = quick({ seed: 1, conditions: neutral, entrants: [{ name: 'YOU', spec, tune: defaultTune(car), ai: null }] }), r = d.state.runners[0];
  r.launched = true; r.clutchTemp = 320; r.clutchCondition = 0.55;
  const hot = canvasRecorder(); drawTach(hot.ctx, 1280, 720, r, 1, 0, neutral);
  assert.ok(hot.texts.some(t => /CLUTCH 320C 55% SLIP/.test(t)));
  assert.ok(hot.rects.some(x => x.kind === 'strokeRect' && x.w > 100 && x.h < 20), 'the clutch has heat and condition bars');
  r.clutchLocked = true; const locked = canvasRecorder(); drawTach(locked.ctx, 1280, 720, r, 1, 0, neutral);
  assert.ok(locked.texts.some(t => /CLUTCH 320C 55% LOCK/.test(t)));
  r.clutchLocked = false; r.clutchTemp = 20; r.clutchCondition = 1; const cold = canvasRecorder(); drawTach(cold.ctx, 1280, 720, r, 1, 0, neutral);
  assert.ok(cold.texts.some(t => /CLUTCH 20C 100% SLIP/.test(t)));
});

test('the HUD reads both rear slicks, their wear and the per-wheel HUD rows', () => {
  const car = dragCarById('streeter'), spec = specFor(car, {}), d = quick({ seed: 1, conditions: neutral, entrants: [{ name: 'YOU', spec, tune: defaultTune(car), ai: null }] }), r = d.state.runners[0];
  r.launched = true; r.tires[0] = { temp: 95, wear: 0.2 }; r.tires[1] = { temp: 110, wear: 0.4 };
  const tach = canvasRecorder(); drawTach(tach.ctx, 1280, 720, r, 1, 0, neutral);
  assert.ok(tach.texts.some(t => /L95\u00b0 20%/.test(t)), tach.texts.join(' | '));
  assert.ok(tach.texts.some(t => /R110\u00b0 40%/.test(t)), tach.texts.join(' | '));
  const progress = canvasRecorder(); drawProgress(progress.ctx, 1280, 720, d.state, 0, 1, { launch: 'X', nitro: 'N', manual: false });
  assert.ok(progress.texts.some(t => /TIRE WEAR L20% R40%/.test(t)), progress.texts.join(' | '));
});

test('the bottom-right tach, nitro, tire and clutch gauges keep their own rows', () => {
  for (const S of [0.7, 1, 1.6]) for (const parts of [{}, { nitro: 2 }]) {
    const car = dragCarById('streeter'), spec = specFor(car, parts), d = quick({ seed: 1, conditions: neutral, entrants: [{ name: 'YOU', spec, tune: defaultTune(car), ai: null }] }), r = d.state.runners[0];
    r.launched = true; r.spinR = true; r.clutchTemp = 320; r.clutchCondition = 0.55; r.tires[0] = { temp: 95, wear: 0.2 }; r.tires[1] = { temp: 110, wear: 0.4 };
    const W = 1280 * S, H = 720 * S, rec = canvasRecorder(); drawTach(rec.ctx, W, H, r, S, 0, neutral);
    if (parts.nitro) assert.ok(rec.texts.some(t => /^NITRO(?:!)? \d+% \d+% \d+C$/.test(t)), rec.texts.join(' | '));
    assertTachLegible(rec, W, H, S, `${S} ${parts.nitro ? 'nitro' : 'no nitro'}`);
  }
});

test('the HUD reads the live conditions and the forecast front', () => {
  const d = quick({ seed: 8, entrants: [entrant('streeter')] }), forecast = d.state.conditions, keys = { launch: 'X', nitro: 'N', manual: false };
  const before = canvasRecorder(); drawProgress(before.ctx, 1280, 720, d.state, 0, 1, keys);
  assert.equal(before.texts.filter(t => forecastText(forecast).includes(t)).join(' '), forecastText(forecast), before.texts.join(' | '));
  for (let i = 0; i < 240 * 6; i++) d.step();
  assert.notEqual(d.state.weather.airC, forecast.airC);
  const after = canvasRecorder(); drawProgress(after.ctx, 1280, 720, d.state, 0, 1, keys);
  const live = conditionsText(d.state.weather) + weatherText(forecast);
  assert.equal(after.texts.filter(t => live.includes(t)).join(' '), live, after.texts.join(' | '));
});

test('the HUD conditions wrap inside the left column instead of running past the centre', () => {
  for (const S of [0.7, 1, 1.6]) {
    const W = 1280 * S, H = 720 * S, d = quick({ seed: 8, entrants: [entrant('streeter')] }), forecast = forecastText(d.state.conditions);
    const rec = canvasRecorder(); drawProgress(rec.ctx, W, H, d.state, 0, S, { launch: 'X', nitro: 'N', manual: false });
    const lines = rec.placed.filter(t => forecast.includes(t.s));
    assert.ok(lines.length >= 2, `${S}: the long forecast wraps (${rec.texts.join(' | ')})`);
    assert.equal(lines.map(t => t.s).join(' '), forecast, `${S}: no words are lost`);
    const leftColumnRight = W / 2 - 24 * S;
    for (const line of lines) assert.ok(textBox(line).x1 <= leftColumnRight, `${S}: ${line.s} runs past the left column at x ${textBox(line).x1} > ${leftColumnRight}`);
    for (let i = 1; i < lines.length; i++) assert.ok(!overlaps(textBox(lines[i - 1]), textBox(lines[i])), `${S}: wrapped rows share a line`);
  }
});

test('the HUD draws a boost gauge with the charge and the tune limit', () => {
  const car = dragCarById('streeter'), spec = specFor(car, { turbo: 3 }), d = quick({ seed: 1, conditions: neutral, entrants: [{ name: 'YOU', spec, tune: defaultTune(car), ai: null }] }), r = d.state.runners[0];
  r.launched = true; r.boost = 0.6; r.engineTemp = 180; r.retard = 0.2;
  const hud = canvasRecorder(); drawProgress(hud.ctx, 1280, 720, d.state, 0, 1, { launch: 'X', nitro: 'N', manual: false });
  assert.ok(hud.texts.some(t => /BOOST 60%  ENGINE 180C -20%/.test(t)), hud.texts.join(' | '));
  assert.ok(hud.texts.some(t => /80% LIMIT/.test(t)));
  assert.ok(hud.rects.some(x => x.kind === 'strokeRect' && x.w > 50 && x.h < 20), 'the boost has a bar');
});

test('the HUD shows the staged rollout and an abort before the beam', () => {
  const car = dragCarById('streeter'), spec = specFor(car, {}), d = quick({ seed: 1, conditions: neutral, entrants: [{ name: 'YOU', spec, tune: defaultTune(car), ai: null }] }), r = d.state.runners[0];
  const keys = { launch: 'X', nitro: 'N', manual: false, gas: 'W', burnout: 'S', chute: 'N', deepStage: 'H' };
  const staged = canvasRecorder(); drawProgress(staged.ctx, 1280, 720, d.state, 0, 1, keys);
  assert.ok(staged.texts.includes('STAGED: X ON GREEN'), staged.texts.join(' | ')); assert.ok(staged.texts.includes('H: DEEP STAGE')); assert.ok(staged.texts.includes('N: ABORT'));
  r.deepStage = true; const deep = canvasRecorder(); drawProgress(deep.ctx, 1280, 720, d.state, 0, 1, keys);
  assert.ok(deep.texts.includes('DEEP STAGED: X ON GREEN'), deep.texts.join(' | ')); assert.ok(!deep.texts.includes('STAGED: X ON GREEN')); r.deepStage = false;
  r.rolling = true; const rolling = canvasRecorder(); drawProgress(rolling.ctx, 1280, 720, d.state, 0, 1, keys);
  assert.ok(rolling.texts.includes('ROLLING TO THE BEAM'), rolling.texts.join(' | '));
  r.rolling = false; r.aborted = true; r.foul = true; const aborted = canvasRecorder(); drawProgress(aborted.ctx, 1280, 720, d.state, 0, 1, keys);
  assert.ok(aborted.texts.includes('START ABORTED'), aborted.texts.join(' | ')); assert.ok(aborted.texts.includes('ABORT')); assert.ok(!aborted.texts.includes('STAGED: X ON GREEN'));
});

test('the HUD asks for the brake and the chute after the line, and flashes a crash message when the car misses the end of the strip', () => {
  const car = dragCarById('streeter'), spec = specFor(car, {}), d = quick({ seed: 1, conditions: neutral, entrants: [{ name: 'YOU', spec, tune: defaultTune(car), ai: null }] }), r = d.state.runners[0];
  r.launched = true; r.finished = true; r.shutdown = true; r.marks.quarter = 9; r.trap = 180; r.x = SHUTDOWN.end - 40; r.chute = true;
  const running = canvasRecorder(); drawProgress(running.ctx, 1280, 720, d.state, 0, 1, { launch: 'X', nitro: 'N', manual: false, brake: 'B', chute: 'N' });
  assert.ok(running.texts.some(t => /STOP BEFORE THE END: 40 M/.test(t)), running.texts.join(' | '));
  assert.ok(running.texts.some(t => /B: BRAKE\s+N: CHUTE/.test(t)), running.texts.join(' | '));
  assert.ok(running.texts.includes('CHUTE OUT'));
  r.crashed = true; r.stopped = true; const crashed = canvasRecorder(); drawProgress(crashed.ctx, 1280, 720, d.state, 0, 1, { launch: 'X', nitro: 'N', manual: false, brake: 'B', chute: 'N' });
  assert.ok(crashed.texts.includes('You crashed'));
});

test('the HUD reads live rear weight, brake fade and chute opening below the tire row', () => {
  const car = dragCarById('streeter'), spec = specFor(car, {}), d = quick({ seed: 1, conditions: neutral, entrants: [{ name: 'YOU', spec, tune: defaultTune(car), ai: null }] }), r = d.state.runners[0];
  r.launched = true; r.finished = true; r.shutdown = true; r.marks.quarter = 9; r.trap = 180;
  r.rearShare = 0.78; r.brakeTemp = 320; r.brakeFade = 0.82; r.chute = true; r.chuteOpen = 0.4;
  const hot = canvasRecorder(); drawProgress(hot.ctx, 1280, 720, d.state, 0, 1, { launch: 'X', nitro: 'N', manual: false });
  for (const label of ['REAR WEIGHT 78%', 'BRAKE 320C 82%', 'CHUTE 40%']) assert.ok(hot.texts.includes(label), `${label} in ${hot.texts.join(' | ')}`);
  const tire = hot.placed.find(t => t.s.startsWith('TIRE WEAR')), rows = ['REAR WEIGHT 78%', 'BRAKE 320C 82%', 'CHUTE 40%'].map(label => hot.placed.find(t => t.s === label));
  assert.ok(tire && rows.every(Boolean), 'all three rows are drawn');
  for (const row of rows) assert.ok(textBox(row).y0 > textBox(tire).y1 && textBox(row).x1 < 24 + 420, `${row.s} sits clear of the tire row and inside the left column`);
  r.rearShare = 0.55; r.brakeTemp = 20; r.brakeFade = 1; r.chute = false; r.chuteOpen = 0;
  const cold = canvasRecorder(); drawProgress(cold.ctx, 1280, 720, d.state, 0, 1, { launch: 'X', nitro: 'N', manual: false });
  for (const label of ['REAR WEIGHT 55%', 'BRAKE 20C 100%', 'CHUTE 0%']) assert.ok(cold.texts.includes(label), cold.texts.join(' | '));
});

test('the HUD reads the fuel load before the rear-weight row', () => {
  const d = race({ seed: 1, entrants: [entrant('streeter', {}, {}, null)] }), r = d.state.runners[0];
  r.launched = true; r.fuel = 30;
  const rec = canvasRecorder(); drawProgress(rec.ctx, 1280, 720, d.state, 0, 1, { launch: 'X', nitro: 'N', manual: false });
  assert.ok(rec.texts.some(t => /^FUEL 30\.0 KG 24%/.test(t)), rec.texts.join(' | '));
  const fuelRow = rec.placed.find(t => t.s.startsWith('FUEL ')), rearRow = rec.placed.find(t => t.s.startsWith('REAR WEIGHT'));
  assert.ok(fuelRow && rearRow && textBox(fuelRow).y0 < textBox(rearRow).y0, 'the fuel row sits above the rear weight');
  r.fuel = FUEL.reserve; const empty = canvasRecorder(); drawProgress(empty.ctx, 1280, 720, d.state, 0, 1, { launch: 'X', nitro: 'N', manual: false });
  assert.ok(empty.texts.some(t => /^FUEL 10\.0 KG 0%/.test(t)), empty.texts.join(' | '));
});

test('a tune is kept within what the car allows: junk becomes sensible numbers, gears match the gearbox (one more with gearbox level 2)', () => {
  const car = dragCarById('streeter'), spec = specFor(car, {}), junk = cleanTune({ shift: 'warp', ratios: [99, -1, 'x'], final: NaN, launchRpm: 1e6, shiftRpm: -5, pressure: 2, ballast: 1e4, nitroShot: 9, nitroGear: 77 }, car, spec);
  assert.equal(junk.shift, 'auto'); assert.equal(junk.ratios.length, car.gears.length); assert.equal(junk.ratios[0], 5); assert.equal(junk.ratios[1], 0.5); assert.equal(junk.ratios[2], car.gears[2]);
  assert.equal(junk.final, car.final); assert.equal(junk.launchRpm, spec.redline); assert.equal(junk.launchAggression, CLUTCH.aggressionDefault); assert.equal(junk.shiftRpm, spec.idle + 500); assert.equal(junk.pressure, 12); assert.equal(junk.ballast, 120); assert.equal(junk.nitroGear, car.gears.length);
  assert.equal(cleanTune({}, car, specFor(car, { gearbox: 2 })).ratios.length, car.gears.length + 1, 'one more gear');
});

// ---- the save: cars, parts, tunes, the ghost and what a race pays ----// ---- the save and the model (no profile, points, shop or parts to buy) ----
import { emptySave, sanitizeSave } from '../src/save.ts';
import { STOCK_PARTS } from '../src/drag/data.ts';
import { recordRace, readyCar, saveTune } from '../src/drag/model.ts';
import { STOCK_CAR, specForBenchmark, stockSpec } from '../src/drag/spec-source.ts';
const slip = (o = {}) => ({ name: 'YOU', reaction: 0.2, foul: false, ft60: 2.3, ft330: 6, eighth: 8.5, ft1000: 11, quarter: 12.9, trap: 181, total: 13.1, ...o });

test('the car runs the TOP level of every part as stock, whatever the benchmark said, and the spec has one place to come from', () => {
  for (const part of PARTS) assert.equal(STOCK_PARTS[part.id], part.max, `${part.id} is at its top level`);
  assert.deepEqual(stockSpec(), specFor(STOCK_CAR, built(1)), 'the stock spec is the car with every part at its top');
  assert.ok(stockSpec().torque > specFor(STOCK_CAR, {}).torque * 1.25, 'the stock parts make it much stronger than the bare chassis');
  const save = emptySave(); assert.equal(save.benchmark, null);
  // (owner decision: with no benchmark the car gets the WEAKEST spec, never the stock parts' full power, so skipping the benchmark never pays)
  assert.deepEqual(readyCar(save).spec, specForBenchmark(null), 'with no benchmark the weakest car races');
  assert.ok(specForBenchmark(null).torque < stockSpec().torque, 'no benchmark: weaker than the stock engine');
  assert.notEqual(specForBenchmark({ score: 9000, class: 'discrete-nvidia-current', benchmarkVersion: 1, gpuId: 'x', date: 1 }).torque, stockSpec().torque, 'a benchmark result sets the engine (tests/benchmark.test.mjs)');
  assert.equal(readyCar(save, 0.6).spec.clutchCondition, 0.6, 'a worn clutch is passed to the car');
  assert.equal(emptySave().ghost, null, 'the save given is left alone');
});

test('a tune is kept, made safe, and used when the car races', () => {
  const s = saveTune(emptySave(), { shift: 'manual', launchRpm: 3600, pressure: 18, ratios: [3.5, 2.2, 1.6, 1.2, 0.95], final: 4.1 }), t = readyCar(s).tune;
  assert.equal(t.shift, 'manual'); assert.equal(t.launchRpm, 3600); assert.equal(t.pressure, 18); assert.equal(t.final, 4.1); assert.deepEqual(t.ratios, [3.5, 2.2, 1.6, 1.2, 0.95].slice(0, stockSpec().gearsMax), 'as many gears as the car has');
  assert.equal(readyCar(saveTune(emptySave(), { pressure: 999 })).tune.pressure, 40, 'clamped');
});

test('the first race is solo: a clean pass saves the ghost; a test run saves nothing and does not count', () => {
  const start = emptySave(), first = bestGhost(13.1, 12.9), res = recordRace(start, { kind: 'solo', won: true, slip: slip(), ghost: first }, 1);
  assert.equal(res.improved, true); assert.deepEqual(res.save.ghost, first); assert.equal(res.save.records.races, 1); assert.equal(res.save.records.wins, 1);
  assert.equal(res.save.records.history.at(-1).against, 'SOLO'); assert.equal(start.ghost, null, 'the save given is left alone');
  const test = recordRace(res.save, { kind: 'test', won: true, slip: slip({ quarter: 9, ft60: 1.5, trap: 400, reaction: 0.05 }), ghost: bestGhost(9.05, 9) }, 2);
  assert.equal(test.improved, false); assert.deepEqual(test.save.ghost, first, 'a test run does not save a ghost');
  assert.equal(test.save.records.races, 1); assert.equal(test.save.records.wins, 1); assert.equal(test.save.records.history.at(-1).against, 'TEST RUN');
});

test('a quicker pass replaces the ghost, a slower or identical one does not, and the record is announced', () => {
  const start = recordRace(emptySave(), { kind: 'solo', won: true, slip: slip(), ghost: bestGhost(13.1, 12.9) }, 1).save;
  const slower = recordRace(start, { kind: 'ghost', won: false, slip: slip(), ghost: bestGhost(13.3, 13.1) }, 2);
  assert.equal(slower.improved, false); assert.deepEqual(slower.save.ghost, start.ghost);
  const better = recordRace(start, { kind: 'ghost', won: true, slip: slip({ quarter: 12.5, ft60: 2.1 }), ghost: bestGhost(12.7, 12.5) }, 3);
  assert.equal(better.improved, true); assert.deepEqual(better.records, ['BEST PASS', 'BEST ET', 'BEST 60 FT']);
  assert.equal(better.save.ghost.marks.quarter, 12.5); assert.equal(better.save.records.history.at(-1).against, 'BEST PASS');
  const tie = recordRace(better.save, { kind: 'ghost', won: true, slip: slip(), ghost: bestGhost(12.7, 12.4) }, 4);
  assert.equal(tie.improved, true, 'the same total with a lower ET is a new best pass');
  assert.equal(recordRace(tie.save, { kind: 'ghost', won: true, slip: slip(), ghost: bestGhost(12.7, 12.4) }, 5).improved, false);
});

test('a crash is not a win and keeps no ghost or best; the crash survives a save', () => {
  const slipUp = slip({ crashed: true, stopped: true, quarter: 4, ft60: 1, reaction: 0, trap: 500 }), r = recordRace(emptySave(), { kind: 'ghost', won: true, slip: slipUp }, 1);
  assert.equal(r.ghost, null); assert.deepEqual(r.records, []); assert.equal(r.save.records.races, 1); assert.equal(r.save.records.wins, 0); assert.equal(r.save.records.crashes, 1);
  assert.equal(r.save.records.bestEt, 0); assert.equal(r.save.records.best60, 0); assert.equal(r.save.records.bestTrap, 0); assert.equal(r.save.records.bestReaction, 0);
  assert.equal(r.save.records.history.at(-1).crashed, true); assert.equal(r.save.records.history.at(-1).won, false);
  assert.equal(sanitizeSave(JSON.parse(JSON.stringify(r.save))).records.crashes, 1);
});

test('records come from clean runs (a red light keeps none); only a better one replaces a best and is announced; the last ten are kept', () => {
  let s = recordRace(emptySave(), { kind: 'solo', won: true, slip: slip() }, 1).save; const r0 = s.records; assert.equal(r0.bestEt, 12.9); assert.equal(r0.best60, 2.3); assert.equal(r0.bestTrap, 181); assert.equal(r0.bestReaction, 0.2);
  const r = recordRace(s, { kind: 'ghost', won: true, slip: slip({ quarter: 12.5, trap: 190, reaction: 0.15, ft60: 2.1 }) }, 2); assert.deepEqual(r.records, ['BEST ET', 'BEST 60 FT', 'BEST TRAP SPEED', 'BEST REACTION']); s = r.save;
  assert.equal(recordRace(s, { kind: 'ghost', won: false, slip: slip({ quarter: 9, foul: true, reaction: -0.2 }) }, 3).save.records.bestEt, 12.5, 'a red light run does not count');
  for (let i = 0; i < 14; i++) s = recordRace(s, { kind: 'ghost', won: false, slip: slip() }, 10 + i).save; assert.equal(s.records.history.length, 10); assert.equal(s.records.history.at(-1).at, 23);
});

test('the save is checked: junk becomes an empty save, the benchmark result must be believable, the ghost is repaired, slots stay six', () => {
  assert.deepEqual(sanitizeSave(null), emptySave()); assert.deepEqual(sanitizeSave('garbage'), emptySave()); assert.deepEqual(sanitizeSave({ points: 3, drag: {} }), emptySave(), 'old profile fields are ignored');
  const good = { score: 4200, class: 'discrete-nvidia-modern', benchmarkVersion: 2, gpuId: 'NVIDIA GeForce X', date: 1700000000000 };
  assert.deepEqual(sanitizeSave({ benchmark: good }).benchmark, good);
  for (const bad of [{ ...good, score: -1 }, { ...good, gpuId: '' }, { ...good, class: 5 }, { ...good, class: 'DISCRETE NVIDIA' }, 'x', 7]) assert.equal(sanitizeSave({ benchmark: bad }).benchmark, null);
  const s = sanitizeSave({ ghost: { car: 'streeter', name: 'BEST PASS', reaction: 0.2, marks: { quarter: 12.5 }, trap: 181, total: 12.7, samples: [{ t: 0, x: 0 }, { t: 1, x: 5 }] }, slots: 'garbage', records: { races: 'many', bestEt: -5, history: [{ against: 'SOLO', et: 'x' }, 7] } });
  assert.equal(s.ghost.marks.quarter, 12.5, 'the ghost is checked and kept'); assert.equal(sanitizeSave({ ghost: { car: 'streeter', samples: [] } }).ghost, null, 'a ghost with no quarter is discarded'); assert.equal(s.slots.length, 6); assert.equal(s.records.races, 0); assert.equal(s.records.bestEt, 0); assert.equal(s.records.history.length, 1);
});

// ---- steering ----
import { LANE } from '../src/drag/physics.ts';
const lane = (id, o = {}) => {
  const car = dragCarById(id), spec = specFor(car, o.parts ?? {}); if (o.torque !== undefined) spec.torque = o.torque;
  const t = cleanTune({ ...defaultTune(car), launchRpm: o.launch ?? 5000 }, car, spec);
  const you = { name: 'YOU', spec, tune: t, ai: o.auto ? AUTO_DRIVER : null }, other = { name: 'OTHER', spec, tune: t, ai: { ...perfect, react: 0.3 } };
  const d = race({ seed: o.seed ?? 1, entrants: o.alone ? [you] : [you, other] }), r = d.state.runners[0]; let maxY = 0, firstYaw = null, minGrip = 1, maxDrift = 0;
  while (d.state.phase !== 'over') { if (!o.auto) d.setInput(0, { throttle: 1, launch: d.state.green, steer: o.steer ? o.steer(r) : 0 }); d.step(); maxY = Math.max(maxY, Math.abs(r.y)); minGrip = Math.min(minGrip, r.gripLeft); maxDrift = Math.max(maxDrift, Math.abs(r.drift)); if (firstYaw === null && r.x > 15) firstYaw = r.psi; }
  return { d, r, maxY, firstYaw, minGrip, maxDrift };
};
import { AUTO_DRIVER as AUTO } from '../src/drag/physics.ts';
const AUTO_DRIVER = AUTO;

test('steering: a hard launch pushes the nose right (the weaker right rear slips), and with nobody steering a car wanders out of its lane', () => {
  const runs = [1, 2, 3, 4, 5].map(seed => lane('streeter', { seed, alone: true, parts: built(0.4) }));
  assert.ok(runs.every(x => x.firstYaw > 0), 'the left wheel pushes harder: the nose goes right ' + runs.map(x => x.firstYaw.toFixed(4)).join(' '));
  assert.ok(runs.filter(x => x.maxY >= LANE.limit - 1e-6).length >= 3, 'most unsteered runs reach a line or the wall: ' + runs.map(x => x.maxY.toFixed(2)).join(' '));
});

test('steering: the automatic driver keeps straight, and steering by hand moves the car across', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) for (const [id, f] of [['streeter', 0], ['streeter', 0.4], ['streeter', 0.9]]) {
    const x = lane(id, { seed, auto: true, parts: built(f) }); assert.ok(x.maxY < 0.8 && !x.r.crossed && !x.d.state.runners[1].crossed, `${id} ${seed}: ${x.maxY.toFixed(2)}`);
  }
  const left = lane('streeter', { alone: true, steer: r => (r.x < 60 ? -0.6 : 0) }), right = lane('streeter', { alone: true, steer: r => (r.x < 60 ? 0.6 : 0) });
  assert.ok(left.r.crossed && left.r.y < 0, 'steering left in the left lane crosses the centre line'); assert.ok(right.maxY >= LANE.limit - 1e-6 && !right.r.crossed, 'steering right finds the wall (not the line)');
});

test('traction: grip is load sensitive, a spinning slick gives less drive, and the tires reserve grip for steering', () => {
  assert.equal(loadGrip(1000, 1000), 1);
  assert.ok(loadGrip(1600, 1000) * 1000 < 1600, 'a loaded axle gains less than its extra load');
  assert.ok(loadGrip(600, 1000) * 1000 > 600, 'an unloaded axle loses less than its lost load');
  assert.equal(slipGrip(0), 1); assert.equal(slipGrip(TRACTION.slipPeak), 1);
  assert.ok(slipGrip(TRACTION.slipPeak * 2) < 1 && slipGrip(TRACTION.slipPeak * 2) > TRACTION.slideGrip, 'pull falls between the peak and the slide floor');
  assert.ok(slipGrip(10) > TRACTION.slideGrip && slipGrip(10) < TRACTION.slideGrip + 0.01, 'a long slide settles at the floor');
  assert.equal(lateralShare(0, 100), 1); assert.equal(lateralShare(100, 100), TRACTION.lateralFloor);
  assert.ok(lateralShare(50, 100) > 0.9 && lateralShare(50, 100) < 1, 'part of the grip is still free to turn');
});

test('traction: a hard launch spends grip into wheelspin, and the autopilot still tracks while it is saturated', () => {
  const hard = lane('streeter', { seed: 1, alone: true, parts: built(0.9) }), auto = lane('streeter', { seed: 1, auto: true, parts: built(0.9) });
  assert.ok(hard.minGrip < TRACTION.lateralFloor + 0.2, `drive and slip spend grip (${hard.minGrip.toFixed(2)})`);
  assert.ok(hard.maxDrift > 0.01, `the unstered nose runs out of turn (${hard.maxDrift.toFixed(3)})`);
  assert.ok(auto.minGrip < TRACTION.lateralFloor + 0.2 && auto.maxDrift > 0.01, 'the autopilot works in the same saturated grip');
  assert.ok(auto.maxY < 0.8 && !auto.r.crossed && !auto.d.state.runners[1].crossed, `and still keeps its lane (${auto.maxY.toFixed(2)})`);
});

test('the lane view marks where the nose wants to go while the slicks are sliding', () => {
  const me = { x: 100, y: 0, psi: 0.02, gripLeft: 1, drift: 0, crossed: false };
  const dry = canvasRecorder(); drawLane(dry.ctx, 1280, 720, me, 0, 1);
  assert.ok(!dry.texts.some(t => t.includes('SLIDE')) && !dry.rects.some(q => q.kind === 'strokeRect'), 'no slide marker with grip in hand');
  const slide = canvasRecorder(); drawLane(slide.ctx, 1280, 720, { ...me, gripLeft: 0.6, drift: 0.08 }, 0, 1);
  assert.ok(slide.texts.some(t => /SLIDE 60% GRIP/.test(t)), 'the remaining grip is named');
  assert.ok(slide.rects.some(q => q.kind === 'strokeRect'), 'and the wanted heading is outlined');
});

test('after the finish the longer run-out is saved by the brake alone: coasting or a chute alone still crashes at the end of the strip', () => {
  const shutdown = (brake, chute, ai = null) => {
    const d = race({ seed: 1, entrants: [entrant('streeter', {}, built(1), ai, 'YOU')] }), r = d.state.runners[0], seen = [];
    let sawShutdown = false;
    while (d.state.phase !== 'over') {
      if (!ai) d.setInput(0, { throttle: r.finished ? 0 : 1, launch: d.state.green && !r.finished, brake: r.finished && brake, chute: r.finished && chute, steer: 0 });
      d.step(); for (const e of d.events) seen.push(e.t); if (r.finished && d.state.phase === 'shutdown') sawShutdown = true;
    }
    return { d, r, seen, sawShutdown };
  };
  const none = shutdown(false, false), brake = shutdown(true, false), chute = shutdown(false, true), both = shutdown(true, true);
  for (const x of [none, chute]) { assert.ok(x.r.crashed, `brake ${x.r.brake} chute ${x.r.chute}`); assert.equal(x.r.x, SHUTDOWN.end); assert.equal(x.d.state.winner, -1); assert.match(x.d.state.reason, /crashed/); }
  assert.ok(brake.sawShutdown && brake.r.stopped && !brake.r.crashed && brake.r.x < SHUTDOWN.end, 'braking alone stops a maxed car with the longer run-out');
  assert.ok(both.sawShutdown && both.r.stopped && !both.r.crashed);
  assert.ok(both.r.brake && both.r.chute && both.r.x < SHUTDOWN.end);
  assert.ok(both.r.x < brake.r.x, 'the chute stops you sooner');
  assert.ok(both.seen.includes('finish') && both.seen.includes('chute') && both.seen.includes('over'));
  assert.ok(!both.seen.includes('crash'));
  assert.equal(timeslip(both.r).crashed, false); assert.equal(timeslip(none.r).crashed, true);
  const auto = shutdown(false, false, perfect);
  assert.ok(auto.r.stopped && !auto.r.crashed && auto.r.chute, 'the automatic driver brakes and drops the chute for you');
});

test('brake fade: the brakes heat with the work they do and lose force once they soak', () => {
  assert.equal(brakeFadeOf(SHUTDOWN.brakeFadeFrom - 1), 1);
  assert.equal(brakeFadeOf(SHUTDOWN.brakeFadeTo + 1), SHUTDOWN.brakeFadeMin);
  assert.ok(brakeFadeOf((SHUTDOWN.brakeFadeFrom + SHUTDOWN.brakeFadeTo) / 2) < 1, 'fade sits between full and the floor');
  const stop = temp => {
    const d = quick({ seed: 1, conditions: neutral, entrants: [entrant('streeter', {}, built(1), null, 'YOU')] }), r = d.state.runners[0];
    r.launched = true; r.finished = true; r.shutdown = true; r.marks.quarter = DRAG.marks.quarter; r.x = DRAG.marks.quarter; r.v = 80; r.brakeTemp = temp; d.state.phase = 'shutdown';
    for (let i = 0; i < 120; i++) { d.setInput(0, { brake: true, chute: false, steer: 0 }); d.step(); }
    return r;
  };
  const cool = stop(neutral.airC), hot = stop(SHUTDOWN.brakeFadeTo);
  assert.ok(cool.brakeTemp > neutral.airC, 'braking heats the brakes');
  assert.equal(cool.brakeFade, 1); assert.equal(hot.brakeFade, SHUTDOWN.brakeFadeMin);
  assert.ok(hot.v > cool.v + 1, `hot brakes stop less (${hot.v.toFixed(1)} vs ${cool.v.toFixed(1)} m/s)`);
});

test('the chute opens over a moment instead of biting at full drag on the first tick', () => {
  const mk = open => {
    const d = quick({ seed: 1, conditions: neutral, entrants: [entrant('streeter', {}, built(1), null, 'YOU')] }), r = d.state.runners[0];
    r.launched = true; r.finished = true; r.shutdown = true; r.marks.quarter = DRAG.marks.quarter; r.x = DRAG.marks.quarter; r.v = 80; d.state.phase = 'shutdown';
    if (open) { r.chute = true; r.chuteT = SHUTDOWN.chuteDeploy; r.chuteOpen = 1; }
    return { d, r };
  };
  const ramp = mk(false), instant = mk(true), opens = [];
  for (let i = 0; i < Math.ceil(SHUTDOWN.chuteDeploy / DRAG.dt); i++) {
    for (const x of [ramp, instant]) { x.d.setInput(0, { chute: true, brake: false, steer: 0 }); x.d.step(); }
    opens.push(ramp.r.chuteOpen);
  }
  assert.ok(ramp.r.chute && instant.r.chute);
  assert.ok(opens[0] > 0 && opens[0] < 1, `the chute starts part open (${opens[0].toFixed(2)})`);
  assert.ok(opens.some(v => v < 1) && ramp.r.chuteOpen === 1, 'and is fully open by the end of the ramp');
  assert.ok(ramp.r.v > instant.r.v + 0.5, `a still-open chute slows less (${ramp.r.v.toFixed(1)} vs ${instant.r.v.toFixed(1)} m/s)`);
});

test('the centre line: crossing it is a disqualification that loses even a quicker run; the wall only costs speed', () => {
  const cross = lane('streeter', { parts: built(0.9), steer: r => (r.x > 100 && r.x < 140 ? -0.8 : 0) });
  assert.ok(cross.r.crossed && cross.r.finished); assert.equal(cross.d.state.winner, 1, 'the slower other car wins'); assert.match(cross.d.state.reason, /centre line/);
  assert.equal(timeslip(cross.r).crossed, true);
  const clean = lane('streeter', { alone: true, auto: false, torque: OLD_STOCK_TORQUE, steer: r => Math.max(-1, Math.min(1, -r.y * 2 - r.psi * 20)) }), wall = lane('streeter', { alone: true, torque: OLD_STOCK_TORQUE, steer: r => (r.x < 30 ? 0.8 : 0.1) });
  assert.ok(!clean.r.crossed && wall.maxY >= LANE.limit - 1e-6 && !wall.r.crossed); assert.ok(wall.r.marks.quarter > clean.r.marks.quarter, `the wall costs time: ${wall.r.marks.quarter.toFixed(3)} vs ${clean.r.marks.quarter.toFixed(3)}`);
  assert.equal(wall.d.state.winner, 0, 'touching the wall is not a disqualification');
});


test('the views read the chute as it opens, not just as a boolean', () => {
  const no = { chute: false, aborted: false, chuteOpen: 1 }, full = { chute: true, aborted: false, chuteOpen: 1 }, part = { chute: true, aborted: false, chuteOpen: 0.25 }, old = { chute: true, aborted: false, chuteOpen: Number.NaN };
  assert.equal(chuteOpening(no), 0, 'no chute in the race');
  assert.equal(chuteOpening(part), 0.25); assert.equal(chuteOpening(full), 1);
  assert.equal(chuteOpening({ chute: false, aborted: true, chuteOpen: 0.5 }), 0.5, 'an abort still opens the chute');
  assert.equal(chuteOpening(old), 1, 'an old caller with only a boolean gets a full chute');
});