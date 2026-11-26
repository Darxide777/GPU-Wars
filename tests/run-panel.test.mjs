// The race screen's HUD: every readout shown DURING a run is in ONE panel on the left, the text is short (no conditions, fuel, pressures, splits, ghost words), no value is written twice,
// and nothing written while staging (the stage line, the keys to press, the beam and mark names beside the strip) overlaps anything else at 800x450, 1280x720, 420x860 and 360x640.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrag, AUTO_DRIVER, STAGE, DRAG, stageLabel } from '../src/drag/physics.ts';
import { createDragTopDown, carNoseY } from '../src/drag/topdown.ts';
import { drawProgress, drawRunPanel, runPanelBox, stagingPrompt, wrapNote } from '../src/drag/hud.ts';
import { DRAG_CARS } from '../src/drag/data.ts';
import { defaultTune, specFor } from '../src/drag/tune.ts';

const SIZES = [[800, 450], [1280, 720], [420, 860], [360, 640]];
const scaleOf = H => Math.max(0.7, Math.min(1.6, H / 720));
const keys = { launch: 'X', nitro: 'N', manual: true, gas: 'W', burnout: 'J', brake: 'S', chute: 'C', deepStage: 'H', backUp: 'R' };
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
function frame(race, W, H, k = 0) { const r = recorder(), td = createDragTopDown(); td.draw(r.ctx, W, H, race.state, 0, 0.016, race.state.t); const strip = r.items.length; drawProgress(r.ctx, W, H, race.state, 0, scaleOf(H), keys); return { ...r, strip, box: runPanelBox(W, H, scaleOf(H), race.state.runners[0]) }; }
/** the tree's backing box (see drawTree) */
const treeBox = (W, S, lanes) => ({ x0: W / 2 - (lanes * 13 + 6) * S, x1: W / 2 + (lanes * 13 + 6) * S, y0: 60 * S, y1: 60 * S + 15 * S * 7 + 12 * S });
const MOVED = /AIR|TRACK|DENSITY|DA |ALT|RHO|WIND|FRONT AIR|PSI|FUEL|ENGINE|REAR WEIGHT|BRAKE \d|CHUTE \d|RANKED|FREE PLAY|CLASS|LEADER|GHOST|BEST PASS|\bVS\b|TRAP|1\/4 MILE|60 FT \d|1\/8 \d|NOSE|WEAR|CLUTCH \d|DELTA/;

test('every run readout is drawn inside the left panel, and nothing that belongs on the timeslip is written, at four window sizes through a whole staged run', () => {
  for (const [W, H] of SIZES) {
    const race = raceOf(), seenStages = new Set(); let frames = 0;
    for (let k = 0; k < 240 * 90 && race.state.phase !== 'over'; k++) {
      race.step(); if (k % 60) continue; frames++; seenStages.add(race.state.runners[0].stage);
      const f = frame(race, W, H), panel = f.items.slice(f.strip), inside = panel.filter(i => boxOf(i).x0 >= f.box.x - 1 && boxOf(i).x1 <= f.box.x + f.box.w + 1 && i.y <= f.box.y + f.box.h);
      const centre = panel.filter(i => !inside.includes(i));
      assert.ok(centre.every(i => i.s === 'You crashed'), `${W}x${H}: only the crash alert is outside the panel: ${centre.map(i => i.s).join(' | ')}`);
      assert.ok(inside.length >= 6, `${W}x${H}: the panel has its readouts`);
      for (const i of panel) assert.ok(!MOVED.test(i.s), `${W}x${H}: "${i.s}" belongs on the timeslip`);
      assert.ok(f.box.x + f.box.w < W / 2 - 20 * scaleOf(H), `${W}x${H}: the panel stops short of the tree`);
      assert.ok(f.box.y + f.box.h <= H, `${W}x${H}: and ends on the screen`);
      const texts = panel.map(i => i.s); assert.equal(new Set(texts).size, texts.length, `${W}x${H}: no line twice: ${texts.join(' | ')}`);
      assert.ok(panel.length <= 22, `${W}x${H}: the in-run text is short (${panel.length} lines)`);
    }
    assert.ok(frames > 20 && ['burnout', 'backup', 'preStage'].every(s => seenStages.has(s)), `${W}x${H}: the run passed through ${[...seenStages].join(', ')}`);
  }
});

test('a value is written once: air temperature and the rest of the conditions are not on the race screen, speed and rpm once each, the stage name once', () => {
  const race = raceOf(true), me = race.state.runners[0]; me.launched = true; me.v = 40; me.rpm = 7000; me.gear = 2; me.launchT = 0; me.reaction = 0.05;
  for (const [W, H] of SIZES) {
    const f = frame(race, W, H), all = f.items.map(i => i.s);
    assert.equal(all.filter(t => /KM\/H/.test(t)).length, 1, `${W}x${H}: speed once`); assert.equal(all.filter(t => /RPM/.test(t)).length, 1, 'rpm once');
    assert.equal(all.filter(t => /R\/T/.test(t)).length, 1, 'reaction once'); assert.equal(all.filter(t => /^TIME/.test(t)).length, 1, 'the run timer once');
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
      for (let p = 0; p < texts.length; p++) for (let q = p + 1; q < texts.length; q++) assert.ok(!hit(texts[p].b, texts[q].b), `${label}: "${texts[p].i.s}" overlaps "${texts[q].i.s}"`);
      const scale = H / (28 + Math.abs(a.v) * 0.55), wall = W / 2 + 4.8 * scale;
      for (const t of texts) {
        const inPanel = t.b.x0 >= panel.x0 - 1 && t.b.x1 <= panel.x1 + 1;
        if (!inPanel) { assert.ok(t.b.x0 >= wall - 1, `${label}: "${t.i.s}" (x ${t.b.x0.toFixed(0)}) is beside the strip, past its wall at ${wall.toFixed(0)}`); assert.ok(!hit(t.b, tree), `${label}: "${t.i.s}" overlaps the tree`); assert.ok(t.b.x1 <= W + 1, `${label}: "${t.i.s}" runs off the screen`); }
        else assert.ok(!hit(t.b, tree), `${label}: panel text "${t.i.s}" overlaps the tree`);
        assert.ok(t.i.size >= 6.5, `${label}: "${t.i.s}" is only ${t.i.size.toFixed(1)}px`);
      }
      assert.ok(panel.x1 < tree.x0, `${label}: the panel is left of the tree`);
      // the keys to press are wrapped inside the panel and never cut off
      const p = stagingPrompt(a, race.state, keys), need = [p.title, ...p.lines.map(l => l[0])].filter(Boolean).flatMap(s => wrapNote(s, 22)).length;
      assert.ok(need <= 5, `${label}: the prompt needs ${need} rows`);
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
