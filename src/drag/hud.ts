// What is drawn over the drag strip DURING a run. Everything a player reads sits in ONE panel down the left of the screen (`drawRunPanel`): the stage, reaction time and run timer,
// the shift lights with the rpm, gear and speed, the warnings (wheelspin, clutch, front wheels up), nitro, boost, tire temperatures and your place in the lane. Nothing else carries data:
// conditions, pressures, fuel, engine heat, weights, splits, ET and trap speed are on the timeslip, and the ghost car has no text at all. In the middle of the screen only the
// tree (a graphic), the key to press next and the alerts (crash, centre line, stop before the end) are written. It only reads the race; drawing is all it does.
import { C } from '../sim/constants.ts';
import { DRAG, LANE, SHUTDOWN, STAGE, boostLimitOf, stageLabel } from './physics.ts';
import { BOOST, CLUTCH } from './tune.ts';
import { carNoseY } from './topdown.ts';
import type { DragConditions, DragStrip, Runner } from './types.ts';

export interface DragHudState { t: number; greenAt: number; /** the tree is armed once every live car is in final stage (missing on old states: counts as armed) */ armed?: boolean; ambers: number; green: boolean; phase: string; conditions: DragConditions; weather?: DragConditions; strip?: DragStrip; runners: Runner[] }
const glow = (ctx: CanvasRenderingContext2D, col: string | null, b: number): void => { ctx.shadowColor = col ?? 'transparent'; ctx.shadowBlur = col ? b : 0; };
const text = (ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, col: string, align: CanvasTextAlign = 'left', a = 1): void => { ctx.globalAlpha = a; ctx.font = `bold ${Math.round(size)}px monospace`; ctx.textAlign = align; glow(ctx, col, 8); ctx.fillStyle = col; ctx.fillText(s, x, y); glow(ctx, null, 0); ctx.globalAlpha = 1; };
const clamp01 = (v: number): number => Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
/** the lane marker: outline where the wheel asks the nose to point when the slicks run out of grip, filled where it is heading */
const LANE_HUD = { slideAt: 0.15, markerW: 16, markerH: 28, turnGain: 6 } as const;
/**
 * The left panel. Sizes are in `unit`s (one text row) that shrink to fit the window: `minUnit`/`maxUnit` are px per row (the max grows with the window, `fontShare` of a row is the text),
 * `chars` is the widest line the panel is built for, `widthShare` the most of a narrow window it may take. The row counts are fixed so nothing jumps when a row appears.
 */
const PANEL = { margin: 8, pad: 6, gap: 0.3, minUnit: 10, maxUnit: 16, fontShare: 0.84, chars: 22, charW: 0.6, widthShare: 0.5, notesRows: 5, rows: { stage: 1.4, timing: 1, lamps: 1, rpmBar: 0.8, drive: 2.3, nitro: 1.7, boost: 1.7, tires: 1.7, lane: 2.8 } } as const;
/** half the tree's width in px at S = 1 (two lanes of 26 px and the 6 px of backing) */
const TREE_HALF = 32;
/** the panel's box on the screen and the row height used: tests check every readout lies inside it */
export interface RunPanelBox { x: number; y: number; w: number; h: number; unit: number; layout: PanelLayout }
/** which blocks the panel shows at this size */
export interface PanelLayout { lane: boolean; tires: boolean; boost: boolean; nitro: boolean; notes: number }
/**
 * THE NUMBERS TO TURN AFTER A PHONE TEST. `minFont` is the smallest text (px) the panel will ever write: when the rows would need smaller text, the panel DROPS rows instead, in `dropOrder`
 * (the least useful first: the lane gauge, then the notes cut to 2 rows, the tire bars, the boost bar, the nitro bar, the notes cut to 1 row). `hiddenWithTouch` are dropped at once whenever
 * the touch buttons are on screen. The panel also stays clear of every touch button: its rows only use the space above the first button under it.
 */
export const PHONE_HUD = { minFont: 10, hiddenWithTouch: ['lane'], dropOrder: ['lane', 'notes2', 'tires', 'boost', 'nitro', 'notes1'], touchGap: 4 } as const;
/** the names of the keys the HUD tells the player to press; `avoid` is the touch buttons on screen (empty when touch is off): the panel stays clear of every one */
export interface DragKeyLabels { launch: string; nitro: string; manual: boolean; auto?: boolean; burnout?: string; gas?: string; brake?: string; chute?: string; deepStage?: string; clutch?: string; backUp?: string; avoid?: TouchSpot[] }
/** a touch button's rectangle (the page passes the layout of src/input/touch.ts) */
export interface TouchSpot { id: string; x: number; y: number; w: number; h: number }

/** a line split at spaces into rows of at most `max` characters (a longer word is cut) */
export function wrapNote(str: string, max: number): string[] {
  const out: string[] = []; let rest = str.trim();
  while (rest.length > max) { let cut = rest.lastIndexOf(' ', max); if (cut <= 0) cut = max; out.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim(); }
  out.push(rest); return out;
}
/** the blocks left after the first `level` steps of the drop order (plus the ones hidden under touch) */
function layoutAt(me: Runner, level: number, touch: boolean): PanelLayout {
  const gone = new Set<string>(PHONE_HUD.dropOrder.slice(0, level)); if (touch) for (const g of PHONE_HUD.hiddenWithTouch) gone.add(g);
  return { lane: !gone.has('lane'), tires: !gone.has('tires'), boost: me.spec.boostCap > 0 && !gone.has('boost'), nitro: me.spec.nitroSecs > 0 && !gone.has('nitro'), notes: gone.has('notes1') ? 1 : gone.has('notes2') ? 2 : PANEL.notesRows };
}
/** the rows (in units) a layout needs, with the gaps between its blocks */
function rowsOf(l: PanelLayout): number {
  const R = PANEL.rows, blocks = [R.stage, R.timing, R.lamps, R.rpmBar, R.drive, l.notes, l.nitro ? R.nitro : 0, l.boost ? R.boost : 0, l.tires ? R.tires : 0, l.lane ? R.lane : 0].filter(v => v > 0);
  return blocks.reduce((a, b) => a + b, 0) + (blocks.length - 1) * PANEL.gap;
}
/** the panel's size for this window: the row height, its width and which blocks fit (text never goes under PHONE_HUD.minFont and never under a touch button) */
export function runPanelBox(W: number, H: number, S: number, me: Runner, avoid: TouchSpot[] = []): RunPanelBox {
  const touch = avoid.length > 0, portrait = W < H, sc = Math.max(0.9, S), minUnit = PHONE_HUD.minFont / PANEL.fontShare;
  // never wider than the gap to the tree (the tree is two lanes of bulbs, 26 px each, around the middle)
  const wide = Math.max(80, Math.min(W * PANEL.widthShare, W / 2 - TREE_HALF * S - 2 * PANEL.margin)), x0 = PANEL.margin;
  // the space for rows: below the MENU button, above the first touch button under the panel
  const menu = avoid.find(r => r.id === 'menu'), top = Math.max(PANEL.margin, menu ? menu.y + menu.h + PHONE_HUD.touchGap : 0);
  let bottom = H - PANEL.margin; for (const r of avoid) if (r.id !== 'menu' && r.x < x0 + wide && r.x + r.w > x0 && r.y + r.h > top) bottom = Math.min(bottom, r.y - PHONE_HUD.touchGap);
  // a tall narrow window keeps the panel above the car's nose when that fits; otherwise it may run down the whole left side (its backing is see-through)
  const bands = portrait ? [Math.min(bottom, carNoseY(H) - PANEL.margin) - top - 2 * PANEL.pad, bottom - top - 2 * PANEL.pad] : [bottom - top - 2 * PANEL.pad];
  let pick: { layout: PanelLayout; usable: number } | null = null;
  for (const usable of bands) { for (let level = 0; level <= PHONE_HUD.dropOrder.length && !pick; level++) { const layout = layoutAt(me, level, touch); if (usable / rowsOf(layout) >= minUnit) pick = { layout, usable }; } if (pick) break; }
  const last = layoutAt(me, PHONE_HUD.dropOrder.length, touch), { layout, usable } = pick ?? { layout: last, usable: (bands[bands.length - 1] as number) }, count = rowsOf(layout);
  const unit = Math.max(minUnit, Math.min(PANEL.maxUnit * sc, usable / count)), font = unit * PANEL.fontShare;
  const w = Math.min(wide, font * PANEL.charW * PANEL.chars + 2 * PANEL.pad);
  return { x: x0, y: top, w, h: count * unit + 2 * PANEL.pad, unit, layout };
}

/** the left panel: see the comment on PANEL for what is in it and why nothing else is */
export function drawRunPanel(ctx: CanvasRenderingContext2D, W: number, H: number, s: DragHudState, mine: number, S: number, keys: DragKeyLabels): RunPanelBox {
  const me = (s.runners[mine] ?? s.runners[0]) as Runner, box = runPanelBox(W, H, S, me, keys.avoid), L = box.layout, u = box.unit, font = u * PANEL.fontShare, x = box.x + PANEL.pad, w = box.w - 2 * PANEL.pad, R = PANEL.rows, time = s.t;
  ctx.save(); ctx.fillStyle = 'rgba(5,1,15,0.72)'; ctx.fillRect(box.x, box.y, box.w, box.h);
  let y = box.y + PANEL.pad;
  /** a line of writing, shrunk so it never leaves the panel */
  const line = (str: string, row: number, col: string, size = font, align: CanvasTextAlign = 'left', alpha = 1, at = x, room = w): void => { const fit = Math.max(PHONE_HUD.minFont, Math.min(size, room / (Math.max(1, str.length) * PANEL.charW))); text(ctx, str, align === 'right' ? at + room : align === 'center' ? at + room / 2 : at, y + row * u - u * 0.22, fit, col, align, alpha); };
  const bar = (top: number, bx: number, bw: number, bh: number, f: number, col: string): void => { ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.strokeRect(bx, top, bw, bh); ctx.fillStyle = col; ctx.fillRect(bx + 2, top + 2, Math.max(0, (bw - 4) * clamp01(f)), Math.max(1, bh - 4)); };
  const next = (rows: number): void => { y += (rows + PANEL.gap) * u; };
  // the stage: the one word that says where you are in the sequence (or the foul), and AUTO in front of it when the autopilot is driving
  const phase = me.aborted ? 'ABORT' : me.foul ? 'RED LIGHT' : me.rolling ? 'ROLLING' : me.crossed ? 'OVER THE LINE' : me.wall ? 'WALL' : !me.launched ? (stageLabel(me) || 'STAGED') : '', phaseCol = me.aborted || me.foul || me.crossed || me.overstaged ? C.red : me.wall ? C.org : me.rolling ? '#34ff7a' : me.stage === 'staged' || me.stage === 'deepStaged' ? C.yel : C.cyan;
  if (phase) line(`${keys.auto ? 'AUTO ' : ''}${phase}`, R.stage, phaseCol, font * 1.15); next(R.stage);
  // reaction time and the run timer (the elapsed time since the launch, frozen at the finish line)
  const run = me.finished && me.marks.quarter !== undefined ? me.marks.quarter : me.launched ? Math.max(0, s.t - me.launchT) : null;
  if (me.reaction !== null && me.reaction >= 0 && !me.foul) line(`R/T ${me.reaction.toFixed(3)}`, R.timing, C.white);
  if (run !== null) line(`T ${run.toFixed(2)}`, R.timing, C.yel, font, 'right'); next(R.timing);
  // the shift light: five lamps that fill as you near the shift point, all flashing at it, then the rpm bar with its redline
  const sp = me.spec, target = me.tune.shiftRpm, fill = (me.rpm - (target - 1500)) / 1500, flash = me.rpm >= target - 80, lampR = u * 0.32;
  for (let i = 0; i < 5; i++) { const on = flash ? Math.floor(time * 16) % 2 === 0 : fill > i / 5, col = i < 2 ? '#34ff7a' : i < 4 ? '#ffe14d' : C.red; ctx.beginPath(); ctx.arc(x + lampR + i * (w - 2 * lampR) / 4, y + u * 0.5, lampR, 0, Math.PI * 2); ctx.fillStyle = on ? col : 'rgba(255,255,255,0.1)'; glow(ctx, on ? col : null, 10); ctx.fill(); glow(ctx, null, 0); }
  next(R.lamps);
  { const max = Math.ceil(sp.redline / 1000 + 1) * 1000, f = Math.min(1, me.rpm / max), redFrom = Math.min(1, sp.redline / max), bh = u * 0.6; ctx.fillStyle = 'rgba(255,43,69,0.35)'; ctx.fillRect(x + w * redFrom, y, w * (1 - redFrom), bh); bar(y, x, w, bh, f, me.limiter && Math.floor(time * 20) % 2 ? C.red : C.cyan); }
  next(R.rpmBar);
  // the gear (big), the speed and the rpm
  { const shiftLabel = me.shiftT > 0 ? (me.shiftMissed ? 'MISS' : '-') : String(me.gear), gearW = u * 2.4; line(shiftLabel, R.drive * 0.85, me.shiftMissed ? C.red : C.yel, u * 2, 'center', 1, x, gearW); line(`${Math.round(me.v * 3.6)} KM/H`, 1.1, C.white, font * 1.15, 'left', 1, x + gearW + 4, w - gearW - 4); line(`${Math.round(me.rpm)} RPM`, 2.1, C.cyan, font, 'left', 0.85, x + gearW + 4, w - gearW - 4); }
  next(R.drive);
  // the notes rows share one place: before the launch the keys to press next (the staging prompt), during the run the warnings that change what you do (wheelspin, a hot or slipping
  // clutch, front wheels up, the nitro and shift keys), after the finish how to stop. Each line is wrapped to the panel and the whole block never takes more than `notesRows` rows.
  { const notes: [string, string, number][] = [];
    if (!me.launched && !me.aborted) { if (!keys.auto) { const p = stagingPrompt(me, s, keys); if (p.title) notes.push([p.title, p.col, 1]); for (const [l, c, a] of p.lines) notes.push([l, c, a]); } }
    else if (me.finished && !me.stopped) { notes.push([`STOP IN ${Math.round(Math.max(0, SHUTDOWN.end - me.x))} M`, C.yel, 1], [`${keys.brake ?? 'BRAKE'}: BRAKE  ${keys.chute ?? 'CHUTE'}: CHUTE`, C.cyan, 1]); if (me.chute) notes.push(['CHUTE OUT', C.mag, 1]); }
    else if (me.launched && !me.finished) {
      if (me.spin || me.spinL || me.spinR) notes.push([me.spin ? 'WHEELSPIN' : me.spinR ? 'RIGHT REAR SLIPPING' : 'LEFT REAR SLIPPING', C.org, 0.6 + 0.4 * Math.sin(time * 20)]);
      const temp = Number.isFinite(me.clutchTemp) ? me.clutchTemp : CLUTCH.ambient; if (me.clutchLocked) notes.push(['CLUTCH LOCKED', C.org, 1]); else if (temp >= CLUTCH.fadeFrom) notes.push([temp >= CLUTCH.wearHotTemp ? 'CLUTCH BURNING' : 'CLUTCH HOT', temp >= CLUTCH.wearHotTemp ? C.red : C.org, 1]);
      if (me.lift > 0) notes.push(['FRONT UP', C.yel, 1]);
      if (!keys.auto && sp.nitroSecs > 0 && me.tune.nitroGear === 0 && !me.nitroOn && me.nitroLeft > 0) notes.push([`${keys.nitro}: NITRO`, C.vio, 0.85]);
      if (keys.manual && me.gear < me.tune.ratios.length && me.rpm >= me.tune.shiftRpm - 80) notes.push([`${keys.launch}: SHIFT`, C.red, 0.9]);
    }
    const cols = Math.max(12, Math.floor(w / (font * PANEL.charW))); let row = 0; for (const [str, col, alpha] of notes) for (const part of wrapNote(str, cols)) { if (row >= L.notes) break; line(part, row + 1, col, font, 'left', alpha); row++; } }
  next(L.notes);
  if (L.nitro) {
    const f = me.nitroLeft / sp.nitroSecs, col = me.nitroOn ? C.org : C.vio;
    line(`${me.nitroOn ? 'NITRO!' : 'NITRO'} ${Math.round(me.nitroGain * 100)}%`, 1, col); bar(y + u * 1.05, x, w, u * 0.55, f, col); next(R.nitro);
  }
  if (L.boost) {
    const limit = boostLimitOf(me.tune), boost = Math.max(0, Math.min(BOOST.maxLimit, me.boost)), col = limit > BOOST.safeLimit ? C.org : C.cyan, retard = Math.round((Number.isFinite(me.retard) ? me.retard : 0) * 100);
    line(`BOOST ${Math.round(boost * 100)}%${retard > 1 ? ` -${retard}%` : ''}`, 1, retard > 1 ? C.red : col); bar(y + u * 1.05, x, w, u * 0.55, boost / BOOST.maxLimit, col); next(R.boost);
  }
  // the two rear tires' temperatures (cyan cold, green in the window, orange too hot)
  if (L.tires) { const T = DRAG.tire, air = (s.weather ?? s.conditions).airC, gap = 6, bw = (w - gap) / 2; for (let k = 0; k < 2; k++) { const t = me.tires[k]!, temp = Number.isFinite(t.temp) ? t.temp : air, col = temp < T.windowLo ? C.cyan : temp <= T.windowHi ? '#34ff7a' : C.org, bx = x + k * (bw + gap); line(`${k === 0 ? 'L' : 'R'} ${Math.round(temp)}\u00b0`, 1, col, font, 'left', 1, bx, bw); bar(y + u * 1.05, bx, bw, u * 0.55, (temp - air) / Math.max(1, T.hot - air), col); } }
  if (L.tires) next(R.tires);
  if (L.lane) drawLane(ctx, x, y, w, R.lane * u, me, 0, u, font);
  ctx.restore();
  return box;
}

/** the names of the keys the HUD tells the player to press */
export interface DragKeyLabels { launch: string; nitro: string; manual: boolean; auto?: boolean; burnout?: string; gas?: string; brake?: string; chute?: string; deepStage?: string; clutch?: string; backUp?: string }
/** the Christmas tree from above, top middle: each lane's pre-stage and stage bulbs, the three ambers (dark until the tree is armed by final stage), the green, and the red for a red light */
export function drawTree(ctx: CanvasRenderingContext2D, W: number, s: DragHudState, S: number): void {
  const radius = 6 * S, gap = 15 * S, x0 = W / 2, y0 = 74 * S, lanes = s.runners.length, colX = (i: number): number => x0 + (i - (lanes - 1) / 2) * 26 * S;
  ctx.save(); ctx.fillStyle = 'rgba(5,1,15,0.72)'; ctx.fillRect(x0 - (lanes * 13 + 6) * S, y0 - 14 * S, (lanes * 26 + 12) * S, gap * 7 + 12 * S);
  const bulb = (x: number, row: number, on: boolean, col: string): void => { const y = y0 + row * gap; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = on ? col : 'rgba(255,255,255,0.1)'; glow(ctx, on ? col : null, 10); ctx.fill(); glow(ctx, null, 0); };
  s.runners.forEach((r, i) => {
    const x = colX(i); bulb(x, 0, r.preBulb && !r.launched, '#ffe14d'); bulb(x, 1, r.stageBulb && !r.launched, '#ffe14d');
    for (let a = 0; a < 3; a++) bulb(x, 2 + a, s.ambers > a && !s.green, '#ff8a1f');
    bulb(x, 5, s.green && !r.foul, '#34ff7a'); bulb(x, 6, r.foul, C.red);
  });
  ctx.restore();
}

/** what to press now (the stage's NAME is in the panel's stage line, so the title is only the launch key at the staged tree): a colour and the lines (distance to the beam, the keys) */
export function stagingPrompt(me: Runner, s: DragHudState, keys: DragKeyLabels): { title: string; col: string; lines: [string, string, number][] } {
  const label = stageLabel(me), lines: [string, string, number][] = [], toPre = me.x + STAGE.preStageRollout, toStage = me.x + DRAG.stageRollout;
  const k = (v: string | undefined, fallback: string): string => v ?? fallback;
  if (me.rolling) return { title: '', col: '#34ff7a', lines };
  if (label === 'STAGED' || label === 'DEEP STAGED') {
    const deepRow = !!keys.deepStage && !me.deepStage;
    if (deepRow) lines.push([`${keys.deepStage}: DEEP STAGE`, C.yel, 0.7]);
    if (keys.chute) lines.push([`${keys.chute}: ABORT`, C.red, 0.8]);
    return { title: s.green ? `${keys.launch}: ROLL OUT NOW` : `${keys.launch} ON GREEN`, col: s.green ? '#34ff7a' : C.yel, lines };
  }
  if (label === 'WATER BOX') { lines.push([`${k(keys.gas, 'GAS')}: ROLL IN`, C.cyan, 0.8], [`${k(keys.burnout, 'BURNOUT')} + ${k(keys.gas, 'GAS')}: BURNOUT`, C.cyan, 0.8]); return { title: me.wet > 0.05 ? 'WET SLICKS' : '', col: C.cyan, lines }; }
  if (label === 'BURNOUT') { lines.push([`${me.burnDistance.toFixed(0)} M${me.wet > 0.05 ? '  WET' : ''}`, C.org, 0.9], [`RELEASE ${k(keys.burnout, 'BURNOUT')}: RUN OUT`, C.cyan, 0.7]); return { title: '', col: C.org, lines }; }
  if (label === 'RUN OUT') { lines.push([`${k(keys.brake, 'BRAKE')}: STOP`, C.cyan, 0.8], [`THEN ${k(keys.backUp, 'BACK UP')}: BACK UP`, C.cyan, 0.8]); return { title: '', col: C.yel, lines }; }
  if (label === 'BACK UP') { lines.push([`${toPre.toFixed(2)} M TO PRE-STAGE`, toPre > 0 ? C.yel : C.org, 0.9], [`${k(keys.backUp, 'BACK UP')}: REVERSE  ${k(keys.brake, 'BRAKE')}: STOP`, C.cyan, 0.7]); return { title: '', col: C.yel, lines }; }
  if (label === 'OVER-STAGED') { lines.push([`BULB OUT: ${k(keys.backUp, 'BACK UP')} PAST THE BEAM`, C.red, 0.9]); return { title: '', col: C.red, lines }; }
  if (label === 'PRE-STAGE') { lines.push([`${toStage.toFixed(2)} M TO STAGE`, C.cyan, 0.8], [`TAP ${k(keys.gas, 'GAS')}: CREEP  ${k(keys.brake, 'BRAKE')}: STOP`, C.cyan, 0.8]); if (keys.deepStage) lines.push([`${keys.deepStage}: DEEP STAGE`, C.yel, 0.7]); return { title: '', col: C.yel, lines }; }
  return { title: '', col: C.white, lines };
}


/** everything drawn over the strip during a run: the tree (a graphic), the left panel with all the readouts, and the one centre alert (a crash) */
export function drawProgress(ctx: CanvasRenderingContext2D, W: number, H: number, s: DragHudState, mine: number, S: number, keys: DragKeyLabels): void {
  const me = (s.runners[mine] ?? s.runners[0]) as Runner;
  drawTree(ctx, W, s, S);
  drawRunPanel(ctx, W, H, s, mine, S, keys);
  if (me.crashed) { const size = Math.min(54 * S, (W - 24) / (11 * PANEL.charW)); text(ctx, 'You crashed', W / 2, H * 0.42, size, C.red, 'center', 0.6 + 0.4 * Math.sin(s.t * 20)); }
}


/** your lane from above, in the panel: the centre line (red) on one side, the wall on the other, and your car where it is across the lane, turned the way it is heading (the slide warning is written above it) */
export function drawLane(ctx: CanvasRenderingContext2D, x0: number, y: number, w: number, boxH: number, me: Runner, lane: number, u: number, font: number): void {
  const h = Math.max(8, boxH - u * 1.2), y0 = y + u * 1.1, S = u / 14, half = LANE.limit + 1.1, X = (v: number): number => x0 + w / 2 + (v / half) * (w / 2), centreRight = lane !== 0;
  ctx.save();
    ctx.lineWidth = Math.max(2, 3 * S); ctx.strokeStyle = C.red; glow(ctx, C.red, 8); ctx.beginPath(); const cxl = centreRight ? x0 + w : x0; ctx.moveTo(cxl, y0); ctx.lineTo(cxl, y0 + h); ctx.stroke();
  ctx.strokeStyle = C.cyan; glow(ctx, C.cyan, 8); ctx.beginPath(); const wx = centreRight ? x0 : x0 + w; ctx.moveTo(wx, y0); ctx.lineTo(wx, y0 + h); ctx.stroke(); glow(ctx, null, 0);
  ctx.strokeStyle = 'rgba(255,225,77,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x0 + w / 2, y0); ctx.lineTo(x0 + w / 2, y0 + h); ctx.stroke(); ctx.setLineDash([]);
  const grip = Number.isFinite(me.gripLeft) ? me.gripLeft : 1, drift = Number.isFinite(me.drift) ? me.drift : 0, slide = 1 - grip;
  if (slide > LANE_HUD.slideAt) text(ctx, `SLIDE ${Math.round(grip * 100)}% GRIP`, x0, y + u * 0.8, font, C.cyan);
  if (slide > LANE_HUD.slideAt && Math.abs(drift) > 1e-3) {
    ctx.save(); ctx.translate(X(me.y), y0 + h / 2); ctx.rotate((me.psi + drift) * LANE_HUD.turnGain); ctx.strokeStyle = C.cyan; ctx.lineWidth = 1.5 * S; glow(ctx, C.cyan, 6); ctx.strokeRect(-LANE_HUD.markerW / 2 * S, -LANE_HUD.markerH / 2 * S, LANE_HUD.markerW * S, LANE_HUD.markerH * S); glow(ctx, null, 0); ctx.restore();
  }
  const danger = Math.abs(me.y) > LANE.limit * 0.7, col = me.crossed ? C.red : danger ? C.org : C.yel;
  ctx.translate(X(me.y), y0 + h / 2); ctx.rotate(me.psi * LANE_HUD.turnGain); ctx.fillStyle = col; glow(ctx, col, 10); ctx.fillRect(-6 * S, -12 * S, 12 * S, 24 * S); glow(ctx, null, 0); ctx.fillStyle = '#05010f'; ctx.fillRect(-4 * S, -12 * S, 8 * S, 5 * S);
  ctx.restore();
}

