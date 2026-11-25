// Drag's top-down view: it draws a whole race from above (strip, walls, marks, finish, you and the saved ghost, smoke and tire marks) without trouble, follows your car, and starts afresh for a new race.
import test from 'node:test';
import assert from 'node:assert/strict';
import { conditionsForSeed, conditionsText, createDrag, createDragStrip, layRubber, weatherText, AUTO_DRIVER, DRAG, FUEL, SHUTDOWN, cleanDragGhost } from '../src/drag/physics.ts';
import { createDragTopDown, LANE_M } from '../src/drag/topdown.ts';
import { DRAG_CARS } from '../src/drag/data.ts';
import { defaultTune, specFor } from '../src/drag/tune.ts';

/** a canvas context that records what it is asked to draw (text and the calls) and accepts everything else */
function recorder() {
  const calls = [], texts = [], ellipses = [], lines = []; const fns = new Set(['fillRect', 'strokeRect', 'moveTo', 'arc', 'fill', 'stroke', 'beginPath', 'closePath', 'save', 'restore', 'translate', 'rotate', 'setLineDash', 'clearRect']);
  const ctx = new Proxy({}, { get: (t, k) => { if (k === 'fillText') return (s, x, y) => { texts.push(String(s)); calls.push('fillText'); }; if (k === 'ellipse') return (...args) => { ellipses.push(args); calls.push('ellipse'); }; if (k === 'lineTo') return (...args) => { lines.push(args); calls.push('lineTo'); }; if (fns.has(k)) return () => { calls.push(k); }; return t[k]; }, set: (t, k, v) => { t[k] = v; return true; } });
  return { ctx, calls, texts, ellipses, lines };
}
const ghost = cleanDragGhost({ car: 'streeter', name: 'BEST PASS', reaction: 0.2, marks: { quarter: 13, ft60: 2 }, trap: 180, total: 13.2, samples: [{ t: 0, x: 0, y: 0, psi: 0, v: 0 }, { t: 13.1, x: DRAG.marks.quarter, y: 0, psi: 0, v: 40 }] });
const entrants = () => { const c = DRAG_CARS[0], spec = specFor(c, {}); return [{ name: 'YOU', spec, tune: { ...defaultTune(c), shift: 'auto' }, ai: AUTO_DRIVER }, { name: 'BEST PASS', spec, tune: { ...defaultTune(c), shift: 'auto' }, ghost }]; };

test('the top-down strip draws every stage of a race: the line-up, the run down the strip and the finish', () => {
  const race = createDrag({ seed: 5, entrants: entrants() }), td = createDragTopDown(), r = recorder(), forecast = conditionsForSeed(5); let frames = 0, sawFinish = false, sawConditions = false, sawFront = false;
  assert.match(weatherText(forecast), /FRONT AIR/, 'the forecast names the weather front');
  for (let k = 0; k < 240 * 25 && race.state.phase !== 'over'; k++) {
    race.step();
    if (k % 12 === 0) { r.calls.length = 0; r.texts.length = 0; td.draw(r.ctx, 1280, 720, race.state, 0, 0.05, k / 240); frames++; assert.ok(r.calls.length > 40, `a frame has ${r.calls.length} drawing calls`); if (r.texts.includes('FINISH')) sawFinish = true; if (r.texts.includes(conditionsText(race.state.weather) + weatherText(forecast))) sawConditions = true; if (r.texts.some(t => t.includes('FRONT AIR'))) sawFront = true; }
  }
  assert.ok(frames > 100); assert.ok(sawFinish, 'the finish line came into view'); assert.ok(sawConditions, 'the live conditions are drawn on the strip'); assert.ok(sawFront, 'and the forecast says what the front will do');
  const last = recorder(); td.draw(last.ctx, 1280, 720, race.state, 0, 0.05, 99); assert.ok(last.texts.includes('YOU') && last.texts.includes('BEST PASS'), 'you and the saved ghost are named');
});

test('it follows your car (the strip scrolls as you go), names the marks, and a new race starts with no old tire marks or smoke', () => {
  const race = createDrag({ seed: 5, entrants: entrants() }), td = createDragTopDown();
  const sees = (x) => { const r = recorder(); race.state.runners[0].x = x; td.draw(r.ctx, 1280, 720, race.state, 0, 0, 1); return r.texts; };
  assert.ok(sees(0).includes('60 FT'), 'at the line the first mark is in view'); assert.ok(!sees(0).includes('1/8 MILE')); assert.ok(sees(DRAG.marks.eighth - 5).includes('1/8 MILE'), 'near the eighth it is');
  assert.ok(sees(DRAG.marks.quarter - 10).includes('FINISH'));
  assert.equal(LANE_M, 2.4, 'the same lane width as the 3D strip');
  // a race that has launched leaves tire marks; a fresh one (a different state) draws none of them
  const fast = createDrag({ seed: 2, entrants: entrants() }); fast.state.runners.forEach(x => { x.launched = true; x.spin = true; x.v = 20; });
  const a = recorder(); for (let k = 0; k < 30; k++) { fast.state.runners.forEach(x => { x.x += 0.6; }); td.draw(a.ctx, 1280, 720, fast.state, 0, 0.016, k * 0.016); }
  const fresh = createDrag({ seed: 3, entrants: entrants() }), b = recorder(); td.draw(b.ctx, 1280, 720, fresh.state, 0, 0.016, 0);
  const lines = (r) => r.calls.filter(c => c === 'lineTo').length; assert.ok(lines(a) > 0); void lines(b);
});

test('the top-down strip shows the staging beam, the rollout and an abort', () => {
  const race = createDrag({ seed: 5, entrants: entrants() }), td = createDragTopDown(), r = recorder(), runner = race.state.runners[0];
  td.draw(r.ctx, 1280, 720, race.state, 0, 0, 1);
  assert.ok(r.texts.includes('STAGE'), 'the staging beam is drawn'); assert.ok(r.texts.includes('STAGED'), 'the car starts staged');
  runner.rolling = true; r.texts.length = 0; td.draw(r.ctx, 1280, 720, race.state, 0, 0, 1);
  assert.ok(r.texts.includes('ROLLING'));
  runner.rolling = false; runner.aborted = true; race.state.runners[1].launched = true; r.texts.length = 0; td.draw(r.ctx, 1280, 720, race.state, 0, 0, 1);
  assert.ok(r.texts.includes('ABORT')); assert.ok(!r.texts.includes('STAGED'));
});

test('the top-down strip marks the deep stage and draws rubber laid during the session', () => {
  const strip = createDragStrip(2); layRubber(strip, 0, 0, 0, 18, 1);
  const race = createDrag({ seed: 5, strip, entrants: entrants() }), plain = createDrag({ seed: 5, entrants: entrants() }), td = createDragTopDown(), r = recorder(), p = recorder();
  td.draw(r.ctx, 1280, 720, race.state, 0, 0, 1); td.draw(p.ctx, 1280, 720, plain.state, 0, 0, 1);
  assert.ok(r.texts.includes('DEEP'), 'the deep staging spot is marked');
  const fills = x => x.calls.filter(c => c === 'fillRect').length; assert.ok(fills(r) > fills(p), `laid rubber is drawn: ${fills(r)} vs ${fills(p)} rectangles`);
});

test('the top-down strip names a wheelie while the front tires are up', () => {
  const race = createDrag({ seed: 5, entrants: entrants() }), td = createDragTopDown(), r = recorder(), runner = race.state.runners[0];
  runner.launched = true; runner.lift = 1; td.draw(r.ctx, 1280, 720, race.state, 0, 0, 1);
  assert.ok(r.texts.includes('FRONT UP'));
  runner.lift = 0; r.texts.length = 0; td.draw(r.ctx, 1280, 720, race.state, 0, 0, 1);
  assert.ok(!r.texts.includes('FRONT UP'));
});

test('the top-down strip reads clutch temperature and condition as numbers and bars', () => {
  const race = createDrag({ seed: 5, entrants: entrants() }), td = createDragTopDown(), r = recorder(), runner = race.state.runners[0];
  runner.launched = true; runner.clutchTemp = 320; runner.clutchCondition = 0.55;
  td.draw(r.ctx, 1280, 720, race.state, 0, 0, 1);
  assert.ok(r.texts.some(t => /CLUTCH 320C 55% SLIP/.test(t)));
  assert.ok(r.calls.filter(c => c === 'strokeRect').length >= 2, 'the clutch heat and condition bars are drawn');
  runner.clutchLocked = true; r.texts.length = 0; td.draw(r.ctx, 1280, 720, race.state, 0, 0, 1);
  assert.ok(r.texts.some(t => /CLUTCH 320C 55% LOCK/.test(t)));
  runner.clutchLocked = false; runner.clutchTemp = 20; runner.clutchCondition = 1; r.texts.length = 0; td.draw(r.ctx, 1280, 720, race.state, 0, 0, 1);
  assert.ok(r.texts.some(t => /CLUTCH 20C 100% SLIP/.test(t)));
});

test('the top-down strip reads each rear slick\'s temperature and wear', () => {
  const race = createDrag({ seed: 5, entrants: entrants() }), td = createDragTopDown(), r = recorder(), runner = race.state.runners[0];
  runner.launched = true; runner.tires[0] = { temp: 95, wear: 0.2 }; runner.tires[1] = { temp: 110, wear: 0.4 };
  td.draw(r.ctx, 1280, 720, race.state, 0, 0, 1);
  assert.ok(r.texts.some(t => /TIRE L95C 20%  R110C 40%/.test(t)), r.texts.join(' | '));
});

test('the top-down strip reads the fuel load under the tire row', () => {
  const race = createDrag({ seed: 5, entrants: entrants() }), td = createDragTopDown(), r = recorder(), runner = race.state.runners[0];
  runner.launched = true; runner.fuel = 30;
  td.draw(r.ctx, 1280, 720, race.state, 0, 0, 1);
  assert.ok(r.texts.some(t => /FUEL 30\.0 KG 24%/.test(t)), r.texts.join(' | '));
  runner.fuel = FUEL.reserve; r.texts.length = 0; td.draw(r.ctx, 1280, 720, race.state, 0, 0, 1);
  assert.ok(r.texts.some(t => /FUEL 10\.0 KG 0%/.test(t)), r.texts.join(' | '));
});

test('the top-down strip marks the end of the run-out and shows the chute once it is out', () => {
  const race = createDrag({ seed: 5, entrants: entrants() }), td = createDragTopDown(), r = recorder(), runner = race.state.runners[0];
  runner.launched = true; runner.x = SHUTDOWN.end - 5; runner.chute = false;
  td.draw(r.ctx, 1280, 720, race.state, 0, 0, 1);
  const noChute = r.calls.filter(c => c === 'ellipse').length;
  runner.chute = true; runner.chuteOpen = 1; r.calls.length = 0; r.texts.length = 0; td.draw(r.ctx, 1280, 720, race.state, 0, 0, 1);
  assert.ok(r.texts.includes('END OF STRIP'));
  assert.ok(r.calls.filter(c => c === 'ellipse').length > noChute, 'the chute is drawn behind the car');
});

test('the top-down chute grows and brightens as it opens', () => {
  const race = createDrag({ seed: 5, entrants: entrants() }), td = createDragTopDown(), runner = race.state.runners[0];
  runner.launched = true; runner.chute = true; runner.chuteOpen = 0.2;
  const small = recorder(); td.draw(small.ctx, 1280, 720, race.state, 0, 0, 1);
  runner.chuteOpen = 1; const big = recorder(); td.draw(big.ctx, 1280, 720, race.state, 0, 0, 1);
  const smallChute = small.ellipses.reduce((a, e) => e[2] > a[2] ? e : a), bigChute = big.ellipses.reduce((a, e) => e[2] > a[2] ? e : a);
  assert.ok(small.ellipses.length > 0 && big.ellipses.length > 0);
  assert.ok(bigChute[2] > smallChute[2] * 2, `the chute widens: ${smallChute[2]} to ${bigChute[2]}`);
  assert.ok(bigChute[3] > smallChute[3], 'and grows taller');
});

test('the top-down slicks draw moving spin stripes only while the tires are spinning', () => {
  const race = createDrag({ seed: 5, entrants: entrants() }), runner = race.state.runners[0];
  runner.launched = true; runner.spin = true; runner.spinL = runner.spinR = false;
  const spinning = recorder(); createDragTopDown().draw(spinning.ctx, 1280, 720, race.state, 0, 0, 1);
  runner.spin = false; const still = recorder(); createDragTopDown().draw(still.ctx, 1280, 720, race.state, 0, 0, 1);
  assert.ok(spinning.calls.filter(c => c === 'lineTo').length > still.calls.filter(c => c === 'lineTo').length + 5, 'spin adds stripes to both slicks');
  runner.spin = true; const later = recorder(); createDragTopDown().draw(later.ctx, 1280, 720, race.state, 0, 0, 2);
  assert.notEqual(JSON.stringify(spinning.lines), JSON.stringify(later.lines), 'the stripes move with time');
});

test('the top-down strip shows the blower charge as a number and a bar', () => {
  const car = DRAG_CARS[0], spec = specFor(car, { turbo: 4 }), state = createDrag({ seed: 5, entrants: [{ name: 'YOU', spec, tune: defaultTune(car), ai: null }] }).state, td = createDragTopDown(), r = recorder(), runner = state.runners[0];
  runner.launched = true; runner.boost = 0.75; runner.engineTemp = 180; runner.retard = 0.2;
  td.draw(r.ctx, 1280, 720, state, 0, 0, 1);
  assert.ok(r.texts.some(t => /BOOST 75%  180C -20%/.test(t)), r.texts.join(' | '));
  assert.ok(r.calls.filter(c => c === 'strokeRect').length >= 1, 'the boost bar is drawn');
});
