// Formula mode on the page (phase 2): the one page runs both modes, the mode is kept in the save (old Drag saves load unchanged), the input layer drives the Formula car (rebindable, keyboard, pad, touch),
// the touch buttons and the HUD never overlap, the tune/lap/timeslip flow works headless, a lap is recorded (not an autopilot lap) and ranked laps are accepted by the backend's validator. Plus: no Drag regressions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { SAVE_VERSION, emptySave, sanitizeSave } from '../src/save.ts';
import { DEFAULT_BINDS, DEFAULT_PAD_BINDS, BIND_ROWS, assignKey, sanitizeOptions } from '../src/options/model.ts';
import { createControlState, toFormulaInput, toDriverInput } from '../src/input/controls.ts';
import { createInputQueue } from '../src/input/queue.ts';
import { actionsForKey } from '../src/input/keyboard.ts';
import { touchLayout, formulaTouchLayout, hitTest } from '../src/input/touch.ts';
import { DEFAULT_FORMULA_TUNE, cleanFormulaTune, formulaSpecForBenchmark } from '../src/formula/car.ts';
import { formulaCar, saveFormulaTune, saveToFormulaSlot, loadFormulaSlot, clearFormulaSlot, recordFormulaLap } from '../src/formula/model.ts';
import { createFormulaMode } from '../src/formula/page.ts';
import { buildFormulaPayload, createFormulaOnline, flattenFormulaTune, threeSectorSplits, whyFormulaNotRanked } from '../src/formula/online.ts';
import { createFormulaAutopilot, createFormulaRace, driveAutopilotLap, draw, ghostFromLeader, FORMULA_TRACKS } from '../src/formula/index.ts';
import { loadBackend } from './helpers/load-backend.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const benchmark = (o = {}) => ({ score: 5000, class: 'discrete', benchmarkVersion: 2, gpuId: 'RTX 3060', date: 1, ...o });

// ---- page wiring ----
test('one index.html and one bundle run both modes; the page has the MODE row first and Formula screens', () => {
  const html = read('index.html'), page = read('src/drag/page.ts'), build = read('build.mjs');
  assert.deepEqual([...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]), ['dist/gpuwars.js']);
  assert.match(build, /src\/drag\/page\.ts/, 'the one entry point'); assert.ok(existsSync(new URL('../src/formula/page.ts', import.meta.url)));
  assert.match(page, /from '\.\.\/formula\/page\.ts'/, 'the page imports the Formula page module (so the bundle holds both)');
  const start = page.indexOf("title('GPU WARS')"), block = page.slice(start, page.indexOf('], sel.title', start));
  assert.ok(block.indexOf('modeItem()') >= 0 && block.indexOf('modeItem()') < block.indexOf('benchmarkItem('), 'MODE is the first row');
  assert.match(page, /mode === 'formula' \? fm\.raceItem/, 'RACE CLASS LEADER switches to the mode'); assert.match(page, /FORMULA TUNE/); assert.match(page, /mode === 'formula' && fm\.result/, 'the Formula timeslip');
  const bundle = read('dist/gpuwars.js'); assert.ok(bundle.includes('FORMULA TUNE') && bundle.includes('DRIVING LINE') && bundle.includes('RACE CLASS LEADER'), 'the built bundle has both modes');
  assert.doesNotMatch(read('docs/ARCHITECTURE.md'), /not wired into `page\.ts`/, 'the docs no longer say Formula is unwired');
});
test('the Formula tune screen has no REPLACE TIRES (the car has no tyre wear) and has six tune slots', () => {
  const page = read('src/formula/page.ts'); assert.doesNotMatch(page, /replaceTires|REPLACE TIRES'\s*,\s*value/);
  const fm = createFormulaMode(stubHost().host), items = fm.tuneItems({ back() {}, test() {}, refresh() {} }), ids = items.map(i => i.id);
  for (const id of ['predicted', 'gearing', 'downforce', 'steering', 'pressure', 'nitro', 'gearbox', 'shiftLight', 'reset', 'slot', 'slotSave', 'slotLoad', 'slotClear', 'test', 'back']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('replaceTires'));
  for (const it of items) assert.ok(!it.hint || it.hint().length > 10, `${it.id} has a hint`);
  assert.match(items.find(i => i.id === 'predicted').value(), /^\d+\.\d{3} S$/, 'the predicted lap from predictFormula');
});

// ---- the save ----
test('save: an old Drag save (version 1 or 2) loads with every Drag field unchanged, mode DRAG and an empty Formula section', () => {
  const dragSave = { version: 2, benchmark: benchmark(), tune: { final: 3.4, shiftRpm: 8000 }, slots: [{ name: 'DRY', tune: { final: 3.3 } }, null, null, null, null, null], records: { races: 4, wins: 2, fouls: 1, crashes: 0, bestEt: 5.5, best60: 0.9, bestTrap: 260, bestReaction: 0.05, history: [] } };
  const loaded = sanitizeSave(dragSave);
  assert.equal(loaded.mode, 'drag'); assert.equal(loaded.version, SAVE_VERSION);
  assert.deepEqual(loaded.benchmark, benchmark()); assert.equal(loaded.tune.final, 3.4); assert.equal(loaded.slots[0].name, 'DRY'); assert.equal(loaded.records.bestEt, 5.5); assert.equal(loaded.records.races, 4);
  assert.deepEqual(loaded.formula, emptySave().formula, 'Formula starts empty');
  assert.equal(sanitizeSave({ version: 1, tune: { final: 3.5 } }).tune.final, 3.5);
  assert.deepEqual(sanitizeSave(null), emptySave()); assert.deepEqual(sanitizeSave('junk').formula, emptySave().formula);
});
test('save: the mode, Formula tune, slots and records round-trip, and hostile Formula data is repaired', () => {
  let s = { ...emptySave(), mode: 'formula', benchmark: benchmark() };
  s = saveFormulaTune(s, { gearing: 0.3, nitro: 2, gearbox: 'auto' }); s = saveToFormulaSlot(s, 1, 'BEACH DRY', s.formula.tune);
  const back = sanitizeSave(JSON.parse(JSON.stringify(s)));
  assert.equal(back.mode, 'formula'); assert.deepEqual(back.formula.tune, cleanFormulaTune({ gearing: 0.3, nitro: 2, gearbox: 'auto' })); assert.equal(back.formula.slots[1].name, 'BEACH DRY');
  assert.equal(sanitizeSave({ mode: 'rocket' }).mode, 'drag', 'an unknown mode falls back to DRAG');
  const hostile = sanitizeSave({ formula: { tune: { gearing: 99, nitro: 'x', downforce: -5 }, slots: 'no', records: { bestLap: -3, races: 'a', history: [{ lapTime: 1e12, against: 5 }, 7], bestSectors: [1, 'z'] } } });
  assert.deepEqual(hostile.formula.tune, cleanFormulaTune({ gearing: 1, downforce: 0 })); assert.equal(hostile.formula.records.bestLap, 0); assert.equal(hostile.formula.records.races, 0);
  assert.ok(hostile.formula.records.history.every(h => h.lapTime <= 3600)); assert.equal(hostile.formula.slots.length, 6);
  assert.deepEqual(loadFormulaSlot(clearFormulaSlot(s, 1), 1).formula.tune, clearFormulaSlot(s, 1).formula.tune, 'loading an empty slot changes nothing');
  assert.equal(loadFormulaSlot(saveFormulaTune(s, DEFAULT_FORMULA_TUNE), 1).formula.tune.nitro, 2, 'loading a slot makes its tune the tune');
});
test('save: Formula records keep the bests of clean laps only, and Drag records are untouched', () => {
  const slip = (o = {}) => ({ trackId: 'beach', finished: true, valid: true, jumpStart: false, reaction: 0.2, lapTime: 41, splits: [10, 20, 41], sectors: [10, 10, 21], launchTime: 1, topSpeed: 300, wallHits: 0, ...o });
  const s0 = { ...emptySave(), benchmark: benchmark() };
  const a = recordFormulaLap(s0, { kind: 'ranked', slip: slip(), won: true }, 1); assert.equal(a.save.formula.records.bestLap, 41); assert.deepEqual(a.records, [], 'a first lap sets the bests without breaking one');
  const b = recordFormulaLap(a.save, { kind: 'ranked', slip: slip({ lapTime: 40, sectors: [9, 10, 21], topSpeed: 310 }), won: true }, 2); assert.ok(b.records.includes('BEST LAP') && b.records.includes('BEST TOP SPEED') && b.records.includes('BEST SECTOR 1'));
  const c = recordFormulaLap(b.save, { kind: 'ranked', slip: slip({ jumpStart: true, valid: false, lapTime: 30 }), won: false }, 3); assert.equal(c.save.formula.records.bestLap, 40, 'a jump start is never a best'); assert.equal(c.save.formula.records.jumpStarts, 1);
  const t = recordFormulaLap(c.save, { kind: 'test', slip: slip({ lapTime: 39 }), won: false }, 4); assert.equal(t.save.formula.records.races, c.save.formula.records.races, 'a test lap is not a race'); assert.equal(t.save.formula.records.bestLap, 39);
  assert.deepEqual(t.save.records, emptySave().records, 'Drag records never change'); assert.ok(t.save.formula.records.history.length <= 10);
});

// ---- input ----
const tick = (q, s, t) => { for (const e of q.drain(t, 0)) s.apply(e); const i = toFormulaInput(s); s.endTick(); return i; };
test('input mapping: gas, brake, steer, nitro are held; a shift is one press per key press; the launch key does nothing in Formula', () => {
  const q = createInputQueue(), s = createControlState();
  q.push({ t: 1, kind: 'down', control: 'gas', source: 'k:w', value: 1 }); q.push({ t: 1, kind: 'down', control: 'steerLeft', source: 'k:a', value: 1 }); q.push({ t: 1, kind: 'down', control: 'nitro', source: 'k:shift', value: 1 });
  let i = tick(q, s, 2); assert.deepEqual([i.throttle, i.brake, i.steer, i.nitro, i.shiftUp], [1, 0, -1, true, false]);
  q.push({ t: 3, kind: 'down', control: 'shiftUp', source: 'k:e', value: 1 }); assert.equal(tick(q, s, 4).shiftUp, true, 'the press lands once'); assert.equal(tick(q, s, 5).shiftUp, false, 'held: no second shift'); assert.equal(tick(q, s, 6).nitro, true, 'nitro stays held');
  q.push({ t: 7, kind: 'up', control: 'shiftUp', source: 'k:e', value: 1 }); q.push({ t: 8, kind: 'down', control: 'shiftDown', source: 'k:q', value: 1 }); tick(q, s, 7.5); assert.equal(tick(q, s, 9).shiftDown, true);
  q.push({ t: 10, kind: 'down', control: 'brake', source: 'k:s', value: 1 }); q.push({ t: 10, kind: 'down', control: 'launch', source: 'k:Enter', value: 1 }); i = tick(q, s, 11); assert.equal(i.brake, 1); assert.equal(i.shiftUp, false, 'Enter (launch) does not shift in Formula');
  const drag = toDriverInput(s); assert.equal(drag.shiftUp, true, 'the Drag mapping still has launch shift up (unchanged)');
  q.push({ t: 12, kind: 'down', control: 'drivingLine', source: 'k:l', value: 1 }); assert.equal(tick(q, s, 13).toggleLine, true); assert.equal(tick(q, s, 14).toggleLine, false);
  q.push({ t: 15, kind: 'analog', control: 'gasPad', source: 'p', value: 0.4 }); q.push({ t: 15, kind: 'analog', control: 'steerTouch', source: 't', value: 2 }); i = tick(q, s, 16); assert.ok(i.throttle >= 0.4 && i.steer === 1, 'analog gas and steering clamp to 0..1 and -1..1');
});
test('the Formula input fits the Formula car: driven only through the mapped (digital) input the car leaves the grid, takes the start line and moves on without a NaN', () => {
  const race = createFormulaRace(), ap = createFormulaAutopilot(race.track, race.state.car.stats);
  for (let i = 0; i < 60 * 14; i++) { const raw = ap.decide(race.view()), q = createInputQueue(), s = createControlState(); for (const [c, on] of [['gas', raw.throttle > 0.5], ['brake', raw.brake > 0.1], ['steerLeft', raw.steer < -0.3], ['steerRight', raw.steer > 0.3]]) if (on) q.push({ t: 0, kind: 'down', control: c, source: 'k', value: 1 }); const { toggleLine, ...inp } = tick(q, s, 1); race.step(inp); }
  const v = race.view(); assert.ok(v.phase === 'racing' && v.lapClock > 0 && v.car.kmh > 20 && Number.isFinite(v.car.x), `${v.phase} ${v.lapClock} ${v.car.kmh}`);
});
test('rebinding: DRIVING LINE is a rebindable action with its own default, Drag binds are unchanged, and it is an option', () => {
  assert.deepEqual(DEFAULT_BINDS.drivingLine, ['l', '']); assert.ok(BIND_ROWS.some(r => r[0] === 'drivingLine')); assert.deepEqual(DEFAULT_PAD_BINDS.drivingLine, [8, -1]);
  const drag = { gas: ['w', 'ArrowUp'], brake: ['s', 'ArrowDown'], steerLeft: ['a', 'ArrowLeft'], steerRight: ['d', 'ArrowRight'], chute: ['n', ''], shiftUp: ['e', ''], shiftDown: ['q', ''], burnout: ['j', ''], nitro: ['Shift', ''], launch: ['u', ' '], deepStage: ['h', ''], backUp: ['r', ''] };
  for (const [id, keys] of Object.entries(drag)) assert.deepEqual(DEFAULT_BINDS[id], keys, `${id} keeps its default`);
  const r = assignKey(DEFAULT_BINDS, 'drivingLine', 'k'); assert.ok(r.ok); assert.deepEqual(actionsForKey(r.binds, 'k'), ['drivingLine']);
  assert.equal(sanitizeOptions(null).drivingLine, false); assert.equal(sanitizeOptions({ drivingLine: true }).drivingLine, true); assert.equal(sanitizeOptions({ drivingLine: 'yes' }).drivingLine, false);
  assert.deepEqual(sanitizeOptions({ binds: { gas: ['z', ''] } }).binds.drivingLine, ['l', ''], 'an old options record gets the new action');
});

// ---- touch layout and the HUD ----
const SIZES = [[844, 390], [1280, 720], [390, 844], [360, 640], [800, 450], [667, 375]];
const apart = (a, b) => a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5;
test('Formula touch layout: exactly its buttons, on screen, none overlapping, steering is a left and a right button; the Drag layout is unchanged', () => {
  const ids = ['steerLeft', 'steerRight', 'gas', 'brake', 'nitro', 'shiftUp', 'shiftDown', 'drivingLine', 'menu'];
  for (const [w, h] of SIZES) for (const size of [0.7, 1, 1.5]) {
    const L = touchLayout(w, h, size, 'formula'); assert.deepEqual(L.map(r => r.id).sort(), [...ids].sort());
    for (const r of L) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= w + 0.5 && r.y + r.h <= h + 0.5, `${r.id} on screen at ${w}x${h} x${size}`);
    for (const a of L) for (const b of L) if (a.id < b.id) assert.ok(apart(a, b), `${a.id} overlaps ${b.id} at ${w}x${h} x${size}`);
    assert.ok(L.find(r => r.id === 'steerLeft').x < L.find(r => r.id === 'steerRight').x);
  }
  const L = formulaTouchLayout(844, 390), gas = L.find(r => r.id === 'gas'); assert.equal(hitTest(L, gas.x + 5, gas.y + 5).id, 'gas');
  assert.deepEqual(touchLayout(844, 390, 1).map(r => r.id).sort(), touchLayout(844, 390, 1, 'drag').map(r => r.id).sort()); assert.ok(touchLayout(844, 390).some(r => r.id === 'chute'), 'Drag still has its chute');
});
function recorder() {
  const texts = []; let font = '10px monospace';
  const ctx = new Proxy({}, { get: (t, k) => { if (k === 'measureText') return s => ({ width: String(s).length * 7 }); if (k === 'createLinearGradient') return () => ({ addColorStop() {} }); if (k === 'fillText') return (s, x, y) => texts.push({ s: String(s), x, y, size: Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 0) }); if (k === 'font') return font; if (k in t) return t[k]; return () => {}; }, set: (t, k, v) => { if (k === 'font') font = v; t[k] = v; return true; } });
  return { ctx, texts };
}
test('with the touch buttons on, no HUD box (left panel, gear box, map) overlaps a button, at every size and in every phase of a lap', () => {
  for (const [w, h] of SIZES) {
    const touch = touchLayout(w, h, 1, 'formula'), race = createFormulaRace(), ap = createFormulaAutopilot(race.track, race.state.car.stats);
    for (let i = 0; i < 1800 && !race.over; i++) {
      race.step(ap.decide(race.view())); if (i % 150 !== 0 && !race.over) continue;
      const r = recorder(), boxes = draw(r.ctx, w, h, race.view(), { time: i / 60, avoid: touch });
      for (const [name, box] of Object.entries(boxes)) if (box) for (const b of touch) assert.ok(apart(box, b), `${name} overlaps ${b.id} at ${w}x${h}, step ${i}: ${JSON.stringify(box)}`);
      assert.ok(boxes.gearBox.x >= 0 && boxes.gearBox.y >= 0 && boxes.gearBox.x + boxes.gearBox.w <= w + 0.5 && boxes.gearBox.y + boxes.gearBox.h <= h + 0.5, 'the gear box stays on screen');
      for (const t of r.texts) assert.ok(t.size >= 10, `"${t.s}" is readable`);
    }
  }
  const r = recorder(), boxes = draw(r.ctx, 1280, 720, createFormulaRace().view()); assert.ok(boxes.map && boxes.gearBox.y > 600, 'with no touch buttons the map and the bottom-right gear box are where they were');
});

// ---- the lap, headless ----
function stubHost(over = {}) {
  let save = { ...emptySave(), benchmark: benchmark() }; const options = sanitizeOptions(null), sent = [], sounds = [], commits = [];
  const input = { reset() {}, startFrame() {}, readFormula: () => ({ throttle: 0, brake: 0, steer: 0, shiftUp: false, shiftDown: false, nitro: false, toggleLine: false }), draw() {} };
  const sfx = { treeLight: (...a) => sounds.push(['tree', ...a]), engine: () => {}, liftOff: () => sounds.push(['lift']), unlock() {}, volumesChanged() {} };
  const online = { ghost: () => ghostFromLeader(FORMULA_TRACKS[0], { name: 'LEADER', lapTime: 60 }), leader: () => null, note: () => '', className: () => 'DISCRETE', status: '', clearStatus() {}, submitLap: async (slip, tune) => { sent.push({ slip, tune }); return 'SENT'; }, refreshLeader: async () => {} };
  const host = { options, save: () => save, commit: s => { save = s; commits.push(s); }, online, input, sfx, pad: () => null, saveOptions() {}, ...over };
  return { host, options, sent, sounds, commits, get save() { return save; }, input };
}
function runLap(fm, ctl, ms = 3600) { let t = 0, shown = false; for (let i = 0; i < ms * 60 && !shown; i++) { t += 1000 / 60; shown = fm.frame(1 / 60, t, true); } return shown; }
test('a manual ranked lap runs start to timeslip: lights beeps, one lap, recorded, sent, with the VS table; a jump start is not ranked', () => {
  const ctl = stubHost(), fm = createFormulaMode(ctl.host); let ap = null;
  ctl.input.readFormula = () => { ap ??= createFormulaAutopilot(fm.race.track, fm.race.state.car.stats); return { ...ap.decide(fm.race.view()), toggleLine: false }; };
  fm.start('ranked'); assert.ok(runLap(fm, ctl), 'the timeslip comes up after the lap');
  const R = fm.result, v = fm.slipView(); assert.ok(R.slip.finished && R.slip.valid && R.slip.lapTime > 30 && R.slip.lapTime < 60, `lap ${R.slip.lapTime}`); assert.equal(R.category, 'manual'); assert.equal(R.won, true, 'faster than the 60 s ghost');
  assert.equal(ctl.sent.length, 1, 'a clean ranked lap is sent once'); assert.equal(ctl.save.formula.records.bestLap, R.slip.lapTime); assert.equal(ctl.save.formula.records.races, 1); assert.deepEqual(ctl.save.records, emptySave().records);
  assert.equal(v.title, 'YOU WIN'); assert.ok(v.html.includes('VS LEADER') && v.html.includes('SECTOR 1') && v.html.includes('LAP TIME') && v.html.includes('TOP SPEED') && v.html.includes('R/T'));
  assert.deepEqual(ctl.sounds.filter(s => s[0] === 'tree').map(s => s.slice(1).join(':')), ['amber:1', 'amber:2', 'amber:3', 'green'], 'the three lights then the green');
  // a jump start: gas before the green
  const c2 = stubHost(), f2 = createFormulaMode(c2.host); c2.input.readFormula = () => ({ throttle: 1, brake: 0, steer: 0, shiftUp: false, shiftDown: false, nitro: false, toggleLine: false });
  f2.start('ranked'); for (let i = 0; i < 60 * 5; i++) f2.frame(1 / 60, i * 16.7, true); assert.equal(f2.race.view().jumpStart, true);
  assert.match(whyFormulaNotRanked(benchmark(), { ...R.slip, jumpStart: true }), /JUMP START/);
});
test('autopilot laps are a separate category and skip your local records; a test lap is not ranked', () => {
  const ctl = stubHost(); ctl.host.options.driver = 'autopilot'; const fm = createFormulaMode(ctl.host);
  fm.start('ranked'); assert.ok(runLap(fm, ctl)); assert.equal(fm.result.category, 'autopilot'); assert.equal(ctl.sent.length, 1, 'it still goes to the (autopilot) leaderboard'); assert.equal(ctl.commits.length, 0, 'and writes nothing to the save');
  const c2 = stubHost(); let ap = null; const f2 = createFormulaMode(c2.host); c2.input.readFormula = () => { ap ??= createFormulaAutopilot(f2.race.track, f2.race.state.car.stats); return { ...ap.decide(f2.race.view()), toggleLine: false }; };
  f2.start('test'); assert.ok(runLap(f2, c2)); assert.equal(c2.sent.length, 0, 'a test run is never sent'); assert.equal(f2.race.ghost, null, 'a test run has no ghost'); assert.equal(c2.save.formula.records.races, 0, 'and is not a race');
});
test('the driving line key flips the option and keeps it', () => {
  const ctl = stubHost(); let saved = 0; ctl.host.saveOptions = () => saved++; const fm = createFormulaMode(ctl.host); ctl.input.readFormula = () => ({ throttle: 0, brake: 0, steer: 0, shiftUp: false, shiftDown: false, nitro: false, toggleLine: true });
  fm.start('test'); fm.frame(1 / 60, 16, true); assert.equal(ctl.host.options.drivingLine, true); assert.equal(saved, 1);
});

// ---- the leaderboard ----
test('a ranked lap becomes a payload the backend accepts (formula mode, three sectors, mph), and the leader makes a ghost', async () => {
  const { validate } = await loadBackend(); const race = driveAutopilotLap({ spec: formulaSpecForBenchmark(benchmark({ score: 9000 })) }), slip = race.timeslip(), tune = cleanFormulaTune(null);
  const splits = threeSectorSplits(slip); assert.ok(splits.sector1 > 0 && splits.sector1 < splits.sector2 && splits.sector2 < splits.lap && splits.lap === +slip.lapTime.toFixed(3));
  const p = buildFormulaPayload({ playerName: 'SPEEDY', category: 'manual', benchmark: benchmark({ score: 9000 }), slip, tune }); assert.equal(p.mode, 'formula'); assert.equal(p.track, 'beach'); assert.ok(Math.abs(p.topSpeed - slip.topSpeed * 0.621371) < 0.06);
  assert.deepEqual(flattenFormulaTune(tune), { gearing: 0, downforce: 0.5, steering: 0, pressure: 0, nitro: 0, shiftLight: 0.9, gearboxAuto: 0 }); assert.equal(buildFormulaPayload({ ...{ playerName: 'SPEEDY', category: 'manual', benchmark: null, slip, tune } }), null, 'no benchmark: no payload');
  assert.equal(buildFormulaPayload({ playerName: 'SPEEDY', category: 'manual', benchmark: benchmark(), slip: { ...slip, jumpStart: true, valid: false }, tune }), null);
  // (the SHAPE is what is checked here: the server's lap and top-speed windows are PLACEHOLDERS that the real simulation's numbers do not fit yet; phase 3 calibrates both sides, see docs/ARCHITECTURE.md)
  const shaped = validate.validateSubmission({ ...p, benchmarkScore: 5000, splits: { sector1: 22, sector2: 44, lap: 64 }, topSpeed: 177 }); assert.ok(shaped.ok, `the server's validator: ${JSON.stringify(shaped)}`);
});
test('online: the leader comes from the shared client with mode formula, a missing leader means no ghost, and a lap is sent through client.submit', async () => {
  const calls = []; const client = { configured: true, leader: async (...a) => { calls.push(['leader', ...a]); return { record: { name: 'ACE', class: 'discrete', category: 'manual', track: 'beach', timeS: 41.5, topSpeed: 180, sectors: { sector1: 12, sector2: 25, lap: 41.5 }, seed: 1, tune: {}, ghost: null }, online: true, note: '' }; }, submit: async p => { calls.push(['submit', p]); return { ok: true, classRank: 2, verified: false }; } };
  const o = createFormulaOnline({ client, benchmark: () => benchmark(), playerName: () => 'SPEEDY', category: () => 'manual', onChange() {} });
  assert.equal(o.ghost(), null, 'before the leader answers there is no ghost'); await o.refreshLeader(); assert.deepEqual(calls[0], ['leader', 'discrete', 'manual', { mode: 'formula', track: 'beach' }]);
  const g = o.ghost(); assert.equal(g.name, 'ACE'); assert.equal(g.lapTime, 41.5); assert.equal(o.ghost(), g, 'cached');
  const race = driveAutopilotLap({}); const line = await o.submitLap(race.timeslip(), cleanFormulaTune(null)); assert.match(line, /SENT: RANK 2/); assert.equal(calls[1][1].mode, 'formula');
});

// ---- the formula car from the save ----
test('the car comes from the benchmark and the saved tune; the unbenchmarked player has the weakest car', () => {
  const none = formulaCar(emptySave()), strong = formulaCar({ ...emptySave(), benchmark: benchmark({ score: 10000 }) });
  assert.ok(none.spec.engine < strong.spec.engine); assert.deepEqual(none.tune, DEFAULT_FORMULA_TUNE);
});
