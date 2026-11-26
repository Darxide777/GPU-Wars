// The race screen's HUD: every readout shown DURING a run is in ONE panel on the left, the text is short (no conditions, fuel, pressures, splits, ghost words), no value is written twice,
// and nothing written while staging (the stage line, the keys to press, the beam and mark names beside the strip) overlaps anything else at 800x450, 1280x720, 420x860 and 360x640.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrag, AUTO_DRIVER, STAGE, DRAG, stageLabel } from '../src/drag/physics.ts';
import { createDragTopDown, carNoseY } from '../src/drag/topdown.ts';
import { drawProgress, runPanelBox, guidePrompt, promptBox, tachPlacement, tachObstacles, carBand, treeRect, wrapNote, PHONE_HUD } from '../src/drag/hud.ts';
import { touchLayout } from '../src/input/touch.ts';
import { DRAG_CARS } from '../src/drag/data.ts';
import { defaultTune, specFor } from '../src/drag/tune.ts';

const SIZES = [[800, 450], [1280, 720], [420, 860], [360, 640]];
/** the four sizes plus a touch landscape phone */
const TOUCH_SIZES = [...SIZES, [844, 390]];
const MIN_FONT = PHONE_HUD.minFont;
const scaleOf = H => Math.max(0.7, Math.min(1.6, H / 720));
const keys = { launch: 'X', nitro: 'N', manual: true, gas: 'W', burnout: 'J', brake: 'S', chute: 'C', deepStage: 'H', backUp: 'R' };
/** what the page passes with the touch buttons on screen: the buttons' own names */
const touchKeys = { launch: 'GO', nitro: 'NITRO', manual: true, gas: 'GAS', burnout: 'BURN', brake: 'BRAKE', chute: 'CHUTE', deepStage: 'DEEP', backUp: 'BACK UP', touch: true };
/** a canvas that keeps every text with its place, size and alignment, and every filled rectangle */
function recorder() {
  const items = [], rects = []; let font = 12, align = 'left';
  const ctx = new Proxy({}, {
    get: (t, k) => {
      if (k === 'fillText') return (s, x, y) => items.push({ s: String(s), x, y, size: font, align });
      if (k === 'strokeText') return () => {};
      if (k === 'fillRect') return (x, y, w, h) => rects.push({ x, y, w, h });
      if (k === 'measureText') return s => ({ width: String(s).length * font * 0.6 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      return k in t ? t[k] : () => {};
    },
    set: (t, k, v) => { if (k === 'font') font = Number(/(\d+(?:\.\d+)?)px/.exec(String(v))?.[1] ?? 12); if (k === 'textAlign') align = String(v); t[k] = v; return true; },
  });
  return { ctx, items, rects };
}
const boxOf = i => { const w = i.s.length * i.size * 0.6, x0 = i.align === 'right' ? i.x - w : i.align === 'center' ? i.x - w / 2 : i.x; return { x0, x1: x0 + w, y0: i.y - i.size * 0.85, y1: i.y + i.size * 0.2 }; };
const hit = (a, b) => a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5;
const car = DRAG_CARS[0], spec = specFor(car, {}), tune = { ...defaultTune(car), shift: 'auto' };
const raceOf = (quick = false) => createDrag({ seed: 5, quickStart: quick, entrants: [{ name: 'YOU', spec, tune, ai: AUTO_DRIVER }, { name: 'BEST PASS', spec, tune, ai: AUTO_DRIVER }] });
/** one whole frame as the page draws it: the strip, then the HUD */
function frame(race, W, H, touch = false, extra = {}) {
  const r = recorder(), td = createDragTopDown(), avoid = touch ? touchLayout(W, H, 1) : [], k = { ...(touch ? touchKeys : keys), ...extra, avoid }, S = scaleOf(H), me = race.state.runners[0];
  td.draw(r.ctx, W, H, race.state, 0, 0.016, race.state.t); const strip = r.items.length; drawProgress(r.ctx, W, H, race.state, 0, S, k);
  const box = runPanelBox(W, H, S, me, avoid), guide = guidePrompt(me, race.state, k), prompt = guide ? promptBox(W, H, S, guide, box, avoid) : null;
  const o = tachObstacles(W, H, S, race.state.runners.length, box, avoid), tach = tachPlacement(W, H, S, o.hard, o.soft);
  // which texts are the tachometer's (inside its box), the instruction line's (inside its backing) and the panel's
  const inRect = (i, q) => q && boxOf(i).x0 >= q.x - 1 && boxOf(i).x1 <= q.x + q.w + 1 && i.y >= q.y - 1 && i.y <= q.y + q.h + 1;
  const all = r.items.slice(strip), tachItems = all.filter(i => inRect(i, tach?.box)), promptItems = all.filter(i => inRect(i, prompt)), panelItems = all.filter(i => !tachItems.includes(i) && !promptItems.includes(i) && inRect(i, { x: box.x, y: box.y, w: box.w, h: box.h }));
  return { ...r, strip, avoid, box, S, guide, prompt, tach, hud: all, tachItems, promptItems, panelItems, texts: all.filter(i => !tachItems.includes(i) && !promptItems.includes(i)) };
}
/** the tree's backing box (see drawTree) */
const treeBox = (W, S, lanes) => ({ x0: W / 2 - (lanes * 13 + 6) * S, x1: W / 2 + (lanes * 13 + 6) * S, y0: 60 * S, y1: 60 * S + 15 * S * 7 + 12 * S });
const asBox = q => ({ x0: q.x, x1: q.x + q.w, y0: q.y, y1: q.y + q.h });
const MOVED = /AIR|TRACK|DENSITY|DA |ALT|RHO|WIND|FRONT AIR|PSI|FUEL|ENGINE|REAR WEIGHT|BRAKE \d|CHUTE \d|RANKED|FREE PLAY|CLASS|LEADER|GHOST|BEST PASS|\bVS\b|TRAP|1\/4 MILE|60 FT \d|1\/8 \d|NOSE|WEAR|CLUTCH \d|DELTA/;

test('every run readout is drawn inside the left panel, and nothing that belongs on the timeslip is written, at four window sizes through a whole staged run', () => {
  for (const [W, H] of SIZES) {
    const race = raceOf(), seenStages = new Set(); let frames = 0;
    for (let k = 0; k < 240 * 90 && race.state.phase !== 'over'; k++) {
      race.step(); if (k % 60) continue; frames++; seenStages.add(race.state.runners[0].stage);
      const f = frame(race, W, H), panel = f.hud, inside = f.panelItems;
      const centre = f.texts.filter(i => !inside.includes(i));
      assert.ok(centre.every(i => i.s === 'You crashed'), `${W}x${H}: only the crash alert is outside the panel, the tachometer and the instruction line: ${centre.map(i => i.s).join(' | ')}`);
      assert.ok(inside.length >= 2, `${W}x${H}: the panel has its readouts`); assert.ok(f.tachItems.length >= 3, `${W}x${H}: the tachometer is drawn`);
      for (const i of panel) assert.ok(!MOVED.test(i.s), `${W}x${H}: "${i.s}" belongs on the timeslip`);
      assert.ok(f.box.x + f.box.w < W / 2 - 20 * scaleOf(H), `${W}x${H}: the panel stops short of the tree`);
      assert.ok(f.box.y + f.box.h <= H, `${W}x${H}: and ends on the screen`);
      const texts = f.texts.map(i => i.s); assert.equal(new Set(texts).size, texts.length, `${W}x${H}: no line twice: ${texts.join(' | ')}`);
      assert.ok(panel.length <= 26, `${W}x${H}: the in-run text is short (${panel.length} lines)`);
    }
    assert.ok(frames > 20 && ['burnout', 'backup', 'preStage'].every(s => seenStages.has(s)), `${W}x${H}: the run passed through ${[...seenStages].join(', ')}`);
  }
});

test('a value is written once: air temperature and the rest of the conditions are not on the race screen, speed and rpm once each, the stage name once', () => {
  const race = raceOf(true), me = race.state.runners[0]; me.launched = true; me.v = 40; me.rpm = 7000; me.gear = 2; me.launchT = 0; me.reaction = 0.05;
  for (const [W, H] of SIZES) {
    const f = frame(race, W, H), all = f.items.map(i => i.s);
    assert.equal(all.filter(t => /KM\/H/.test(t)).length, 1, `${W}x${H}: speed once`); assert.equal(all.filter(t => /RPM/.test(t)).length, 1, 'rpm once');
    assert.equal(all.filter(t => /R\/T/.test(t)).length, 1, 'reaction once'); assert.equal(all.filter(t => /^T \d/.test(t)).length, 1, 'the run timer once');
    assert.equal(all.filter(t => /NITRO|BOOST/.test(t) && !/:/.test(t)).length, all.filter(t => /NITRO|BOOST/.test(t) && !/:/.test(t)).length);
  }
  const stagedRace = raceOf(true), f = frame(stagedRace, 1280, 720); assert.equal(f.items.filter(t => /STAGED/.test(t.s)).length, 1, 'the stage name is written once');
});

test('no ghost text during a run: no name, stage, ET, delta, VS or class leader on the race screen', () => {
  for (const [W, H] of SIZES) {
    const race = raceOf(); const g = race.state.runners[1];
    for (let k = 0; k < 240 * 70 && race.state.phase !== 'over'; k++) { race.step(); if (k % 240) continue; g.name = 'SPEEDY'; const f = frame(race, W, H); for (const i of f.items) assert.ok(!/SPEEDY|BEST PASS|GHOST|LEADER|\bVS\b|^ET |DELTA/.test(i.s) && !/^[-+]\d\.\d{3}$/.test(i.s), `${W}x${H}: ghost text "${i.s}"`); }
  }
});

test('the staging text never overlaps: stage line, key prompts, beam and mark names, the tree, the panel and the cars, in every staging phase and with two cars close together', () => {
  const phases = [['waterBoxApproach', STAGE.waterBoxStart + 1], ['burnout', STAGE.waterBoxEnd + 3], ['runOut', DRAG.marks.ft60 > 0 ? 20 : 20], ['backup', 6], ['preStage', -STAGE.preStageRollout + 0.05], ['staged', -DRAG.stageRollout + 0.03], ['deepStaged', -DRAG.deepStageRollout + 0.02], ['preStage', -STAGE.preStageRollout - 0.4]];
  for (const [W, H] of SIZES) {
    const S = scaleOf(H);
    for (const closeCars of [false, true]) for (const [stage, x] of phases) {
      const race = raceOf(), [a, b] = race.state.runners; a.stage = stage; a.x = x; a.deepStage = stage === 'deepStaged'; a.burnout = stage === 'burnout'; a.reversing = stage === 'backup'; a.v = stage === 'backup' ? -1.5 : 0; a.overstaged = x < -DRAG.stageRollout - 0.3; a.preBulb = a.stageBulb = stage === 'staged' || stage === 'deepStaged';
      b.x = closeCars ? x + 0.2 : x - 30; b.stage = stage; race.state.runners[1].y = 0;
      const f = frame(race, W, H), label = `${W}x${H} ${stage} x=${x}${closeCars ? ' (cars close)' : ''}`;
      const texts = f.items.map(i => ({ i, b: boxOf(i) })), tree = treeBox(W, S, 2), panel = { x0: f.box.x, x1: f.box.x + f.box.w, y0: f.box.y, y1: f.box.y + f.box.h };
      // (the beam and mark names beside the strip are the strip's: the gauge and the line are drawn over them, and the cars, tree, panel and touch buttons are what they must clear)
      const fromStrip = i => f.items.indexOf(i) < f.strip, mineOf = i => f.tachItems.includes(i) || f.promptItems.includes(i);
      for (let p = 0; p < texts.length; p++) for (let q = p + 1; q < texts.length; q++) if (!((fromStrip(texts[p].i) && mineOf(texts[q].i)) || (fromStrip(texts[q].i) && mineOf(texts[p].i)))) assert.ok(!hit(texts[p].b, texts[q].b), `${label}: "${texts[p].i.s}" overlaps "${texts[q].i.s}"`);
      const scale = H / (28 + Math.abs(a.v) * 0.55), wall = W / 2 + 4.8 * scale;
      for (const t of texts) {
        const inPanel = t.b.x0 >= panel.x0 - 1 && t.b.x1 <= panel.x1 + 1, mine = f.tachItems.includes(t.i) || f.promptItems.includes(t.i);
        if (mine) { assert.ok(!hit(t.b, tree), `${label}: "${t.i.s}" overlaps the tree`); assert.ok(t.b.x1 <= W + 1 && t.b.x0 >= -1, `${label}: "${t.i.s}" runs off the screen`); }
        else if (!inPanel) { assert.ok(t.b.x0 >= wall - 1, `${label}: "${t.i.s}" (x ${t.b.x0.toFixed(0)}) is beside the strip, past its wall at ${wall.toFixed(0)}`); assert.ok(!hit(t.b, tree), `${label}: "${t.i.s}" overlaps the tree`); assert.ok(t.b.x1 <= W + 1, `${label}: "${t.i.s}" runs off the screen`); }
        else assert.ok(!hit(t.b, tree), `${label}: panel text "${t.i.s}" overlaps the tree`);
        assert.ok(t.i.size >= MIN_FONT - 1e-9, `${label}: "${t.i.s}" is only ${t.i.size.toFixed(1)}px`);
      }
      assert.ok(panel.x1 < tree.x0, `${label}: the panel is left of the tree`);
      // the instruction line, the tachometer, the panel, the tree and both cars are all apart
      const cars = [0, 1].map(i => { const sc = H / (28 + Math.abs(a.v) * 0.55), cx = W / 2 + (i === 0 ? -2.4 : 2.4) * sc, rr = i === 0 ? a : b, y = H * 0.68 - (rr.x - a.x) * sc; return { x0: cx - 1.1 * sc, x1: cx + 1.1 * sc, y0: y - 2.7 * sc, y1: y + 2.5 * sc }; });
      const parts = { panel, tree, tach: f.tach && asBox(f.tach.box), prompt: f.prompt && asBox(f.prompt) };
      assert.ok(f.tach, `${label}: the tachometer has a place`);
      for (const [n1, b1] of Object.entries(parts)) for (const [n2, b2] of Object.entries(parts)) if (n1 < n2 && b1 && b2) assert.ok(!hit(b1, b2), `${label}: the ${n1} overlaps the ${n2}`);
      cars.forEach((c, i) => { for (const [n, b1] of Object.entries(parts)) if ((n === 'tach' || n === 'prompt') && b1) assert.ok(!hit(b1, c), `${label}: the ${n} overlaps car ${i}`); });
    }
  }
});

test('on a narrow tall window the panel stays above the car where it can, and the car is where it was drawn before (68 percent down)', () => {
  const race = raceOf(true), me = race.state.runners[0];
  for (const [W, H] of [[420, 860], [360, 640]]) { const box = runPanelBox(W, H, scaleOf(H), me); assert.ok(box.x < 20 && box.w <= W / 2, `${W}x${H}: on the left`); if (H >= 800) assert.ok(box.y + box.h <= carNoseY(H) + 1, `${W}x${H}: above the nose (${box.y + box.h} vs ${carNoseY(H)})`); }
  assert.equal(Math.round(carNoseY(1000)), 584);
});

test('the keys to press and the warnings live in the panel: wrapped, bounded, and only the warnings that apply', () => {
  const race = raceOf(true), me = race.state.runners[0]; me.launched = true; me.lift = 1; me.spin = true; me.clutchTemp = 400;
  const f = frame(race, 1280, 720), words = f.items.map(i => i.s);
  for (const w of ['WHEELSPIN', 'FRONT UP']) assert.ok(words.includes(w), `${w} is shown`); assert.ok(words.some(t => /CLUTCH (HOT|BURNING)/.test(t)), 'a hot clutch is a warning, not a gauge');
  me.lift = 0; me.spin = false; me.clutchTemp = 20; const calm = frame(race, 1280, 720).items.map(i => i.s); assert.ok(!calm.includes('FRONT UP') && !calm.includes('WHEELSPIN') && !calm.some(t => /CLUTCH/.test(t)), 'nothing warns when nothing is wrong');
  assert.deepEqual(wrapNote('ABCD EFGH IJKL', 9), ['ABCD EFGH', 'IJKL']);
});

test('with the touch buttons on screen, no panel text or gauge touches a button, at the four sizes and a touch landscape phone, whatever the phase', () => {
  for (const [W, H] of TOUCH_SIZES) {
    const rects = touchLayout(W, H, 1), phases = ['waterBoxApproach', 'burnout', 'backup', 'preStage', 'staged', 'launched'];
    for (const stage of phases) for (const loaded of [true, false]) {
      const race = raceOf(true), me = race.state.runners[0]; me.stage = stage; me.launched = stage === 'launched'; me.reaction = 0.05; me.launchT = 0; me.spin = me.launched; me.lift = me.launched ? 1 : 0; me.clutchTemp = loaded ? 400 : 20;
      const f = frame(race, W, H, true), label = `${W}x${H} ${stage}`, panel = { x0: f.box.x, x1: f.box.x + f.box.w, y0: f.box.y, y1: f.box.y + f.box.h };
      assert.ok(!f.box.layout.lane, `${label}: the lane gauge is hidden under touch`);
      for (const r of rects) { const rb = { x0: r.x, x1: r.x + r.w, y0: r.y, y1: r.y + r.h }; assert.ok(!hit(panel, rb), `${label}: the panel box overlaps the ${r.id} button`); }
      for (const i of f.items.slice(f.strip)) { const b = boxOf(i); for (const r of rects) assert.ok(!hit(b, { x0: r.x, x1: r.x + r.w, y0: r.y, y1: r.y + r.h }), `${label}: "${i.s}" is under the ${r.id} button`); }
      const start = f.rects.findIndex(g => g.x === f.box.x && g.y === f.box.y && g.w === f.box.w); assert.ok(start >= 0, `${label}: the panel backing is drawn`);
      for (const g of f.rects.slice(start)) for (const r of rects) assert.ok(!hit({ x0: g.x, x1: g.x + g.w, y0: g.y, y1: g.y + g.h }, { x0: r.x, x1: r.x + r.w, y0: r.y, y1: r.y + r.h }), `${label}: a gauge or the backing is under the ${r.id} button`);
      assert.ok(f.tach, `${label}: the tachometer has a place`); const tb = asBox(f.tach.box);
      for (const r of rects) assert.ok(!hit(tb, { x0: r.x, x1: r.x + r.w, y0: r.y, y1: r.y + r.h }), `${label}: the tachometer overlaps the ${r.id} button`);
      if (f.prompt) for (const r of rects) assert.ok(!hit(asBox(f.prompt), { x0: r.x, x1: r.x + r.w, y0: r.y, y1: r.y + r.h }), `${label}: the instruction line overlaps the ${r.id} button`);
      assert.ok(f.items.slice(f.strip).some(i => /KM\/H/.test(i.s)) && f.items.slice(f.strip).some(i => /RPM/.test(i.s)), `${label}: speed and rpm are still shown`);
    }
  }
});

test('every label is at least the minimum font size on phone-sized windows and with touch on', () => {
  for (const [W, H] of TOUCH_SIZES) for (const touch of [false, true]) {
    const race = raceOf(), me = race.state.runners[0];
    for (let k = 0; k < 240 * 60 && race.state.phase !== 'over'; k++) {
      race.step(); if (k % 120) continue; me.spin = k % 240 === 0; me.lift = k % 360 === 0 ? 1 : 0;
      const f = frame(race, W, H, touch); for (const i of f.items) assert.ok(i.size >= MIN_FONT - 1e-9, `${W}x${H} touch=${touch}: "${i.s}" is ${i.size.toFixed(1)}px`);
      for (const i of f.panelItems) { const b = boxOf(i); if (b.x0 < f.box.x + f.box.w) assert.ok(b.x1 <= f.box.x + f.box.w + 1, `${W}x${H} touch=${touch}: "${i.s}" runs out of the panel`); }
    }
  }
});

test('the rows that go first on a small window are the least useful ones, and the full panel is kept when it fits', () => {
  const me = raceOf(true).state.runners[0];
  assert.ok(runPanelBox(1280, 720, 1, me).layout.lane && runPanelBox(1280, 720, 1, me).layout.tires, 'a big window keeps everything');
  const tight = runPanelBox(844, 390, 0.7, me, touchLayout(844, 390, 1)); assert.ok(!tight.layout.lane && tight.layout.notes <= 5, 'touch landscape hides the lane gauge first');
  assert.deepEqual([...PHONE_HUD.dropOrder], ['lane', 'notes2', 'tires', 'boost', 'nitro', 'notes1']);
});

/** a runner put in a staging pose */
function posed(stage, x, over = {}) {
  const race = raceOf(), me = race.state.runners[0]; me.stage = stage; me.x = x; me.v = 0; me.launched = false; me.rolling = false; me.overstaged = false; me.deepStage = stage === 'deepStaged'; me.foul = false; me.aborted = false; me.crashed = false;
  for (const w of me.tires) w.temp = 25; Object.assign(me, over); return { race, me, s: race.state };
}
const say = (stage, x, over, k = keys) => { const { me, s } = posed(stage, x, over); const p = guidePrompt(me, s, k); return p ? p.variants : null; };
const first = (stage, x, over, k) => say(stage, x, over, k)?.[0] ?? null;
const hasOne = (stage, x, over, k) => { const v = say(stage, x, over, k); return v && v.length > 0 && v.every(t => !/\n/.test(t)); };

test('the one instruction line says the right thing in every staging phase, with the player\'s own keys', () => {
  const T = STAGE.waterBoxStart;
  assert.equal(first('waterBoxApproach', T - 4), 'HOLD W: ROLL INTO THE WATER BOX');
  assert.equal(first('waterBoxApproach', T + 2), 'HOLD W + S: BURNOUT', 'in the water box the burnout is the next thing');
  assert.equal(first('burnout', STAGE.waterBoxEnd + 2, { v: 3.5 }), 'HOLD W + S: BURNOUT', 'cold tires: keep burning');
  assert.equal(first('burnout', STAGE.waterBoxEnd + 2, { v: 3.5, tires: posed('burnout', 0).me.tires.map(w => ({ ...w, temp: DRAG.tire.windowLo + 5 })) }), 'RELEASE S: TIRES HOT', 'warm tires: let go');
  assert.equal(first('runOut', 0, { v: 3 }), 'LET OFF: STOP PAST THE TREE', 'rolling out before the tree');
  assert.equal(first('runOut', STAGE.runOutPastTree + 5, { v: 3 }), 'S: STOP', 'past the tree: brake');
  assert.equal(first('runOut', 10, { v: 0 }), 'BACK UP (R) 11 M', 'stopped past the tree: back up, with the distance to the pre-stage beam');
  assert.equal(first('runOut', -3, { v: 0 }), 'TAP W: CREEP TO PRE-STAGE', 'stopped short of the beams: creep up');
  assert.equal(first('backup', 5, { v: -1.5 }), 'BACK UP (R) 6 M');
  assert.equal(first('backup', 0.1, { v: -1.5 }), 'BACK UP (R)', 'under a metre to go: no distance');
  assert.equal(first('backup', -0.6, { v: -1.5 }), 'RELEASE R, BRAKE: STOP', 'nearly in the lights: stop it');
  assert.equal(first('backup', -2, { v: 0 }), 'TAP W: CREEP TO PRE-STAGE', 'backed too far');
  assert.equal(first('preStage', -0.6), 'TAP W: CREEP TO STAGE');
  assert.equal(first('preStage', -0.01, { overstaged: true }), 'BACK UP (R) TO RE-STAGE', 'over-staged: back out past the stage beam');
  assert.equal(first('staged', -0.4), 'WAIT FOR GREEN, THEN X (H: DEEP)', 'deep staging is a real choice from the stage beam');
  assert.equal(first('deepStaged', -0.1), 'WAIT FOR GREEN, THEN X', 'already deep: no deep option');
  assert.ok(!say('staged', -0.4, {}, { ...keys, deepStage: undefined }).some(t => /DEEP/.test(t)), 'no deep key bound: no deep option');
  // nothing after the launch, at a foul, an abort, the roll-out, a crash, or at the green
  for (const over of [{ launched: true, stage: 'launched' }, { rolling: true, stage: 'rolling' }, { foul: true }, { aborted: true }, { crashed: true }]) assert.equal(say('staged', -0.4, over), null, JSON.stringify(over));
  const { me, s } = posed('staged', -0.4); s.green = true; assert.equal(guidePrompt(me, s, keys), null, 'at the green nothing extra');
  for (const [stage, x] of [['waterBoxApproach', -30], ['burnout', -15], ['runOut', 3], ['backup', 4], ['preStage', -0.6], ['staged', -0.4], ['deepStaged', -0.1]]) assert.ok(hasOne(stage, x), `${stage}: one single line`);
});

test('the line uses the keys the player bound, and the touch buttons\' names on a phone', () => {
  const mine = { ...keys, gas: 'UP', brake: 'DOWN', backUp: 'B', launch: 'SPACE', deepStage: 'D' };
  assert.equal(first('waterBoxApproach', -20, {}, mine), 'HOLD UP + DOWN: BURNOUT'); assert.equal(first('waterBoxApproach', -30, {}, mine), 'HOLD UP: ROLL INTO THE WATER BOX');
  assert.equal(first('runOut', 10, { v: 0 }, mine), 'BACK UP (B) 11 M'); assert.equal(first('staged', -0.4, {}, mine), 'WAIT FOR GREEN, THEN SPACE (D: DEEP)');
  assert.equal(first('preStage', -0.6, {}, mine), 'TAP UP: CREEP TO STAGE');
  assert.equal(first('waterBoxApproach', -20, {}, touchKeys), 'HOLD GAS + BURN: BURNOUT'); assert.equal(first('runOut', 10, { v: 0 }, touchKeys), 'BACK UP (BACK UP) 11 M');
  assert.equal(first('staged', -0.4, {}, touchKeys), 'WAIT FOR GREEN, THEN GO (DEEP: DEEP)');
});

test('the autopilot shows one quiet word and no keys, in every phase', () => {
  for (const [stage, x] of [['waterBoxApproach', -30], ['burnout', -15], ['runOut', 3], ['backup', 4], ['preStage', -0.6], ['staged', -0.4]]) {
    const v = say(stage, x, {}, { ...keys, auto: true }); assert.deepEqual(v, ['AUTOPILOT'], stage);
    const { race } = posed(stage, x); const f = frame(race, 800, 450, false, { auto: true }); assert.equal(f.promptItems.length, 1, 'one line'); assert.equal(f.promptItems[0].s, 'AUTOPILOT');
    assert.ok(!f.hud.some(i => /HOLD|BACK UP \(|CREEP|TAP |WAIT FOR/.test(i.s)), 'no key prompt');
  }
});

test('only one instruction line is ever on screen, at every size through a whole run, it ends at the launch, and nothing else in the panel gives instructions', () => {
  const INSTRUCTION = /HOLD |RELEASE|BACK UP \(|CREEP|TAP |WAIT FOR|ROLL INTO|STOP PAST|LET OFF|AUTOPILOT|: STOP|ON GREEN/;
  for (const [W, H, touch] of [...SIZES.map(z => [...z, false]), [844, 390, true], [360, 640, true]]) {
    const race = raceOf(); let lines = 0, after = 0;
    for (let k = 0; k < 240 * 90 && race.state.phase !== 'over'; k++) {
      race.step(); if (k % 30) continue; const f = frame(race, W, H, touch), me = race.state.runners[0];
      const lineItems = f.hud.filter(i => INSTRUCTION.test(i.s) && !/^STOP IN /.test(i.s) && !/(BRAKE|CHUTE): (BRAKE|CHUTE)/.test(i.s)); lines += lineItems.length;
      assert.ok(f.promptItems.length <= 1 && lineItems.length <= 1, `${W}x${H}: ${lineItems.map(i => i.s).join(' | ')}`);
      assert.ok(f.panelItems.every(i => !INSTRUCTION.test(i.s)), `${W}x${H}: the panel gives instructions: ${f.panelItems.map(i => i.s).join(' | ')}`);
      if (me.launched) after += lineItems.length;
    }
    assert.ok(lines > 3, `${W}x${H}: the line was shown (${lines})`); assert.equal(after, 0, `${W}x${H}: nothing after the launch`);
  }
});

test('the tachometer is at the bottom right at full size, and the panel no longer repeats rpm, gear, speed or the shift lamps', () => {
  for (const [W, H] of SIZES) {
    const race = raceOf(true), me = race.state.runners[0]; me.rpm = 6500; me.v = 30; me.gear = 3;
    const f = frame(race, W, H), S = scaleOf(H), t = f.tach, c = t.box;
    assert.ok(c.x + c.w <= W && c.y + c.h <= H, `${W}x${H}: on the screen`);
    assert.ok(t.cx > W / 2 && t.cy > H / 2, `${W}x${H}: at the bottom right (${t.cx.toFixed(0)}, ${t.cy.toFixed(0)})`);
    assert.ok(c.x + c.w >= W - 40 * S - 1 && c.y + c.h >= H - 40 * S - 1 || W < H, `${W}x${H}: in the corner`);
    if (W >= 800 && H <= 720 && W > H) assert.equal(t.scale, 1, `${W}x${H}: full size (radius ${t.R.toFixed(0)} px, 92 x S)`);
    assert.ok(Math.abs(t.R - 92 * S * t.scale) < 1e-6);
    const words = f.tachItems.map(i => i.s); assert.ok(words.some(w => /^6500 RPM$/.test(w)) && words.some(w => /^108 KM\/H$/.test(w)) && words.includes('3'), `${W}x${H}: rpm, speed and gear are in the gauge: ${words.join(' | ')}`);
    assert.equal(f.hud.filter(i => /RPM/.test(i.s)).length, 1); assert.equal(f.hud.filter(i => /KM\/H/.test(i.s)).length, 1);
    assert.ok(f.panelItems.every(i => !/RPM|KM\/H/.test(i.s) && !/^\d$/.test(i.s)), `${W}x${H}: the panel has no rpm, speed or gear`);
    // the shift lamps are in the gauge: five lamps are drawn above the dial, none in the panel (the panel's top is stage, timing and notes)
    assert.ok(runPanelBox(W, H, S, me).h > 0);
  }
  assert.equal(PHONE_HUD.minFont, 10);
});

test('the tachometer, the instruction line, the panel, the tree and the cars never overlap, in every staging phase and mid-run, at five sizes, with and without touch buttons', () => {
  const poses = [['waterBoxApproach', -30, 0], ['burnout', -15, 3.5], ['runOut', 12, 0], ['backup', 4, -1.5], ['preStage', -0.6, 0], ['staged', -0.4, 0], ['deepStaged', -0.1, 0], ['launched', 150, 70]];
  for (const [W, H] of TOUCH_SIZES) for (const touch of [false, true]) for (const [stage, x, v] of poses) {
    const { race, me } = posed(stage, x, { v, launched: stage === 'launched', rpm: 7000, gear: 2, reaction: 0.1, launchT: 0 }), f = frame(race, W, H, touch), S = scaleOf(H), label = `${W}x${H} touch=${touch} ${stage}`;
    assert.ok(f.tach, `${label}: the tachometer has a place`);
    const sc = H / (28 + Math.abs(v) * 0.55), cars = [-2.4, 2.4].map(l => ({ x0: W / 2 + l * sc - 1.1 * sc, x1: W / 2 + l * sc + 1.1 * sc, y0: H * 0.68 - 2.7 * sc, y1: H * 0.68 + 2.5 * sc }));
    const parts = { panel: asBox({ x: f.box.x, y: f.box.y, w: f.box.w, h: f.box.h }), tree: treeBox(W, S, 2), tach: asBox(f.tach.box), ...(f.prompt ? { prompt: asBox(f.prompt) } : {}) };
    for (const [n1, b1] of Object.entries(parts)) for (const [n2, b2] of Object.entries(parts)) if (n1 < n2) assert.ok(!hit(b1, b2), `${label}: the ${n1} overlaps the ${n2}`);
    cars.forEach((c, i) => { for (const [n, b1] of Object.entries(parts)) assert.ok(!hit(b1, c), `${label}: the ${n} overlaps car ${i}`); });
    for (const r of f.avoid) for (const [n, b1] of Object.entries(parts)) assert.ok(!hit(b1, { x0: r.x, x1: r.x + r.w, y0: r.y, y1: r.y + r.h }), `${label}: the ${n} overlaps the ${r.id} button`);
    // every text of the gauge and the line is inside its own box and at least the minimum size
    for (const i of [...f.tachItems, ...f.promptItems]) assert.ok(i.size >= MIN_FONT - 1e-9, `${label}: "${i.s}" is ${i.size}px`);
    for (const [n, b1] of [['tach', parts.tach], ['prompt', parts.prompt]]) if (b1) assert.ok(b1.x0 >= 0 && b1.y0 >= 0 && b1.x1 <= W && b1.y1 <= H, `${label}: the ${n} is on the screen`);
    // the gauge's own texts do not run into each other
    const gt = f.tachItems.map(boxOf); for (let p = 0; p < gt.length; p++) for (let q = p + 1; q < gt.length; q++) assert.ok(!hit(gt[p], gt[q]), `${label}: "${f.tachItems[p].s}" overlaps "${f.tachItems[q].s}"`);
  }
});
