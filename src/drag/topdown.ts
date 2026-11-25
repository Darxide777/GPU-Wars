// The drag strip from above (the Options page's CAMERA VIEW "top down"): the strip scrolls down the screen with your car, both lanes between their pink walls, the start line, a line across the strip at every mark
// of the timeslip (60 ft, 330 ft, an eighth, 1000 ft) and the chequered finish, and the two cars from above (a long thin body, big slicks at the back, narrow fronts, the rear wing), turned the way they are heading and
// across their lanes where they are. A spinning rear tire smokes and leaves a mark on the strip, the nitro burns out of the stacks, a car over the centre line is flagged. The camera is behind the middle of your car
// and pulls back as you go faster. It only reads the race and draws; the HUD (the tachometer, the progress) is drawn over it by hud.ts, as in the 3D view.
import { C } from '../sim/constants.ts';
import { DRAG, RUBBER, SHUTDOWN, STAGE, boostLimitOf, chuteOpening, conditionsText, fuelShare, rubberAt, stageLabel, weatherText, windAt } from './physics.ts';
import { BOOST, CLUTCH } from './tune.ts';
import type { DragHudState } from './hud.ts';
import type { Mark, Runner } from './types.ts';

/** each lane's middle is this far either side of the centre line (the 3D strip's number) */
export const LANE_M = 2.4;
const MARK_NAMES: Record<Mark, string> = { ft60: '60 FT', ft330: '330 FT', eighth: '1/8 MILE', ft1000: '1000 FT', trapStart: '66 FT TRAP', quarter: 'FINISH' };
const LIFT = { frontFade: 0.75, labelLine: 5.8 } as const;
const CLUTCH_LABEL = { line: 3.4, barY: 3.9, barH: 0.28, halfW: 1.1 } as const;
const BOOST_LABEL = { line: 5.7, barY: 6.0, barH: 0.28, halfW: 1.1 } as const;
const TIRE_LABEL = { line: 7.4 } as const;
const FUEL_LABEL = { line: 8.7, low: 0.25 } as const;
/** the readouts are drawn in units of `unit` pixels per metre, kept between these so the writing is 10 to 15 px whatever the window (a tall phone screen has a big scale: the writing must not grow with it). `extent` is the block's height in units. */
const READOUT_UNIT = { min: 10.5, max: 15.8, extent: 9.1, tailClear: 2.6, firstLineTop: 2.4 } as const;
/** the labels written to the right of the strip (water box, beams, marks): their size, the gap from the wall, and the lowest px between two labels */
const SIDE_LABEL = { minSize: 8, maxSize: 14, gap: 8, spacing: 1.15 } as const;
/** the conditions bar at the bottom: the lines it may wrap to, and the room kept between it and the readouts above */
const CONDITIONS_BAR = { size: 13, minSize: 10, lineHeight: 15, pad: 7, margin: 16, readoutGap: 8, maxLines: 2 } as const;
/** the readouts' widest line (characters) and the gap from the car's middle to their near edge (m), used to decide whether they fit beside the car */
const READOUT = { chars: 26, charWidth: 0.6, gap: 1.9, besideLift: 5.2 } as const;
const SMOKE_TOP = { windDrift: 0.8 } as const;
const CHUTE_TOP = { minWidth: 0.5, maxWidth: 1.8, minHeight: 0.3, maxHeight: 0.8, back: 3.6, lift: 1.0, minAlpha: 0.25, alphaSpan: 0.6 } as const;
const TIRE_SPIN = { stripes: 3, gap: 0.75, skew: 0.18, hz: 14, line: 0.09 } as const;
/** a repeatable number from 0 to 1 for the nth puff of smoke (a hash, so the same race draws the same smoke: the drawing never asks for a random number) */
export const puffNoise = (n: number, salt: number): number => { let h = (Math.imul(n + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0; h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0; h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0; return ((h ^ (h >>> 15)) >>> 0) / 4294967296; };
interface Puff { x: number; y: number; vx: number; vy: number; t: number; max: number }
interface Skid { x0: number; y0: number; x1: number; y1: number }

/** one name written beside the strip: where its beam is, where the text goes, and whether to draw a short line from the beam to the text */
interface SideName { text: string; beam: number; at: number; col: string; line: boolean }
/** the names right of the strip: sized to the window (never huge on a phone), pushed apart so none overlaps another, and kept inside the canvas */
function drawSideNames(ctx: CanvasRenderingContext2D, names: SideName[], wallX: number, scale: number, W: number): void {
  const size = Math.max(SIDE_LABEL.minSize, Math.min(SIDE_LABEL.maxSize, 1.1 * scale)), x = wallX + SIDE_LABEL.gap, room = Math.max(1, W - x - 2);
  const sorted = [...names].sort((a, b) => a.at - b.at); let floor = -Infinity;
  for (const n of sorted) { n.at = Math.max(n.at, floor + size * SIDE_LABEL.spacing); floor = n.at; }
  ctx.textAlign = 'left';
  for (const n of sorted) {
    // a long name on a narrow window is made smaller rather than cut off
    const fit = Math.min(size, room / (n.text.length * 0.6)); ctx.font = `bold ${Math.max(6, fit)}px monospace`;
    if (n.line && n.at - 4 !== n.beam) { ctx.strokeStyle = n.col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(wallX, n.beam); ctx.lineTo(x - 1, n.at - fit * 0.35); ctx.stroke(); }
    ctx.fillStyle = n.col; ctx.fillText(n.text, x, n.at);
  }
}
/** the conditions text for the bottom bar, in one or two lines that fit the width, and the bar's height */
interface ConditionsBar { lines: string[]; size: number; height: number }
function conditionsBar(ctx: CanvasRenderingContext2D, W: number, weather: Parameters<typeof conditionsText>[0], conditions: Parameters<typeof weatherText>[0]): ConditionsBar {
  const text = conditionsText(weather) + weatherText(conditions), C_ = CONDITIONS_BAR, room = W - 2 * C_.margin - 2 * C_.pad;
  const width = (t: string, size: number): number => { ctx.font = `bold ${size}px monospace`; return ctx.measureText(t).width; };
  let size: number = C_.size; while (size > C_.minSize && width(text, size) > room) size--;
  let lines = [text];
  if (width(text, size) > room && C_.maxLines > 1) {
    // two lines, broken at the space nearest the middle, and the size shrunk to fit the longer one
    const mid = text.length / 2; let cut = -1; for (let k = 0; k < text.length; k++) if (text[k] === ' ' && (cut < 0 || Math.abs(k - mid) < Math.abs(cut - mid))) cut = k;
    if (cut > 0) lines = [text.slice(0, cut).trim(), text.slice(cut).trim()];
    size = C_.size; while (size > C_.minSize && Math.max(...lines.map(l => width(l, size))) > room) size--;
  }
  return { lines, size, height: lines.length * C_.lineHeight + C_.pad * 2 - 2 };
}
function drawConditionsBar(ctx: CanvasRenderingContext2D, bar: ConditionsBar, H: number): void {
  const C_ = CONDITIONS_BAR, top = H - C_.margin - bar.height, width = Math.max(...bar.lines.map(l => { ctx.font = `bold ${bar.size}px monospace`; return ctx.measureText(l).width; })) + 2 * C_.pad;
  ctx.fillStyle = 'rgba(5,1,15,0.72)'; ctx.fillRect(C_.margin, top, width, bar.height);
  ctx.font = `bold ${bar.size}px monospace`; ctx.textAlign = 'left'; ctx.fillStyle = C.cyan;
  bar.lines.forEach((l, k) => ctx.fillText(l, C_.margin + C_.pad, top + C_.pad + C_.lineHeight * (k + 1) - 4));
}
export function createDragTopDown() {
  let puffs: Puff[] = [], skids: Skid[] = [], puffCount = 0, last: DragHudState | null = null; const prev = new Map<string, { x: number; lat: number }>();
  const laneX = (i: number): number => (i === 0 ? -LANE_M : LANE_M);
  /** the car's four wheel positions, in metres along the strip (x) and across it (lat): the rear slicks and the front wheels, turned by the car's heading */
  function wheelsOf(r: Runner, i: number): { rl: { x: number; lat: number }; rr: { x: number; lat: number } } {
    const c = Math.cos(r.psi), s = Math.sin(r.psi), lat0 = laneX(i) + r.y, put = (fx: number, rt: number): { x: number; lat: number } => ({ x: r.x + fx * c - rt * s, lat: lat0 + fx * s + rt * c });
    return { rl: put(-1.6, -1.0), rr: put(-1.6, 1.0) };      // (fx forward, rt to the right)
  }
  function draw(ctx: CanvasRenderingContext2D, W: number, H: number, s: DragHudState, mine: number, dt: number, time: number): void {
    if (last && last.runners !== s.runners) { puffs = []; skids = []; prev.clear(); puffCount = 0; } last = s;
    const me = (s.runners[mine] ?? s.runners[0]) as Runner | undefined, camX = me ? me.x : 0, v = me ? me.v : 0, scale = H / (28 + v * 0.55), cx = W / 2;
    // the conditions bar along the bottom is measured first: the readouts under your car must end above it, so on a short window the car is drawn higher up the screen
    const bar = conditionsBar(ctx, W, s.weather ?? s.conditions, s.conditions), unit = Math.max(READOUT_UNIT.min, Math.min(READOUT_UNIT.max, scale));
    const readoutShift = Math.max(0, READOUT_UNIT.tailClear * scale - READOUT_UNIT.firstLineTop * unit), readoutRoom = (H - bar.height - CONDITIONS_BAR.margin - CONDITIONS_BAR.readoutGap) - (readoutShift + READOUT_UNIT.extent * unit);
    const yBase = Math.max(H * 0.5, Math.min(H * 0.68, readoutRoom));
    const sx = (lat: number): number => cx + lat * scale, sy = (x: number): number => yBase - (x - camX) * scale, xTop = camX + yBase / scale + 4, xBot = camX - (H - yBase) / scale - 4, half = LANE_M * 2;
    ctx.fillStyle = '#05010f'; ctx.fillRect(0, 0, W, H);
    // the ground beside the strip: a faint grid that scrolls past, every 10 m
    ctx.strokeStyle = 'rgba(33,230,255,0.08)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = Math.floor(xBot / 10) * 10; x <= xTop; x += 10) { ctx.moveTo(0, sy(x)); ctx.lineTo(W, sy(x)); }
    for (let lat = Math.floor(-cx / scale / 10) * 10; lat <= cx / scale + 10; lat += 10) { ctx.moveTo(sx(lat), 0); ctx.lineTo(sx(lat), H); }
    ctx.stroke();
    // the strip, its walls, the centre line (red where a car crossing it is disqualified) and its dashes
    ctx.fillStyle = '#0a0524'; ctx.fillRect(sx(-half), 0, half * 2 * scale, H);
    const crossed = s.runners.some(r => r.crossed); ctx.setLineDash([2.5 * scale, 3.5 * scale]); ctx.strokeStyle = crossed ? C.red : 'rgba(255,225,77,0.6)'; ctx.lineWidth = Math.max(1.5, 0.25 * scale); ctx.beginPath(); ctx.moveTo(sx(0), 0); ctx.lineTo(sx(0), H); ctx.stroke(); ctx.setLineDash([]);
    ctx.shadowColor = C.mag; ctx.shadowBlur = 8; ctx.strokeStyle = C.mag; ctx.lineWidth = Math.max(2, 0.5 * scale); ctx.beginPath(); for (const l of [-half, half]) { ctx.moveTo(sx(l), 0); ctx.lineTo(sx(l), H); } ctx.stroke(); ctx.shadowBlur = 0;
    // rubber laid by this session's burnouts and spins: darker stripes that stay on the strip
    for (const i of [0, 1]) for (const side of [0, 1] as const) for (let c = Math.max(0, Math.floor(xBot / RUBBER.cell)); c * RUBBER.cell <= xTop; c++) {
      const amount = rubberAt(s.strip, i, side, (c + 0.5) * RUBBER.cell); if (amount < 0.02) continue;
      ctx.fillStyle = `rgba(0,0,0,${(0.15 + 0.55 * amount).toFixed(3)})`;
      ctx.fillRect(sx(laneX(i) + (side ? 1.0 : -1.0)) - 0.45 * scale, sy((c + 1) * RUBBER.cell), 0.9 * scale, RUBBER.cell * scale);
    }
    // the start line (white), the marks and the chequered finish, with their names on the right
    ctx.fillStyle = '#ffffff'; ctx.fillRect(sx(-half), sy(0) - 0.3 * scale, half * 2 * scale, 0.6 * scale);
    // the names written to the right of the strip: collected, spread apart so two close beams (pre-stage, stage, deep stage are under a metre apart) never write over each other, then drawn with a short line to their beam
    const names: SideName[] = [];
    const boxTop = sy(STAGE.waterBoxEnd), boxBottom = sy(STAGE.waterBoxStart); if (boxBottom > -20 && boxTop < H + 20) { ctx.fillStyle = 'rgba(33,140,255,0.22)'; ctx.fillRect(sx(-half), boxTop, half * 2 * scale, boxBottom - boxTop); names.push({ text: 'WATER BOX', beam: boxTop + 14, at: boxTop + 14, col: C.cyan, line: false }); }
    // the staging area behind the line: the pre-stage beam, the stage beam and the deep stage beam, and the run-out past the tree
    const beam = (y: number, fill: string, thick: number, text: string, col: string): void => { if (y > -20 && y < H + 20) { ctx.fillStyle = fill; ctx.fillRect(sx(-half), y - thick * scale / 2, half * 2 * scale, thick * scale); names.push({ text, beam: y, at: y + 4, col, line: true }); } };
    beam(sy(-STAGE.preStageRollout), 'rgba(255,225,77,0.7)', 0.3, 'PRE-STAGE', C.yel); beam(sy(-DRAG.stageRollout), 'rgba(33,230,255,0.7)', 0.5, 'STAGE', C.cyan); beam(sy(-DRAG.deepStageRollout), 'rgba(255,138,31,0.8)', 0.3, 'DEEP', C.org);
    for (const [k, x] of Object.entries(DRAG.marks) as [Mark, number][]) {
      const y = sy(x); if (y < -20 || y > H + 20) continue;
      if (k === 'quarter') { const n = 16, w = (half * 2 * scale) / n; for (let q = 0; q < n; q++) for (let row = 0; row < 2; row++) { ctx.fillStyle = (q + row) % 2 ? '#e8f8ff' : '#150a30'; ctx.fillRect(sx(-half) + q * w, y - 1.2 * scale + row * 1.2 * scale, w, 1.2 * scale); } }
      else { ctx.fillStyle = 'rgba(255,225,77,0.55)'; ctx.fillRect(sx(-half), y - 0.15 * scale, half * 2 * scale, 0.3 * scale); }
      names.push({ text: MARK_NAMES[k], beam: y, at: y + 4, col: C.yel, line: false });
    }
    const endY = sy(SHUTDOWN.end); if (endY > -20 && endY < H + 20) { ctx.fillStyle = C.red; ctx.fillRect(sx(-half), endY - 0.3 * scale, half * 2 * scale, 0.6 * scale); names.push({ text: 'END OF STRIP', beam: endY, at: endY + 4, col: C.red, line: false }); }
    drawSideNames(ctx, names, sx(half), scale, W);
    drawConditionsBar(ctx, bar, H);
    // the tire marks on the strip, and the smoke
    ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = Math.max(2, 0.8 * scale); ctx.beginPath(); for (const k of skids) { const a = sy(k.x0), b = sy(k.x1); if ((a < -10 && b < -10) || (a > H + 10 && b > H + 10)) continue; ctx.moveTo(sx(k.y0), a); ctx.lineTo(sx(k.y1), b); } ctx.stroke(); ctx.lineCap = 'butt';
    s.runners.forEach((r, i) => {      // new marks and smoke from every spinning rear tire (and a burnout on the line)
      const w = wheelsOf(r, i), sides: [string, { x: number; lat: number }, boolean][] = [['l', w.rl, r.spin || r.spinL || r.burnout], ['r', w.rr, r.spin || r.spinR || r.burnout]];
      for (const [side, p, spinning] of sides) {
        const key = `${i}${side}`, was = prev.get(key);
        if (spinning && (r.launched || r.burnout) && was) { if (r.launched) { skids.push({ x0: was.x, y0: was.lat, x1: p.x, y1: p.lat }); if (skids.length > 1600) skids.splice(0, 200); } if (dt > 0) puffs.push({ x: p.x, y: p.lat, vx: -r.v * 0.2 - 2, vy: (puffNoise(puffCount, 1) - 0.5) * 3, t: 0, max: 0.8 + puffNoise(puffCount++, 2) * 0.5 }); }
        prev.set(key, p);
      }
    });
    if (dt > 0) for (const p of puffs) { const w = windAt(p.x, time, s.weather ?? s.conditions); p.t += dt; p.x += (p.vx - w.head * SMOKE_TOP.windDrift) * dt; p.y += (p.vy + w.cross * SMOKE_TOP.windDrift) * dt; } puffs = puffs.filter(p => p.t < p.max);
    for (const p of puffs) { const f = p.t / p.max; ctx.globalAlpha = 0.45 * (1 - f); ctx.fillStyle = '#bdf7ff'; ctx.beginPath(); ctx.arc(sx(p.y), sy(p.x), (0.6 + 1.8 * f) * scale, 0, 6.283); ctx.fill(); } ctx.globalAlpha = 1;
    // the cars: the one you drive last, so it is on top
    const order = s.runners.map((_, i) => i).sort((a, b) => (a === mine ? 1 : 0) - (b === mine ? 1 : 0));
    for (const i of order) carOf(ctx, s.runners[i] as Runner, i, sx(laneX(i) + (s.runners[i] as Runner).y), sy((s.runners[i] as Runner).x), scale, time, i === mine);
    // the readouts come last, on top of every car, and only for your car: two cars side by side would write over each other's
    const mineRunner = s.runners[mine];
    if (mineRunner && !mineRunner.ghost) {
      // under the car, clear of its tail, whenever that fits above the conditions bar (the car is drawn higher on a short window to make it fit); if even then it cannot, beside the car on the side away from the other car
      const rivalIdx = s.runners.findIndex((_, i) => i !== mine), away = rivalIdx < 0 ? 0 : laneX(rivalIdx) > laneX(mine) ? -1 : 1, px = sx(laneX(mine) + mineRunner.y), wide = unit * 0.95 * READOUT.charWidth * READOUT.chars + READOUT.gap * unit;
      const fitsUnder = readoutRoom >= H * 0.5, side: -1 | 0 | 1 = fitsUnder ? 0 : away < 0 && px - wide > 0 ? -1 : away > 0 && px + wide < W ? 1 : 0;
      readoutsOf(ctx, mineRunner, px, sy(mineRunner.x) + (side === 0 ? readoutShift : 0), unit, side);
    }
    ctx.textAlign = 'left';
  }
  /** one car from above at (x, y) on the screen, its nose up and turned by its heading: `scale` pixels to the metre */
  function carOf(ctx: CanvasRenderingContext2D, r: Runner, i: number, x: number, y: number, scale: number, time: number, mineCar: boolean): void {
    const m = scale, col = r.spec.col, trim = r.spec.trim;
    ctx.save(); ctx.translate(x, y); ctx.rotate(r.psi); ctx.lineWidth = Math.max(1.2, 0.12 * m);
    if (r.nitroOn) for (const off of [-0.45, 0.45]) { const L = (2.4 + 1.2 * Math.abs(Math.sin(time * 40 + off * 9))) * m; ctx.fillStyle = 'rgba(255,138,31,0.85)'; ctx.beginPath(); ctx.moveTo((off - 0.18) * m, 2.5 * m); ctx.lineTo(off * m, 2.5 * m + L); ctx.lineTo((off + 0.18) * m, 2.5 * m); ctx.fill(); ctx.fillStyle = 'rgba(255,240,200,0.9)'; ctx.beginPath(); ctx.moveTo((off - 0.08) * m, 2.5 * m); ctx.lineTo(off * m, 2.5 * m + L * 0.55); ctx.lineTo((off + 0.08) * m, 2.5 * m); ctx.fill(); }
    const opening = chuteOpening(r);
    if (opening > 0) { const Ctop = CHUTE_TOP; ctx.globalAlpha = Ctop.minAlpha + Ctop.alphaSpan * opening; ctx.fillStyle = 'rgba(255,43,214,0.85)'; ctx.beginPath(); ctx.ellipse(0, (Ctop.back + Ctop.lift * opening) * m, (Ctop.minWidth + (Ctop.maxWidth - Ctop.minWidth) * opening) * m, (Ctop.minHeight + (Ctop.maxHeight - Ctop.minHeight) * opening) * m, 0, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.shadowColor = col; ctx.shadowBlur = mineCar ? 12 : 6;
    const tl = r.tires[0] ?? { temp: r.tireTemp, wear: 0 }, tr = r.tires[1] ?? { temp: r.tireTemp, wear: 0 };
    const warmL = Number.isFinite(tl.temp) ? tl.temp >= DRAG.tire.windowLo : r.tireTemp >= DRAG.tire.windowLo, warmR = Number.isFinite(tr.temp) ? tr.temp >= DRAG.tire.windowLo : r.tireTemp >= DRAG.tire.windowLo;
    const wearL = Number.isFinite(tl.wear) ? Math.max(0, Math.min(1, tl.wear)) : 0, wearR = Number.isFinite(tr.wear) ? Math.max(0, Math.min(1, tr.wear)) : 0;
    const wheel = (wx: number, wy: number, w: number, h: number, hot: boolean, warmTire = false, wear = 0, spin = 0): void => {
      const alpha = ctx.globalAlpha, lw = ctx.lineWidth; ctx.globalAlpha = alpha * (1 - 0.45 * wear); ctx.fillStyle = wear > 0.5 ? '#3a0b16' : warmTire ? '#241000' : '#05010f'; ctx.strokeStyle = hot ? C.org : wear > 0.5 ? C.red : warmTire ? '#ff8a1f' : trim; ctx.fillRect((wx - w / 2) * m, (wy - h / 2) * m, w * m, h * m); ctx.strokeRect((wx - w / 2) * m, (wy - h / 2) * m, w * m, h * m);
      if (hot) {
        ctx.strokeStyle = C.yel; ctx.lineWidth = Math.max(1, TIRE_SPIN.line * m); ctx.beginPath();
        for (let k = 0; k < TIRE_SPIN.stripes; k++) { const u = ((k + spin) % TIRE_SPIN.stripes) / TIRE_SPIN.stripes - 0.5, px = (wx + u * w * TIRE_SPIN.gap) * m; ctx.moveTo(px, (wy - h / 2 + 0.08) * m); ctx.lineTo(px + TIRE_SPIN.skew * m, (wy + h / 2 - 0.08) * m); }
        ctx.stroke();
      }
      ctx.globalAlpha = alpha; ctx.lineWidth = lw;
    };
    const spin = ((time * TIRE_SPIN.hz) % TIRE_SPIN.stripes + TIRE_SPIN.stripes) % TIRE_SPIN.stripes;
    wheel(-1.0, 1.6, 0.95, 1.4, r.spin || r.spinL || r.burnout, warmL, wearL, spin); wheel(1.0, 1.6, 0.95, 1.4, r.spin || r.spinR || r.burnout, warmR, wearR, spin);      // the slicks at the back
    ctx.globalAlpha = 1 - LIFT.frontFade * r.lift; wheel(-0.62, -1.7, 0.32, 0.85, false); wheel(0.62, -1.7, 0.32, 0.85, false); ctx.globalAlpha = 1;      // the thin fronts fade as they lift
    ctx.strokeStyle = col; ctx.fillStyle = '#10062e'; ctx.beginPath(); ctx.moveTo(0, -2.7 * m); ctx.lineTo(0.28 * m, -1.8 * m); ctx.lineTo(0.42 * m, 0.4 * m); ctx.lineTo(0.55 * m, 2.1 * m); ctx.lineTo(-0.55 * m, 2.1 * m); ctx.lineTo(-0.42 * m, 0.4 * m); ctx.lineTo(-0.28 * m, -1.8 * m); ctx.closePath(); ctx.fill(); ctx.stroke();      // the body
    ctx.strokeStyle = trim; ctx.fillStyle = '#10062e'; ctx.strokeRect(-1.1 * m, 2.1 * m, 2.2 * m, 0.34 * m); ctx.fillRect(-1.1 * m, 2.1 * m, 2.2 * m, 0.34 * m);      // the rear wing
    ctx.shadowBlur = 0; ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, 0.35 * m, 0.22 * m, 0.4 * m, 0, 0, 6.283); ctx.fill(); ctx.fillStyle = trim; ctx.fillRect(-0.3 * m, 1.1 * m, 0.6 * m, 0.7 * m);      // (the driver, and the engine)
    if (r.reversing) { ctx.fillStyle = '#ffffff'; ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 10; for (const off of [-0.45, 0.45]) ctx.fillRect((off - 0.12) * m, 2.5 * m, 0.24 * m, 0.2 * m); ctx.shadowBlur = 0; }      // the reverse lights
    ctx.restore();
    // your labels sit over your car. The GHOST HAS NO TEXT AT ALL (no name, stage or ET beside it): its delta is on the HUD and the timeslip's VS table.
    if (r.ghost) return;
    const lx = x;
    ctx.font = `bold ${Math.max(READOUT_UNIT.min * 0.95, Math.min(READOUT_UNIT.max * 0.95, 0.95 * m))}px monospace`; ctx.textAlign = 'center'; ctx.fillStyle = C.cyan; ctx.fillText(i === 0 && mineCar ? 'YOU' : r.name, lx, y - 3.4 * m);
    if (r.lift > 0) { ctx.fillStyle = C.yel; ctx.fillText('FRONT UP', lx, y - LIFT.labelLine * m); }
    if (r.aborted) { ctx.fillStyle = C.red; ctx.fillText('ABORT', lx, y - 4.6 * m); }
    else if (r.rolling) { ctx.fillStyle = '#34ff7a'; ctx.fillText('ROLLING', lx, y - 4.6 * m); }
    else if (!r.launched) { ctx.fillStyle = r.overstaged ? C.red : r.stage === 'staged' || r.stage === 'deepStaged' ? C.yel : C.cyan; ctx.fillText(stageLabel(r) || 'STAGED', lx, y - 4.6 * m); }
    else if (r.crossed || r.foul) { ctx.fillStyle = C.red; ctx.fillText(r.crossed ? 'OVER THE LINE' : 'RED LIGHT', lx, y - 4.6 * m); }
    else if (r.wall) { ctx.fillStyle = C.org; ctx.fillText('WALL', lx, y - 4.6 * m); }
  }
  /** the player's own readouts under the car: clutch, boost, tires and fuel (written with a dark edge so they stay readable over the lane and the other car) */
  function readoutsOf(ctx: CanvasRenderingContext2D, r: Runner, carX: number, carY: number, scale: number, side: -1 | 0 | 1): void {
    // beside the car the block starts level with the car, under it (the narrow screen) it starts below the car
    const y = side === 0 ? carY : carY - READOUT.besideLift * scale;
    // `side` is -1 / 1 for writing beside the car (to the left / right of it) and 0 for under it
    const x = carX + side * READOUT.gap * scale, bx = (halfW: number): number => (side === 0 ? x - halfW * scale : side < 0 ? x - 2 * halfW * scale : x);
    ctx.font = `bold ${Math.max(10, 0.95 * scale)}px monospace`; ctx.textAlign = side < 0 ? 'right' : side > 0 ? 'left' : 'center'; ctx.lineJoin = 'round';
    const put = (text: string, tx: number, ty: number): void => { ctx.save(); ctx.strokeStyle = 'rgba(5,1,15,0.9)'; ctx.lineWidth = 3; ctx.strokeText(text, tx, ty); ctx.restore(); ctx.fillText(text, tx, ty); };
    const tl = r.tires[0] ?? { temp: r.tireTemp, wear: 0 }, tr = r.tires[1] ?? { temp: r.tireTemp, wear: 0 }, wearL = Number.isFinite(tl.wear) ? Math.max(0, Math.min(1, tl.wear)) : 0, wearR = Number.isFinite(tr.wear) ? Math.max(0, Math.min(1, tr.wear)) : 0, m = scale, cc = CLUTCH_LABEL, temp = Number.isFinite(r.clutchTemp) ? r.clutchTemp : CLUTCH.ambient, condition = Number.isFinite(r.clutchCondition) ? Math.max(CLUTCH.minCondition, Math.min(1, r.clutchCondition)) : 1, heat = Math.max(0, Math.min(1, (temp - CLUTCH.ambient) / Math.max(1, CLUTCH.maxTemp - CLUTCH.ambient))), heatCol = temp >= CLUTCH.wearHotTemp ? C.red : temp >= CLUTCH.fadeFrom ? C.org : C.cyan;
    ctx.fillStyle = heatCol; put(`CLUTCH ${Math.round(temp)}C ${Math.round(condition * 100)}%${r.clutchLocked ? ' LOCK' : r.launched ? ' SLIP' : ''}`, x, y + cc.line * m); ctx.strokeStyle = heatCol; ctx.lineWidth = Math.max(1, 0.1 * m); ctx.strokeRect(bx(cc.halfW), y + cc.barY * m, cc.halfW * 2 * m, cc.barH * m); ctx.fillRect(bx(cc.halfW), y + cc.barY * m, cc.halfW * 2 * m * heat, cc.barH * m); ctx.strokeStyle = C.cyan; ctx.strokeRect(bx(cc.halfW), y + (cc.barY + cc.barH + 0.1) * m, cc.halfW * 2 * m, cc.barH * m); ctx.fillStyle = C.cyan; ctx.fillRect(bx(cc.halfW), y + (cc.barY + cc.barH + 0.1) * m, cc.halfW * 2 * m * condition, cc.barH * m);
    if (r.spec.boostCap > 0) {
      const B = BOOST_LABEL, boost = Math.max(0, Math.min(BOOST.maxLimit, r.boost)), col = boostLimitOf(r.tune) > BOOST.safeLimit ? C.org : C.cyan, temp = Number.isFinite(r.engineTemp) ? r.engineTemp : DRAG.tire.ambient, retard = Number.isFinite(r.retard) ? r.retard : 0, heatCol = retard > 0.01 ? C.red : col;
      ctx.fillStyle = heatCol; put(`BOOST ${Math.round(boost * 100)}%  ${Math.round(temp)}C -${Math.round(retard * 100)}%`, x, y + B.line * m); ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, 0.1 * m); ctx.strokeRect(bx(B.halfW), y + B.barY * m, B.halfW * 2 * m, B.barH * m); ctx.fillRect(bx(B.halfW), y + B.barY * m, B.halfW * 2 * m * boost, B.barH * m);
    }
    ctx.fillStyle = wearL > 0.2 || wearR > 0.2 ? C.org : C.cyan; put(`TIRE L${Math.round(tl.temp)}C ${Math.round(wearL * 100)}%  R${Math.round(tr.temp)}C ${Math.round(wearR * 100)}%`, x, y + TIRE_LABEL.line * m);
    const f = fuelShare(r); ctx.fillStyle = f < FUEL_LABEL.low ? C.red : C.cyan; put(`FUEL ${(Math.round(r.fuel * 10) / 10).toFixed(1)} KG ${Math.round(f * 100)}%`, x, y + FUEL_LABEL.line * m);
      }
  return { draw };
}
