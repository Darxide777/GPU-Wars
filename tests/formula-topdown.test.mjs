// Formula's top-down picture and lap HUD: it draws every stage of a lap at phone and desktop sizes without trouble, keeps its text readable and inside the window, shows the racing line and the ghost only when asked, and is the same picture for the same lap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormulaRace, createFormulaAutopilot, draw, racingLineFor, ghostFromLeader, FORMULA_TRACKS, LINE_COLOURS } from '../src/formula/index.ts';
import { panelRows, clockText, gapText, HUD } from '../src/formula/hud.ts';
import { cameraOf } from '../src/formula/topdown.ts';

/** a canvas context that records what it is asked to draw (every text with its size and place, every colour used) and accepts everything else */
function recorder() {
  const texts = [], colours = new Set(), calls = []; let font = '10px monospace', bad = 0;
  const num = v => { if (typeof v === 'number' && !Number.isFinite(v)) bad++; };
  const ctx = new Proxy({}, {
    get: (t, k) => {
      if (k === 'measureText') return s => ({ width: String(s).length * 7 });
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'fillText' || k === 'strokeText') return (s, x, y) => { num(x); num(y); texts.push({ s: String(s), x, y, size: Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 0) }); calls.push(`text:${s}`); };
      if (k === 'font') return font; if (k in t) return t[k];
      return (...args) => { args.forEach(num); calls.push(String(k)); };
    },
    set: (t, k, v) => { if (k === 'font') font = v; if (k === 'strokeStyle' || k === 'fillStyle') colours.add(String(v)); t[k] = v; return true; },
  });
  return { ctx, texts, colours, calls, get bad() { return bad; } };
}
const SIZES = [[1280, 720], [800, 450], [420, 860], [360, 640], [844, 390]];
const drive = (steps, race = createFormulaRace()) => { const ap = createFormulaAutopilot(race.track, race.state.car.stats); for (let i = 0; i < steps && !race.over; i++) race.step(ap.decide(race.view())); return race; };

test('it draws the lights, the lap and the finish at every window size with sane numbers and readable text inside the window', () => {
  for (const [W, H] of SIZES) {
    const race = createFormulaRace(), ap = createFormulaAutopilot(race.track, race.state.car.stats), seen = new Set();
    for (let i = 0; i < 60 * 60 && !race.over; i++) {
      race.step(ap.decide(race.view()));
      if (i % 20 === 0 || race.over) {
        const r = recorder(), v = race.view(); draw(r.ctx, W, H, v, { time: i / 60 }); seen.add(v.phase + (v.lights ? 'L' + v.lights : ''));
        assert.ok(r.calls.length > 60, `${r.calls.length} calls`); assert.equal(r.bad, 0, 'no NaN or infinite coordinates');
        for (const t of r.texts) { assert.ok(t.size >= HUD.minFont, `"${t.s}" is ${t.size}px at ${W}x${H}`); assert.ok(t.x >= -1 && t.x <= W + 1 && t.y >= 0 && t.y <= H + 4, `"${t.s}" at ${t.x},${t.y} outside ${W}x${H}`); }
      }
    }
    assert.ok(seen.has('lightsL1') && seen.has('lightsL3') && seen.has('racing'), [...seen].join(' '));
  }
  const done = drive(60 * 60); assert.ok(done.over); const r = recorder(); draw(r.ctx, 1280, 720, done.view()); assert.ok(r.texts.some(t => t.s === 'FINISH'), 'the finish is announced');
});

test('the HUD is minimal: the state, the lap clock, the sector, the last split, the gear and the speed, and no ghost words unless asked', () => {
  const race = drive(60 * 12), v = race.view(), r = recorder(); draw(r.ctx, 1280, 720, v);
  const words = r.texts.map(t => t.s); assert.ok(words.includes(clockText(v.lapClock)) && words.some(w => /^SECTOR \d\/7$/.test(w)) && words.some(w => w.startsWith('SPLIT')) && words.includes(String(v.car.gear)) && words.includes(String(v.car.kmh)), words.join(' | '));
  assert.ok(r.texts.length <= 10, `${r.texts.length} pieces of text`); assert.ok(!words.some(w => /GHOST|DELTA|BEST|TOP|REACTION/.test(w)));
  const ghost = ghostFromLeader(FORMULA_TRACKS[0], { name: 'leader', lapTime: 38 }), withGhost = drive(60 * 12, createFormulaRace({ ghost })), rows = panelRows(withGhost.view(), {}), rowsDelta = panelRows(withGhost.view(), { showDelta: true });
  assert.ok(!rows.some(([s]) => s.startsWith('GHOST'))); assert.ok(rowsDelta.some(([s]) => s.startsWith('GHOST')));
  assert.equal(clockText(83.4567), '1:23.457'); assert.equal(clockText(5.5), '5.500'); assert.equal(gapText(0.42), '+0.42'); assert.equal(gapText(-1.2), '-1.20');
  assert.ok(panelRows(createFormulaRace().view())[0][0] === 'LIGHTS'); const jump = createFormulaRace(); jump.step({ throttle: 1 }); assert.equal(panelRows(jump.view())[0][0], 'JUMP START');
});

test('the racing line is drawn only when asked for, in its three colours, and the ghost car appears with a ghost', () => {
  const race = drive(60 * 8), line = racingLineFor(), v = race.view();
  const plain = recorder(); draw(plain.ctx, 1280, 720, v, { showLine: false, line }); const off = recorder(); draw(off.ctx, 1280, 720, v, { showLine: true, line: null }); const on = recorder(); draw(on.ctx, 1280, 720, v, { showLine: true, line });
  assert.ok(on.calls.length > plain.calls.length, 'the line adds drawing'); assert.equal(off.calls.length, plain.calls.length, 'a line that was not worked out draws nothing');
  assert.ok(LINE_COLOURS.slice(0, 2).every(c => on.colours.has(c)), 'green and yellow are drawn with the line');
  const ghost = ghostFromLeader(FORMULA_TRACKS[0], { name: 'leader', lapTime: 38 }), g = drive(60 * 8, createFormulaRace({ ghost })), withGhost = recorder(); draw(withGhost.ctx, 1280, 720, g.view()); const noGhost = recorder(); draw(noGhost.ctx, 1280, 720, drive(60 * 8).view());
  assert.ok(withGhost.calls.length > noGhost.calls.length, 'the ghost car is drawn'); assert.ok(!withGhost.texts.some(t => /leader|LEADER/.test(t.s)), 'the ghost car carries no text');
});

test('the camera follows the car, pulls back with speed, and the same lap draws the same picture', () => {
  const a = createFormulaRace().view(), b = drive(60 * 10).view(), ca = cameraOf(a, 1280, 720), cb = cameraOf(b, 1280, 720);
  assert.ok(cb.scale < ca.scale, 'faster means further out'); assert.ok(cameraOf(b, 420, 860).scale < cameraOf(b, 1280, 860).scale && cameraOf(b, 420, 860).scale > 860 / 200, 'a narrow window is zoomed to its width'); assert.ok(Math.hypot(cb.cx - b.car.x, cb.cy - b.car.y) <= b.car.speed * 0.31, 'centred on the car, looking a little ahead');
  const pic = () => { const r = recorder(); draw(r.ctx, 800, 450, drive(60 * 10).view(), { time: 3 }); return r.calls.join(',') + r.texts.map(t => t.s + t.x + t.y).join(','); };
  assert.equal(pic(), pic());
  assert.ok(!/Math\.random/.test(String(draw)), 'no random numbers in the drawing');
});
