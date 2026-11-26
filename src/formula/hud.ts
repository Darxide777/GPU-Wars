// What is drawn over the track DURING a lap, kept minimal like Drag's HUD (src/drag/hud.ts): the LEFT PANEL (the state, the lap clock, the sector, the last split, nitro and, if asked for, the gap to the ghost), the three START LIGHTS
// at the top middle, and the GEAR BOX at the bottom right (gear, km/h and the shift lamps). Nothing else carries data: the reaction, every split, the top speed and the lap time are on the timeslip. The ghost car has no text.
// It only reads the view; drawing is all it does. Text is never under `HUD.minFont` px.
import { C } from '../sim/constants.ts';
import { LIGHTS } from './constants.ts';
import type { FormulaView } from './race.ts';

export const HUD = {
  /** the panel's margin and padding (px at scale 1), the row height range (px) and the share of a row that is the text */ margin: 8, pad: 6, minRow: 12, maxRow: 18, fontShare: 0.84, minFont: 10,
  /** the widest line the panel is built for (characters), and the most of a narrow window it may take */ chars: 18, charWidth: 0.6, widthShare: 0.5,
  /** the lights: bulb radius (px at scale 1) and the gap between bulbs */ bulb: 11, bulbGap: 8,
  /** the shift lamps: how many, and the share of the shift light's revs at which the first one comes on */ lamps: 5, lampsFrom: 0.6,
} as const;

/** options for the panel: show the gap to the ghost (off by default: Drag keeps ghost words off the race screen) */
export interface HudOptions { showDelta?: boolean }
const glow = (ctx: CanvasRenderingContext2D, col: string | null, b: number): void => { ctx.shadowColor = col ?? 'transparent'; ctx.shadowBlur = col ? b : 0; };
const text = (ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, col: string, align: CanvasTextAlign = 'left'): void => { ctx.font = `bold ${Math.round(size)}px monospace`; ctx.textAlign = align; glow(ctx, col, 6); ctx.fillStyle = col; ctx.fillText(s, x, y); glow(ctx, null, 0); };
/** a time as m:ss.mmm (or s.mmm under a minute) */
export const clockText = (t: number): string => { const v = Math.max(0, t), m = Math.floor(v / 60), s = v - m * 60; return m ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3); };
/** a gap to the ghost: +0.42 (behind) or -0.42 (ahead) */
export const gapText = (d: number): string => `${d >= 0 ? '+' : '-'}${Math.abs(d).toFixed(2)}`;

/** the rows of the left panel for a view: [text, colour] pairs (the first is the state) */
export function panelRows(view: FormulaView, options: HudOptions = {}): [string, string][] {
  const rows: [string, string][] = [];
  if (view.jumpStart) rows.push(['JUMP START', C.red]);
  else if (view.phase === 'finished') rows.push(['FINISH', C.yel]);
  else if (view.phase === 'timeout') rows.push(['TIME OUT', C.red]);
  else if (!view.green) rows.push([view.lights >= LIGHTS.count ? 'READY' : 'LIGHTS', C.cyan]);
  else rows.push([view.lapClock > 0 ? 'LAP 1/1' : 'GO', '#34ff7a']);
  rows.push([clockText(view.lapClock), '#ffffff']);
  rows.push([`SECTOR ${view.sector}/${view.sectors}`, C.cyan]);
  rows.push([view.lastSplit === null ? 'SPLIT -' : `SPLIT ${clockText(view.lastSplit)}`, C.vio]);
  if (view.car.nitroLeft > 0 || view.car.nitroT > 0) rows.push([`NITRO ${view.car.nitroLeft}${view.car.nitroT > 0 ? ' ON' : ''}`, C.org]);
  if (options.showDelta && view.ghostDelta !== null) rows.push([`GHOST ${gapText(view.ghostDelta)}`, view.ghostDelta <= 0 ? '#34ff7a' : C.red]);
  return rows;
}
/** the panel's box and row height for this window */
export function panelBox(W: number, H: number, S: number, rows: number): { x: number; y: number; w: number; h: number; row: number } {
  const row = Math.max(HUD.minRow, Math.min(HUD.maxRow * S, H / 40)), w = Math.min(W * HUD.widthShare, HUD.chars * HUD.charWidth * row * HUD.fontShare + 2 * HUD.pad);
  return { x: HUD.margin, y: HUD.margin, w, h: rows * row + 2 * HUD.pad, row };
}
/** the left panel */
export function drawLapPanel(ctx: CanvasRenderingContext2D, W: number, H: number, S: number, view: FormulaView, options: HudOptions = {}): { x: number; y: number; w: number; h: number } {
  const rows = panelRows(view, options), box = panelBox(W, H, S, rows.length), size = Math.max(HUD.minFont, box.row * HUD.fontShare);
  ctx.fillStyle = 'rgba(5,1,15,0.55)'; ctx.fillRect(box.x, box.y, box.w, box.h);
  rows.forEach(([s, col], i) => text(ctx, s, box.x + HUD.pad, box.y + HUD.pad + (i + 0.8) * box.row, i === 1 ? size * 1.15 : size, col));
  return { x: box.x, y: box.y, w: box.w, h: box.h };
}
/** the three start lights at the top middle: a bulb lit red for each light on, dark when out, green for a moment after the lights go out */
export function drawLights(ctx: CanvasRenderingContext2D, W: number, S: number, view: FormulaView): void {
  if (view.phase !== 'lights' && !(view.green && view.raceTime < 0.8)) return;
  const r = HUD.bulb * S, gap = HUD.bulbGap * S, total = LIGHTS.count * 2 * r + (LIGHTS.count - 1) * gap, x0 = W / 2 - total / 2 + r, y = HUD.margin + r + 4 * S;
  ctx.fillStyle = 'rgba(5,1,15,0.7)'; ctx.fillRect(x0 - r - 6 * S, y - r - 6 * S, total + 12 * S, 2 * r + 12 * S);
  for (let i = 0; i < LIGHTS.count; i++) {
    const lit = view.green ? true : i < view.lights, col = view.green ? '#34ff7a' : C.red;
    ctx.beginPath(); ctx.arc(x0 + i * (2 * r + gap), y, r, 0, Math.PI * 2); ctx.fillStyle = lit ? col : '#1a0b33'; glow(ctx, lit ? col : null, 14); ctx.fill(); glow(ctx, null, 0);
  }
}
/** the gear box at the bottom right: the gear, the speed and the shift lamps (they fill as the revs climb and all light at the shift light) */
export function drawGearBox(ctx: CanvasRenderingContext2D, W: number, H: number, S: number, view: FormulaView, time: number): { x: number; y: number; w: number; h: number } {
  const car = view.car, w = 120 * S, h = 84 * S, x = W - w - HUD.margin, y = H - h - HUD.margin, lampW = (w - 2 * HUD.pad) / HUD.lamps;
  ctx.fillStyle = 'rgba(5,1,15,0.55)'; ctx.fillRect(x, y, w, h);
  const filled = Math.max(0, Math.min(HUD.lamps, Math.ceil(((car.rev - HUD.lampsFrom) / Math.max(0.05, 1 - HUD.lampsFrom)) * HUD.lamps))), blink = car.shiftLight && Math.floor(time * 10) % 2 === 0;
  for (let i = 0; i < HUD.lamps; i++) { const on = car.shiftLight ? blink : i < filled, col = i < 2 ? '#34ff7a' : i < 4 ? C.yel : C.red; ctx.fillStyle = on ? col : '#1a0b33'; glow(ctx, on ? col : null, 8); ctx.fillRect(x + HUD.pad + i * lampW + 1, y + HUD.pad, lampW - 3, 8 * S); glow(ctx, null, 0); }
  text(ctx, String(car.gear), x + HUD.pad, y + h - 14 * S, Math.max(18, 44 * S), car.shiftLight ? C.red : '#ffffff');
  text(ctx, `${car.kmh}`, x + w - HUD.pad, y + h - 28 * S, Math.max(HUD.minFont, 20 * S), C.cyan, 'right');
  text(ctx, car.manual ? 'KM/H' : 'KM/H A', x + w - HUD.pad, y + h - 12 * S, Math.max(HUD.minFont, 11 * S), C.vio, 'right');
  return { x, y, w, h };
}
