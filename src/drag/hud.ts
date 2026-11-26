// What is drawn over the drag strip DURING a run. The left panel (`drawRunPanel`) holds the stage, reaction time and run timer, the warnings (wheelspin, clutch, front wheels up), nitro, boost,
// tire temperatures and your place in the lane. The round tachometer (rpm, gear, km/h and the shift lamps) is at the bottom right (`drawTach`, placed clear of the touch buttons). ONE short
// instruction line (`guidePrompt`, drawn by `drawPrompt` in the top row beside the panel) names the next action of the staging sequence, with the player's own key or touch button names.
// Nothing else carries data: conditions, pressures, fuel, engine heat, weights, splits, ET and trap speed are on the timeslip, and the ghost car has no text at all. It only reads the race; drawing is all it does.
import { C } from '../sim/constants.ts';
import { DRAG, LANE, SHUTDOWN, STAGE, boostLimitOf, stageLabel } from './physics.ts';
import { BOOST, CLUTCH } from './tune.ts';
import { CAR_Y_SHARE, LANE_M, carNoseY } from './topdown.ts';
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
const PANEL = { margin: 8, pad: 6, gap: 0.3, minUnit: 10, maxUnit: 16, fontShare: 0.84, chars: 22, charW: 0.6, widthShare: 0.5, notesRows: 5, rows: { stage: 1.4, timing: 1, nitro: 1.7, boost: 1.7, tires: 1.7, lane: 2.8 } } as const;
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
export const PHONE_HUD = { minFont: 10, hiddenWithTouch: ['lane'], dropOrder: ['lane', 'notes2', 'tires', 'boost', 'nitro', 'notes1'], touchGap: 4,
  /** the one instruction line: its text px at S = 1 (never under `minFont`), the backing's padding, the gap to the panel, and the room kept at the top right for the fullscreen button */
  prompt: { font: 15, pad: 4, gap: 8, fullscreenRoom: 54 },
  /** the tachometer: shrinks from 1 down to `minScale` (steps of `step`) and is moved left or up only as far as needed to stay clear (every px moved costs 1, losing the whole size costs `shrinkCost` px, the cheapest place wins) of the touch buttons, the panel, the tree and the cars; `touchGap` px from a button, `cell` px between tried places */
  tach: { minScale: 0.55, step: 0.05, shrinkCost: 300, touchGap: 6, cell: 8, numbersFromK: 0.65 } } as const;
/** the names of the keys the HUD tells the player to press; `avoid` is the touch buttons on screen (empty when touch is off): the panel stays clear of every one */
/** `touch` says the names are the on-screen buttons' (GAS, BRAKE, BURN, BACK UP, GO, DEEP) rather than keys */
export interface DragKeyLabels { launch: string; nitro: string; manual: boolean; auto?: boolean; burnout?: string; gas?: string; brake?: string; chute?: string; deepStage?: string; clutch?: string; backUp?: string; touch?: boolean; avoid?: TouchSpot[] }
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
  const R = PANEL.rows, blocks = [R.stage, R.timing, l.notes, l.nitro ? R.nitro : 0, l.boost ? R.boost : 0, l.tires ? R.tires : 0, l.lane ? R.lane : 0].filter(v => v > 0);
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
  const me = (s.runners[mine] ?? s.runners[0]) as Runner, box = runPanelBox(W, H, S, me, keys.avoid), L = box.layout, u = box.unit, font = u * PANEL.fontShare, x = box.x + PANEL.pad, w = box.w - 2 * PANEL.pad, R = PANEL.rows, time = s.t, sp = me.spec;
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
  // the notes rows: during the run the warnings that change what you do (wheelspin, a hot or slipping
  // clutch, front wheels up, the nitro and shift keys), after the finish how to stop. Each line is wrapped to the panel and the whole block never takes more than `notesRows` rows.
  { const notes: [string, string, number][] = [];
    if (me.launched && !me.aborted && me.finished && !me.stopped) { notes.push([`STOP IN ${Math.round(Math.max(0, SHUTDOWN.end - me.x))} M`, C.yel, 1], [`${keys.brake ?? 'BRAKE'}: BRAKE  ${keys.chute ?? 'CHUTE'}: CHUTE`, C.cyan, 1]); if (me.chute) notes.push(['CHUTE OUT', C.mag, 1]); }
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

/** a place on the screen that other drawing keeps clear of */
export interface Rect { x: number; y: number; w: number; h: number }
const overlap = (a: Rect, b: Rect, gap = 0): boolean => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** the one instruction line: its candidate texts (the longest that fits is drawn), its colour and how bold */
export interface GuidePrompt { variants: string[]; col: string; alpha: number }
/**
 * The ONE line telling the player the next action of the staging sequence (null when there is nothing to say: after the launch, at a foul or abort, at the green). It reads the same stage
 * the physics runs (`stagingStep`): the gas rolls the car, gas + brake (or the BURN button) is the burnout, the back up key reverses, the beams are at `STAGE.preStageRollout` and
 * `DRAG.stageRollout` behind the final beam. Key names come from `keys` (the player's own bindings, or the touch buttons' names). Each phase lists a long text and shorter ones for a narrow screen.
 * The autopilot is driving: one quiet word instead of keys.
 */
export function guidePrompt(me: Runner, s: DragHudState, keys: DragKeyLabels): GuidePrompt | null {
  if (keys.auto) return me.finished || me.crashed ? null : { variants: ['AUTOPILOT'], col: C.cyan, alpha: 0.55 };
  if (me.launched || me.aborted || me.foul || me.crashed || me.rolling) return null;
  const k = (v: string | undefined, fallback: string): string => v ?? fallback;
  const gas = k(keys.gas, 'GAS'), brake = k(keys.brake, 'BRAKE'), backUp = k(keys.backUp, 'BACK UP'), burn = k(keys.burnout, 'BURNOUT');
  // the burnout is gas + brake (on a phone, gas + the BURN button), so those are the pair to hold and the one to let go
  const hold = keys.touch ? burn : brake, burnText = [`HOLD ${gas} + ${hold}: BURNOUT`, `${gas} + ${hold}: BURNOUT`];
  const say = (variants: string[], col: string = C.cyan, alpha = 0.95): GuidePrompt => ({ variants, col, alpha });
  const toPre = me.x + STAGE.preStageRollout, slowest = STAGE.stopSpeed, brakeDistance = me.v * me.v / (2 * STAGE.brakeDecel);
  const backUpText = (): GuidePrompt => say(toPre >= 1 ? [`BACK UP (${backUp}) ${Math.round(toPre)} M`, `BACK UP (${backUp})`] : [`BACK UP (${backUp})`]);
  const creepText = (): GuidePrompt => say([`TAP ${gas}: CREEP TO PRE-STAGE`, 'CREEP TO PRE-STAGE']);
  switch (me.stage) {
    case 'waterBoxApproach': return me.x < STAGE.waterBoxStart ? say([`HOLD ${gas}: ROLL INTO THE WATER BOX`, 'ROLL INTO THE WATER BOX', 'ROLL INTO WATER BOX']) : say(burnText);
    case 'burnout': {
      const t = me.tires.map(w => w.temp).filter(Number.isFinite), warm = t.length > 0 && t.reduce((a, b) => a + b, 0) / t.length >= DRAG.tire.windowLo;
      return warm ? say([`RELEASE ${hold}: TIRES HOT`, 'RELEASE: TIRES HOT'], C.org) : say(burnText);
    }
    case 'runOut':
      if (me.v > slowest) return me.x + brakeDistance < STAGE.runOutPastTree ? say(['LET OFF: STOP PAST THE TREE', 'STOP PAST THE TREE']) : say([`${brake}: STOP`]);
      return me.x < -STAGE.preStageRollout ? creepText() : backUpText();
    case 'backup':
      if (me.v < -slowest) return me.x - brakeDistance <= -STAGE.preStageRollout + 0.15 ? say([`RELEASE ${backUp}, BRAKE: STOP`, `RELEASE ${backUp}, STOP`], C.yel) : backUpText();
      return me.x < -STAGE.preStageRollout ? creepText() : backUpText();
    case 'preStage':
      // over-staged: the stage bulb went out because the nose rolled past the stage beam, so back out past it
      return me.overstaged ? say([`BACK UP (${backUp}) TO RE-STAGE`, `BACK UP (${backUp})`], C.red) : say([`TAP ${gas}: CREEP TO STAGE`, 'CREEP TO STAGE'], C.yel);
    case 'staged': case 'deepStaged': {
      if (s.green) return null;
      // (the panel's stage line already says STAGED or DEEP STAGED, so the line only says what to do)
      // staged or deep staged: the only thing left to do is wait, so the prompt says just that (the launch and deep-stage keys are in OPTIONS)
      if (me.stage === 'deepStaged') return say(['WAIT FOR GREEN'], C.yel);
      return say(['WAIT FOR GREEN'], C.yel);
    }
    default: return null;
  }
}

/** where the instruction line goes: the top row, left-aligned just right of the left panel (and the MENU button), never under the fullscreen button; the text is the longest candidate that fits at `minFont` or more */
/** the instruction line's backing height (also the top row the gauge never uses) */
const promptHeight = (S: number): number => Math.max(PHONE_HUD.minFont, PHONE_HUD.prompt.font * S) * 1.3 + 2 * PHONE_HUD.prompt.pad;
export interface PromptBox extends Rect { text: string; size: number; col: string; alpha: number }
export function promptBox(W: number, H: number, S: number, prompt: GuidePrompt, panel: Rect | null, avoid: TouchSpot[] = []): PromptBox {
  const P = PHONE_HUD.prompt, size = Math.max(PHONE_HUD.minFont, P.font * S), h = promptHeight(S), y = PANEL.margin, row: Rect = { x: 0, y, w: W, h };
  let left: number = PANEL.margin; for (const r of [panel, ...avoid.filter(t => t.id === 'menu')]) if (r && overlap(row, r)) left = Math.max(left, r.x + r.w + P.gap);
  const room = W - PANEL.margin - P.fullscreenRoom - left - 2 * P.pad;
  let text = prompt.variants[prompt.variants.length - 1] as string, fit = size;
  for (const v of prompt.variants) { const f = Math.min(size, room / (v.length * PANEL.charW)); if (f >= PHONE_HUD.minFont - 1e-9) { text = v; fit = f; break; } }
  fit = Math.max(PHONE_HUD.minFont, Math.floor(fit));      // (whole px: that is the size `text` draws)
  return { x: left, y, w: text.length * fit * PANEL.charW + 2 * P.pad, h, text, size: fit, col: prompt.col, alpha: prompt.alpha };
}
/** draws the instruction line (a see-through backing and one line of text) */
export function drawPrompt(ctx: CanvasRenderingContext2D, box: PromptBox): void {
  ctx.save(); ctx.fillStyle = 'rgba(5,1,15,0.72)'; ctx.fillRect(box.x, box.y, box.w, box.h);
  text(ctx, box.text, box.x + PHONE_HUD.prompt.pad, box.y + box.h / 2 + box.size * 0.33, box.size, box.col, 'left', box.alpha); ctx.restore();
}

/** the tachometer's look (px at S = 1, as it was before the left panel): the dial's radius, its distance from the screen edges, and where the shift lamps and the numbers sit */
const TACH_HUD = { radius: 92, edge: 20, ring: 14, shiftLift: 30, shiftRadius: 7, rpmRow: -36, gearRow: 14, speedRow: 44, numberFont: 11, rpmFont: 12, speedFont: 16, gearFont: 46 } as const;
/** the tachometer's place: its dial centre and radius, the whole box it takes (dial, ring and shift lamps) and the scale it was shrunk to */
export interface TachBox { cx: number; cy: number; R: number; k: number; scale: number; box: Rect }
function tachAt(S: number, scale: number, right: number, bottom: number): TachBox {
  const k = S * scale, R = TACH_HUD.radius * k, ring = TACH_HUD.ring * k, up = R + (TACH_HUD.shiftLift + TACH_HUD.shiftRadius) * k, w = 2 * (R + ring), h = up + R + ring;
  return { cx: right - R - ring, cy: bottom - R - ring, R, k, scale, box: { x: right - w, y: bottom - h, w, h } };
}
/** the boxes the round gauge keeps clear of when it is placed: where the cars are (both lanes, from the nose to the tail at the largest scale), found from the screen size alone so the gauge never jumps */
export function carBand(W: number, H: number): Rect {
  const scale = H / 28, yBase = H * CAR_Y_SHARE, half = (LANE_M + 1.3) * scale;
  return { x: W / 2 - half, y: yBase - 2.8 * scale, w: 2 * half, h: 5.7 * scale };
}
/** the tree's backing box */
export const treeRect = (W: number, S: number, lanes: number): Rect => ({ x: W / 2 - (lanes * 13 + 6) * S, y: 60 * S, w: (lanes * 26 + 12) * S, h: 15 * S * 7 + 12 * S });
/** the boxes the gauge keeps clear of, for the tests and for `drawProgress`: `hard` always (panel, tree, cars, the instruction line, the touch buttons with a gap), `soft` (the road, with touch buttons on screen) when possible */
export function tachObstacles(W: number, H: number, S: number, lanes: number, panel: Rect, avoid: TouchSpot[]): { hard: Rect[]; soft: Rect[] } {
  const gap = PHONE_HUD.tach.touchGap, road = (2 * LANE_M + 0.5) * H / 28;
  return { hard: [panel, treeRect(W, S, lanes), carBand(W, H), { x: 0, y: 0, w: W, h: PANEL.margin + promptHeight(S) }, ...avoid.map(t => ({ x: t.x - gap, y: t.y - gap, w: t.w + 2 * gap, h: t.h + 2 * gap }))], soft: avoid.length ? [{ x: W / 2 - road, y: 0, w: 2 * road, h: H }] : [] };
}
let tachCache: { key: string; at: TachBox | null } = { key: '', at: null };
/**
 * Where the tachometer goes: the bottom right, full size (92 px radius at S = 1). When something is there (a touch button, the panel on a short window, the cars on a narrow one) it shrinks
 * (down to `PHONE_HUD.tach.minScale`) and is moved left or up the least that clears every box in `obstacles`. Null only when nothing fits even at the smallest scale.
 */
export function tachPlacement(W: number, H: number, S: number, hard: Rect[], soft: Rect[] = []): TachBox | null {
  const T = PHONE_HUD.tach, rectKey = (list: Rect[]): string => list.map(o => `${Math.round(o.x)},${Math.round(o.y)},${Math.round(o.w)},${Math.round(o.h)}`).join(';'), key = `${W}|${H}|${S}|${rectKey(hard)}|${rectKey(soft)}`;
  if (tachCache.key === key) return tachCache.at;
  const right = W - TACH_HUD.edge * S, bottom = H - TACH_HUD.edge * S;
  let found: TachBox | null = null;
  // the soft boxes are kept clear when there is a place that does (the road, on a phone); if there is none the gauge may cover them
  for (const obstacles of soft.length ? [[...hard, ...soft], hard] : [hard]) {
    // the best place is the one that costs least: px moved from the corner (left plus up) and `shrinkCost` px for losing the whole size
    let best = Infinity;
    for (let scale = 1; scale >= T.minScale - 1e-9; scale -= T.step) {
      const base = (1 - scale) * T.shrinkCost;
      for (let dy = 0; base + dy < best && dy <= H; dy += T.cell) for (let dx = 0; base + dx + dy < best && dx <= W; dx += T.cell) {
        const at = tachAt(S, scale, right - dx, bottom - dy), b = at.box;
        if (b.x >= PANEL.margin && b.y >= PANEL.margin && !obstacles.some(o => overlap(b, o, 0))) { best = base + dx + dy; found = at; break; }
      }
    }
    if (found) break;
  }
  tachCache = { key, at: found }; return found;
}
/** the round tachometer: rpm needle arc with the redline, the dial numbers, the five shift lamps above it, and in the middle the rpm, the gear and km/h. Text is never under the minimum font. */
export function drawTach(ctx: CanvasRenderingContext2D, at: TachBox, me: Runner, time: number): void {
  const sp = me.spec, { cx, cy, R, k } = at, a0 = Math.PI * 0.8, a1 = Math.PI * 2.2, max = Math.ceil(sp.redline / 1000 + 1) * 1000, ang = (rpm: number): number => a0 + (a1 - a0) * Math.min(1, rpm / max), size = (v: number): number => Math.max(PHONE_HUD.minFont, v * k);
  ctx.save(); ctx.fillStyle = 'rgba(5,1,15,0.72)'; ctx.beginPath(); ctx.arc(cx, cy, R + TACH_HUD.ring * k, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 10 * k; ctx.strokeStyle = 'rgba(33,230,255,0.18)'; ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke();
  ctx.strokeStyle = C.red; glow(ctx, C.red, 10); ctx.beginPath(); ctx.arc(cx, cy, R, ang(sp.redline), a1); ctx.stroke(); glow(ctx, null, 0);
  ctx.strokeStyle = me.limiter && Math.floor(time * 20) % 2 ? C.red : C.cyan; glow(ctx, C.cyan, 12); ctx.beginPath(); ctx.arc(cx, cy, R, a0, ang(me.rpm)); ctx.stroke(); glow(ctx, null, 0);
  // (the dial's numbers need room: a small dial leaves them out rather than draw them under the minimum size or over the middle readouts)
  if (k >= PHONE_HUD.tach.numbersFromK) for (let m = 0; m <= max; m += 1000) { const a = ang(m), x = cx + Math.cos(a) * (R - 22 * k), y = cy + Math.sin(a) * (R - 22 * k); text(ctx, String(m / 1000), x, y + 4 * k, size(TACH_HUD.numberFont), m >= sp.redline ? C.red : C.white, 'center', 0.8); }
  // the shift light: five lamps that fill as you near the shift point, all flashing at it
  const target = me.tune.shiftRpm, fill = (me.rpm - (target - 1500)) / 1500, flash = me.rpm >= target - 80;
  for (let i = 0; i < 5; i++) { const on = flash ? Math.floor(time * 16) % 2 === 0 : fill > i / 5, col = i < 2 ? '#34ff7a' : i < 4 ? '#ffe14d' : C.red, x = cx - 44 * k + i * 22 * k, y = cy - R - TACH_HUD.shiftLift * k; ctx.beginPath(); ctx.arc(x, y, TACH_HUD.shiftRadius * k, 0, Math.PI * 2); ctx.fillStyle = on ? col : 'rgba(255,255,255,0.1)'; glow(ctx, on ? col : null, 12); ctx.fill(); glow(ctx, null, 0); }
  const shiftLabel = me.shiftT > 0 ? (me.shiftMissed ? 'MISS' : '-') : String(me.gear);
  text(ctx, shiftLabel, cx, cy + TACH_HUD.gearRow * k, size(TACH_HUD.gearFont), me.shiftMissed ? C.red : C.yel, 'center'); text(ctx, `${Math.round(me.v * 3.6)} KM/H`, cx, cy + TACH_HUD.speedRow * k + (size(TACH_HUD.speedFont) - TACH_HUD.speedFont * k), size(TACH_HUD.speedFont), C.white, 'center');
  text(ctx, `${Math.round(me.rpm)} RPM`, cx, cy + TACH_HUD.rpmRow * k, size(TACH_HUD.rpmFont), C.cyan, 'center', 0.8);
  ctx.restore();
}

/** everything drawn over the strip during a run: the tree (a graphic), the left panel with all the readouts, and the one centre alert (a crash) */
export function drawProgress(ctx: CanvasRenderingContext2D, W: number, H: number, s: DragHudState, mine: number, S: number, keys: DragKeyLabels): void {
  const me = (s.runners[mine] ?? s.runners[0]) as Runner, avoid = keys.avoid ?? [];
  drawTree(ctx, W, s, S);
  const panel = drawRunPanel(ctx, W, H, s, mine, S, keys), guide = guidePrompt(me, s, keys), line = guide ? promptBox(W, H, S, guide, panel, avoid) : null;
  const o = tachObstacles(W, H, S, s.runners.length, panel, avoid), tach = tachPlacement(W, H, S, o.hard, o.soft);
  if (tach) drawTach(ctx, tach, me, s.t);
  if (line) drawPrompt(ctx, line);
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

