// The drag strip from above (the Options page's CAMERA VIEW "top down"): the strip scrolls down the screen with your car, both lanes between their pink walls, the start line, a line across the strip at every mark
// of the timeslip (60 ft, 330 ft, an eighth, 1000 ft) and the chequered finish, and the two cars from above (a long thin body, big slicks at the back, narrow fronts, the rear wing), turned the way they are heading and
// across their lanes where they are. A spinning rear tire smokes and leaves a mark on the strip, the nitro burns out of the stacks, a car over the centre line is flagged. The camera is behind the middle of your car
// and pulls back as you go faster. It only reads the race and draws; the HUD (every readout, in one panel on the left) is drawn over it by hud.ts. The only words drawn here are the names of the beams and marks beside the strip.
import { C } from '../sim/constants.ts';
import { DRAG, RUBBER, SHUTDOWN, STAGE, chuteOpening, rubberAt, windAt } from './physics.ts';
import type { DragHudState } from './hud.ts';
import type { Mark, Runner } from './types.ts';

/** each lane's middle is this far either side of the centre line (the 3D strip's number) */
export const LANE_M = 2.4;
const MARK_NAMES: Record<Mark, string> = { ft60: '60 FT', ft330: '330 FT', eighth: '1/8 MILE', ft1000: '1000 FT', trapStart: '66 FT TRAP', quarter: 'FINISH' };
const LIFT = { frontFade: 0.75, labelLine: 5.8 } as const;
/** your car sits this share of the way down the screen (the readouts are in the left panel now, so nothing needs room under it) */
export const CAR_Y_SHARE = 0.68;
/** where the nose of a car standing still is on the screen (the highest it gets): the left panel stays above this on a narrow screen */
export const carNoseY = (H: number): number => H * CAR_Y_SHARE - 2.7 * H / 28;
/** the labels written to the right of the strip (water box, beams, marks): their size, the gap from the wall, and the lowest px between two labels */
/** the short form of a name when its full form would need text under minSize to fit beside a narrow strip */
const SHORT_NAME: Record<string, string> = { 'END OF STRIP': 'END', '66 FT TRAP': 'TRAP', 'WATER BOX': 'WATER', 'PRE-STAGE': 'PRE', '1/8 MILE': '1/8', '1000 FT': '1000' };
const SIDE_LABEL = { minSize: 10, maxSize: 14, gap: 8, spacing: 1.15 } as const;
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
    // a long name on a narrow window is shortened first, and only then made smaller (never under minSize)
    const label = n.text.length * 0.6 * SIDE_LABEL.minSize > room && SHORT_NAME[n.text] ? SHORT_NAME[n.text] as string : n.text;
    const fit = Math.max(SIDE_LABEL.minSize, Math.min(size, room / (label.length * 0.6))); ctx.font = `bold ${fit}px monospace`;
    if (n.line && n.at - 4 !== n.beam) { ctx.strokeStyle = n.col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(wallX, n.beam); ctx.lineTo(x - 1, n.at - fit * 0.35); ctx.stroke(); }
    ctx.fillStyle = n.col; ctx.fillText(label, x, n.at);
  }
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
    const yBase = H * CAR_Y_SHARE;
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
    for (const i of [0, 1]) for (const side of [0, 1] as const) for (let c = Math.floor(Math.max(xBot, -RUBBER.behindLine) / RUBBER.cell); c * RUBBER.cell <= xTop; c++) {
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
    for (const i of order) carOf(ctx, s.runners[i] as Runner, sx(laneX(i) + (s.runners[i] as Runner).y), sy((s.runners[i] as Runner).x), scale, time, i === mine);
    ctx.textAlign = 'left';
  }
  /** one car from above at (x, y) on the screen (no words: every readout is in the left panel of hud.ts, the ghost car has none at all), its nose up and turned by its heading: `scale` pixels to the metre */
  function carOf(ctx: CanvasRenderingContext2D, r: Runner, x: number, y: number, scale: number, time: number, mineCar: boolean): void {
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
  }
  return { draw };
}
