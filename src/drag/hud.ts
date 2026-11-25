// What is drawn over the drag strip: a tachometer with a shift light and the limiter, the gear and speed, the nitro left,
// both cars' progress down the quarter mile, your reaction time and, at the end, your elapsed time and trap speed. It only reads the race; drawing is all it does.
import { C } from '../sim/constants.ts';
import { DRAG, LANE, SHUTDOWN, STAGE, SUSP, boostLimitOf, conditionsText, fuelShare, stageLabel, weatherText } from './physics.ts';
import { BOOST, CLUTCH } from './tune.ts';
import type { DragConditions, DragStrip, Runner } from './types.ts';

export interface DragHudState { t: number; greenAt: number; /** the tree is armed once every live car is in final stage (missing on old states: counts as armed) */ armed?: boolean; ambers: number; green: boolean; phase: string; conditions: DragConditions; weather?: DragConditions; strip?: DragStrip; runners: Runner[] }
const glow = (ctx: CanvasRenderingContext2D, col: string | null, b: number): void => { ctx.shadowColor = col ?? 'transparent'; ctx.shadowBlur = col ? b : 0; };
const text = (ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, col: string, align: CanvasTextAlign = 'left', a = 1): void => { ctx.globalAlpha = a; ctx.font = `bold ${Math.round(size)}px monospace`; ctx.textAlign = align; glow(ctx, col, 8); ctx.fillStyle = col; ctx.fillText(s, x, y); glow(ctx, null, 0); ctx.globalAlpha = 1; };
const ordinalGear = (g: number): string => String(g);
const clamp01 = (v: number): number => Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
const wrapConditions = (s: string, maxChars: number): string[] => {
  const lines: string[] = [];
  let rest = s;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(' ', maxChars);
    if (cut <= 0) cut = maxChars;
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut + 1);
  }
  lines.push(rest);
  return lines;
};
const PITCH_HUD = { row: 62, barShare: 0.5, barH: 7, pad: 2, gap: 10, font: 12, deg: 180, alpha: 0.85 } as const;
/** the lane marker: outline where the wheel asks the nose to point when the slicks run out of grip, filled where it is heading */
const LANE_HUD = { slideAt: 0.15, font: 10, markerW: 16, markerH: 28, turnGain: 6 } as const;
const TACH_HUD = { radius: 92, right: 34, bottom: 20, panelInset: 8, panelPad: 4, labelGap: 5, rowGap: 2, nitroGap: 90, shiftLift: 30, shiftRadius: 7, rpmRow: -36, gearRow: 14, speedRow: 44, spinRow: 66 } as const;
const NITRO_HUD = { barH: 9, font: 12 } as const;
const CLUTCH_HUD = { barH: 6, barGap: 2, pad: 1, font: 12, conditionCol: C.cyan } as const;
const BOOST_HUD = { row: 84, barShare: 0.5, barH: 7, pad: 2, gap: 10, font: 12, alpha: 0.85 } as const;
const TIRE_HUD = { gap: 4, barH: 9, pad: 2, font: 12, wearRow: 106, wearFont: 12, wearAlpha: 0.85 } as const;
const STOP_HUD = { firstRow: 128, gap: 16, font: 12, alpha: 0.85 } as const;
const FUEL_HUD = { low: 0.25 } as const;
const CONDITIONS_HUD = { row: 44, lineGap: 16, charW: 0.6, minChars: 12 } as const;

/** the tachometer, gear, speed and nitro, bottom right */
export function drawTach(ctx: CanvasRenderingContext2D, W: number, H: number, me: Runner, S: number, time: number, cond: DragConditions): void {
  const sp = me.spec, R = TACH_HUD.radius * S, cx = W - R - TACH_HUD.right * S, a0 = Math.PI * 0.8, a1 = Math.PI * 2.2, max = Math.ceil(sp.redline / 1000 + 1) * 1000, ang = (rpm: number): number => a0 + (a1 - a0) * Math.min(1, rpm / max);
  const bottom = H - TACH_HUD.bottom * S, clutchConditionY = bottom - CLUTCH_HUD.barH * S, clutchHeatY = clutchConditionY - (CLUTCH_HUD.barH + CLUTCH_HUD.barGap) * S;
  const tireY = clutchHeatY - (CLUTCH_HUD.font + TACH_HUD.labelGap + TACH_HUD.rowGap + TIRE_HUD.barH) * S, nitroY = tireY - (TIRE_HUD.font + TACH_HUD.labelGap + TACH_HUD.rowGap + NITRO_HUD.barH) * S, cy = nitroY - TACH_HUD.nitroGap * S;
  const panelTop = nitroY - (NITRO_HUD.font + TACH_HUD.labelGap + TACH_HUD.panelPad) * S, panelBottom = bottom + TACH_HUD.panelPad * S;
  ctx.save(); ctx.fillStyle = 'rgba(5,1,15,0.72)'; ctx.fillRect(cx - R - TACH_HUD.panelInset * S, panelTop, R * 2 + TACH_HUD.panelInset * 2 * S, panelBottom - panelTop);
  ctx.beginPath(); ctx.arc(cx, cy, R + 14 * S, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 10 * S; ctx.strokeStyle = 'rgba(33,230,255,0.18)'; ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke();
  ctx.strokeStyle = C.red; glow(ctx, C.red, 10); ctx.beginPath(); ctx.arc(cx, cy, R, ang(sp.redline), a1); ctx.stroke(); glow(ctx, null, 0);
  ctx.strokeStyle = me.limiter && Math.floor(time * 20) % 2 ? C.red : C.cyan; glow(ctx, C.cyan, 12); ctx.beginPath(); ctx.arc(cx, cy, R, a0, ang(me.rpm)); ctx.stroke(); glow(ctx, null, 0);
  for (let k = 0; k <= max; k += 1000) { const a = ang(k), x = cx + Math.cos(a) * (R - 22 * S), y = cy + Math.sin(a) * (R - 22 * S); text(ctx, String(k / 1000), x, y + 4 * S, 11 * S, k >= sp.redline ? C.red : C.white, 'center', 0.8); }
  // the shift light: five lamps that fill as you near the shift point, all flashing at it
  const target = me.tune.shiftRpm, fill = (me.rpm - (target - 1500)) / 1500, flash = me.rpm >= target - 80;
  for (let i = 0; i < 5; i++) { const on = flash ? Math.floor(time * 16) % 2 === 0 : fill > i / 5, col = i < 2 ? '#34ff7a' : i < 4 ? '#ffe14d' : C.red, x = cx - 44 * S + i * 22 * S, y = cy - R - TACH_HUD.shiftLift * S; ctx.beginPath(); ctx.arc(x, y, TACH_HUD.shiftRadius * S, 0, Math.PI * 2); ctx.fillStyle = on ? col : 'rgba(255,255,255,0.1)'; glow(ctx, on ? col : null, 12); ctx.fill(); glow(ctx, null, 0); }
  const shiftLabel = me.shiftT > 0 ? (me.shiftMissed ? 'MISS' : '-') : ordinalGear(me.gear);
  text(ctx, shiftLabel, cx, cy + TACH_HUD.gearRow * S, 46 * S, me.shiftMissed ? C.red : C.yel, 'center'); text(ctx, `${Math.round(me.v * 3.6)} KM/H`, cx, cy + TACH_HUD.speedRow * S, 16 * S, C.white, 'center');
  text(ctx, `${Math.round(me.rpm)} RPM`, cx, cy + TACH_HUD.rpmRow * S, 12 * S, C.cyan, 'center', 0.8);
  if (me.spin || me.spinL || me.spinR) text(ctx, me.spin ? 'WHEELSPIN' : me.spinR ? 'RIGHT REAR SLIPPING' : 'LEFT REAR SLIPPING', cx, cy + TACH_HUD.spinRow * S, 14 * S, C.org, 'center', 0.6 + 0.4 * Math.sin(time * 20));
  if (sp.nitroSecs > 0) { const f = me.nitroLeft / sp.nitroSecs, x = cx - R, y = nitroY, label = `${me.nitroOn ? 'NITRO!' : 'NITRO'} ${Math.round(me.nitroGain * 100)}% ${Math.round(me.nitroPressure * 100)}% ${Math.round(me.nitroTemp)}C`; ctx.strokeStyle = C.vio; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, R * 2, NITRO_HUD.barH * S); ctx.fillStyle = me.nitroOn ? C.org : C.vio; ctx.fillRect(x + 2, y + 2, (R * 2 - 4) * f, NITRO_HUD.barH * S - 4); text(ctx, label, x, y - TACH_HUD.labelGap * S, NITRO_HUD.font * S, me.nitroOn ? C.org : C.vio); }
  { const K = TIRE_HUD, T = DRAG.tire, air = cond.airC, x = cx - R, bw = (R * 2 - K.gap * S) / 2; for (let k = 0; k < 2; k++) { const w = me.tires[k]!, temp = Number.isFinite(w.temp) ? w.temp : air, wear = Number.isFinite(w.wear) ? Math.max(0, Math.min(1, w.wear)) : 0, col = temp < T.windowLo ? C.cyan : temp <= T.windowHi ? '#34ff7a' : C.org, bx = x + k * (bw + K.gap * S), f = Math.max(0, Math.min(1, (temp - air) / Math.max(1, T.hot - air))); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.strokeRect(bx, tireY, bw, K.barH * S); ctx.fillStyle = col; ctx.fillRect(bx + K.pad, tireY + K.pad, (bw - 2 * K.pad) * f, (K.barH - 2 * K.pad) * S); ctx.fillStyle = C.red; ctx.fillRect(bx + K.pad, tireY + (K.barH - 2) * S, (bw - 2 * K.pad) * wear, S); text(ctx, `${k === 0 ? 'L' : 'R'}${Math.round(temp)}\u00b0 ${Math.round(wear * 100)}%`, bx, tireY - TACH_HUD.labelGap * S, K.font * S, col); } }
  { const K = CLUTCH_HUD, temp = Number.isFinite(me.clutchTemp) ? me.clutchTemp : CLUTCH.ambient, condition = Number.isFinite(me.clutchCondition) ? Math.max(CLUTCH.minCondition, Math.min(1, me.clutchCondition)) : 1, x = cx - R, heat = Math.max(0, Math.min(1, (temp - CLUTCH.ambient) / Math.max(1, CLUTCH.maxTemp - CLUTCH.ambient))), col = temp >= CLUTCH.wearHotTemp ? C.red : temp >= CLUTCH.fadeFrom ? C.org : C.mag; ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.strokeRect(x, clutchHeatY, R * 2, K.barH * S); ctx.fillStyle = col; ctx.fillRect(x + K.pad, clutchHeatY + K.pad, (R * 2 - 2 * K.pad) * heat, (K.barH - 2 * K.pad) * S); ctx.strokeStyle = K.conditionCol; ctx.strokeRect(x, clutchConditionY, R * 2, K.barH * S); ctx.fillStyle = K.conditionCol; ctx.fillRect(x + K.pad, clutchConditionY + K.pad, (R * 2 - 2 * K.pad) * condition, (K.barH - 2 * K.pad) * S); text(ctx, `CLUTCH ${Math.round(temp)}C ${Math.round(condition * 100)}%${me.clutchLocked ? ' LOCK' : me.launched ? ' SLIP' : ''}`, x, clutchHeatY - TACH_HUD.labelGap * S, K.font * S, col); }
  ctx.restore();
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
/** what the staging HUD says now: the stage's name, a colour, and the lines under it (rollback speed and distance, what to press) */
export function stagingPrompt(me: Runner, s: DragHudState, keys: DragKeyLabels): { title: string; col: string; lines: [string, string, number][] } {
  const label = stageLabel(me), lines: [string, string, number][] = [], toPre = me.x + STAGE.preStageRollout, toStage = me.x + DRAG.stageRollout;
  const k = (v: string | undefined, fallback: string): string => v ?? fallback;
  if (me.rolling) return { title: 'ROLLING TO THE BEAM', col: '#34ff7a', lines };
  if (label === 'STAGED' || label === 'DEEP STAGED') {
    const deepRow = !!keys.deepStage && !me.deepStage;
    if (deepRow) lines.push([`${keys.deepStage}: DEEP STAGE`, C.yel, 0.7]);
    if (keys.chute) lines.push([`${keys.chute}: ABORT`, C.red, 0.8]);
    return { title: s.green ? `${keys.launch}: ROLL OUT NOW` : `${label}: ${keys.launch} ON GREEN`, col: s.green ? '#34ff7a' : C.yel, lines };
  }
  if (label === 'WATER BOX') { lines.push([`${k(keys.gas, 'GAS')}: ROLL IN   ${k(keys.burnout, 'BURNOUT')} + ${k(keys.gas, 'GAS')}: BURNOUT`, C.cyan, 0.8]); return { title: me.wet > 0.05 ? 'WATER BOX: WET SLICKS' : 'WATER BOX', col: C.cyan, lines }; }
  if (label === 'BURNOUT') { lines.push([`${me.burnDistance.toFixed(0)} M   TIRES ${Math.round(me.tireTemp)}C${me.wet > 0.05 ? '   WET' : ''}`, C.org, 0.9], [`RELEASE ${k(keys.burnout, 'BURNOUT')} TO RUN OUT`, C.cyan, 0.7]); return { title: 'BURNOUT', col: C.org, lines }; }
  if (label === 'RUN OUT') { lines.push([`${k(keys.brake, 'BRAKE')}: STOP   THEN ${k(keys.backUp, 'BACK UP')}: BACK UP`, C.cyan, 0.8]); return { title: 'RUN OUT', col: C.yel, lines }; }
  if (label === 'BACK UP') { lines.push([`ROLLBACK ${Math.abs(me.v).toFixed(1)} M/S   ${toPre.toFixed(2)} M TO PRE-STAGE`, toPre > 0 ? C.yel : C.org, 0.9], [`${k(keys.backUp, 'BACK UP')}: REVERSE   ${k(keys.brake, 'BRAKE')}: STOP   ${k(keys.gas, 'GAS')}: CREEP FORWARD`, C.cyan, 0.7]); return { title: 'BACK UP', col: C.yel, lines }; }
  if (label === 'OVER-STAGED') { lines.push([`THE STAGE BULB IS OUT: ${k(keys.backUp, 'BACK UP')} PAST THE STAGE BEAM`, C.red, 0.9]); return { title: 'OVER-STAGED', col: C.red, lines }; }
  if (label === 'PRE-STAGE') { lines.push([`${toStage.toFixed(2)} M TO STAGE   TAP ${k(keys.gas, 'GAS')} TO CREEP, ${k(keys.brake, 'BRAKE')} TO STOP`, C.cyan, 0.8]); if (keys.deepStage) lines.push([`${keys.deepStage}: DEEP STAGE`, C.yel, 0.7]); return { title: 'PRE-STAGE', col: C.yel, lines }; }
  return { title: '', col: C.white, lines };
}

/** both cars' progress down the strip, the lines of the timeslip as they come, and the banners */
export function drawProgress(ctx: CanvasRenderingContext2D, W: number, H: number, s: DragHudState, mine: number, S: number, keys: DragKeyLabels): void {
  const x0 = 24 * S, w = Math.min(420 * S, W * 0.32), y0 = 30 * S;
  s.runners.forEach((r, i) => {
    const y = y0 + i * 30 * S, f = Math.max(0, Math.min(1, r.x / DRAG.marks.quarter)), col = i === mine ? C.cyan : C.mag;
    text(ctx, r.name, x0, y - 4 * S, 12 * S, col); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.strokeRect(x0, y, w, 8 * S); ctx.fillStyle = col; ctx.globalAlpha = 0.8; ctx.fillRect(x0 + 1, y + 1, (w - 2) * f, 8 * S - 2); ctx.globalAlpha = 1;
    if (r.aborted) text(ctx, 'ABORT', x0 + w + 10 * S, y + 8 * S, 12 * S, C.red);
    else if (r.reaction !== null) text(ctx, r.foul ? 'RED LIGHT' : `R/T ${r.reaction.toFixed(3)}`, x0 + w + 10 * S, y + 8 * S, 12 * S, r.foul ? C.red : C.white);
  });
  const me = s.runners[mine] as Runner, y = y0 + s.runners.length * 30 * S + 10 * S;
  drawTree(ctx, W, s, S);
  if (keys.auto) { if (!me.launched) text(ctx, `AUTO DRIVER: ${stageLabel(me) || 'READY'}`, W / 2, H * 0.62, 20 * S, C.vio, 'center', 0.85); }
  else if (!me.launched && !me.aborted) {
    const prompt = stagingPrompt(me, s, keys);
    text(ctx, prompt.title, W / 2, H * 0.62, 22 * S, prompt.col, 'center', s.green || !prompt.title.includes('GREEN') ? 1 : 0.85);
    prompt.lines.forEach(([line, col, alpha], i) => text(ctx, line, W / 2, H * 0.62 + (25 + i * 25) * S, 14 * S, col, 'center', alpha));
    if (me.stage === 'staged' || me.stage === 'deepStaged') { if (keys.clutch) text(ctx, `${keys.clutch}: CLUTCH`, W / 2, H * 0.62 + (25 + prompt.lines.length * 25) * S, 13 * S, C.mag, 'center', 0.75); }
    if (!s.green && s.armed === false) text(ctx, 'THE TREE ARMS WHEN YOU ARE STAGED', W / 2, H * 0.62 - 28 * S, 12 * S, C.white, 'center', 0.6);
  }
  else if (keys.manual && !me.finished && me.gear < me.tune.ratios.length && me.rpm >= me.tune.shiftRpm - 80) text(ctx, `${keys.launch}: SHIFT`, W / 2, H * 0.62, 20 * S, C.red, 'center', 0.9);
  if (me.marks.ft60 !== undefined) text(ctx, `60 FT ${me.marks.ft60.toFixed(3)}`, x0, y + 6 * S, 13 * S, C.white, 'left', 0.85);
  if (me.marks.eighth !== undefined) text(ctx, `1/8 ${me.marks.eighth.toFixed(3)}`, x0, y + 24 * S, 13 * S, C.white, 'left', 0.85);
  const infoFont = Math.round(12 * S), infoChars = Math.max(CONDITIONS_HUD.minChars, Math.floor(w / (infoFont * CONDITIONS_HUD.charW)));
  const info = wrapConditions(conditionsText(s.weather ?? s.conditions) + weatherText(s.conditions), infoChars);
  const infoShift = (info.length - 1) * CONDITIONS_HUD.lineGap * S;
  info.forEach((line, i) => text(ctx, line, x0, y + CONDITIONS_HUD.row * S + i * CONDITIONS_HUD.lineGap * S, 12 * S, C.cyan, 'left', 0.8));
  if (me.launched) {
    const P = PITCH_HUD, f = Math.max(0, Math.min(1, me.pitch / SUSP.maxPitch)), py = y + P.row * S + infoShift, bw = w * P.barShare, col = me.lift > 0 ? C.yel : C.cyan;
    text(ctx, `NOSE ${(me.pitch * P.deg / Math.PI).toFixed(1)}\u00b0`, x0, py - 5 * S, P.font * S, col, 'left', P.alpha);
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.strokeRect(x0, py, bw, P.barH * S); ctx.fillStyle = col; ctx.fillRect(x0 + P.pad, py + P.pad, (bw - 2 * P.pad) * f, (P.barH - 2 * P.pad) * S);
    if (me.lift > 0) text(ctx, 'FRONT UP', x0 + bw + P.gap * S, py + P.barH * S, P.font * S, C.yel, 'left', P.alpha);
  }
  if (me.spec.boostCap > 0) {
    const B = BOOST_HUD, limit = boostLimitOf(me.tune), f = Math.max(0, Math.min(BOOST.maxLimit, me.boost)), by = y + B.row * S + infoShift, bw = w * B.barShare, col = limit > BOOST.safeLimit ? C.org : C.cyan, retard = Math.round(me.retard * 100), heatCol = retard > 1 ? C.red : col;
    text(ctx, `BOOST ${Math.round(f * 100)}%  ENGINE ${Math.round(me.engineTemp)}C -${retard}%`, x0, by - 5 * S, B.font * S, heatCol, 'left', B.alpha);
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.strokeRect(x0, by, bw, B.barH * S); ctx.fillStyle = col; ctx.fillRect(x0 + B.pad, by + B.pad, (bw - 2 * B.pad) * f, (B.barH - 2 * B.pad) * S);
    text(ctx, `${Math.round(limit * 100)}% LIMIT`, x0 + bw + B.gap * S, by + B.barH * S, B.font * S, col, 'left', B.alpha);
  }
  if (me.launched) { const K = TIRE_HUD, l = me.tires[0]!, r = me.tires[1]!; text(ctx, `TIRE WEAR L${Math.round(clamp01(l.wear) * 100)}% R${Math.round(clamp01(r.wear) * 100)}%`, x0, y + K.wearRow * S + infoShift, K.wearFont * S, C.org, 'left', K.wearAlpha); }
  let stopRow = STOP_HUD.firstRow;
  const stop = (label: string, col: string): void => { text(ctx, label, x0, y + stopRow * S + infoShift, STOP_HUD.font * S, col, 'left', STOP_HUD.alpha); stopRow += STOP_HUD.gap; };
  stop(`FUEL ${(Math.round(me.fuel * 10) / 10).toFixed(1)} KG ${Math.round(fuelShare(me) * 100)}%`, fuelShare(me) < FUEL_HUD.low ? C.red : C.cyan);
  stop(`TIRES ${me.hotPsi.toFixed(1)} PSI HOT / ${Math.round(me.tune.pressure)} COLD`, C.cyan);
  if (me.launched) stop(`REAR WEIGHT ${Math.round(me.rearShare * 100)}%`, me.lift > 0 ? C.yel : C.cyan);
  if (me.finished || me.aborted) {
    stop(`BRAKE ${Math.round(me.brakeTemp)}C ${Math.round(me.brakeFade * 100)}%`, me.brakeFade < 1 ? C.red : C.cyan);
    stop(`CHUTE ${Math.round(me.chuteOpen * 100)}%`, me.chute ? C.mag : C.white);
  }
  if (me.finished && !me.stopped) {
    const left = Math.max(0, SHUTDOWN.end - me.x);
    text(ctx, `STOP BEFORE THE END: ${Math.round(left)} M`, W / 2, H * 0.2, 22 * S, C.yel, 'center');
    text(ctx, `${keys.brake ?? 'BRAKE'}: BRAKE   ${keys.chute ?? 'CHUTE'}: CHUTE`, W / 2, H * 0.2 + 26 * S, 16 * S, C.cyan, 'center');
    if (me.chute) text(ctx, 'CHUTE OUT', W / 2, H * 0.2 + 48 * S, 14 * S, C.mag, 'center');
  }
  if (me.crashed) text(ctx, 'You crashed', W / 2, H * 0.3, 54 * S, C.red, 'center', 0.6 + 0.4 * Math.sin(s.t * 20));
  else if (me.finished) text(ctx, `1/4 MILE ${(me.marks.quarter as number).toFixed(3)} @ ${Math.round(me.trap)} KM/H`, W / 2, H * 0.3, 30 * S, C.yel, 'center');
  if (me.aborted && s.phase !== 'over') text(ctx, 'START ABORTED', W / 2, H * 0.3, 44 * S, C.red, 'center');
  else if (me.foul && s.phase !== 'over') text(ctx, 'RED LIGHT', W / 2, H * 0.3, 54 * S, C.red, 'center');
  else if (me.crossed) text(ctx, 'CROSSED THE CENTRE LINE', W / 2, H * 0.3, 40 * S, C.red, 'center');
  else { const them = s.runners.find((r, i) => i !== mine && (r.foul || r.crossed)); if (them) text(ctx, `${them.name} ${them.aborted ? 'ABORTED' : them.foul ? 'RED LIGHT' : 'CROSSED THE LINE'}: YOUR RACE`, W / 2, H * 0.3, 30 * S, '#34ff7a', 'center'); }
  if (!keys.auto && me.spec.nitroSecs > 0 && me.tune.nitroGear === 0 && me.launched && !me.nitroOn && me.nitroLeft > 0) text(ctx, `${keys.nitro}: NITRO`, W - 24 * S, 30 * S, 13 * S, C.vio, 'right', 0.8);
}

/** your lane from above, bottom middle: the centre line (red) on one side, the wall on the other, and your car where it is across the lane, turned the way it is heading */
export function drawLane(ctx: CanvasRenderingContext2D, W: number, H: number, me: Runner, lane: number, S: number): void {
  const w = 220 * S, h = 34 * S, x0 = W / 2 - w / 2, y0 = H - h - 22 * S, half = LANE.limit + 1.1, X = (y: number): number => x0 + w / 2 + (y / half) * (w / 2), centreRight = lane !== 0;
  ctx.save(); ctx.fillStyle = 'rgba(5,1,15,0.72)'; ctx.fillRect(x0 - 8 * S, y0 - 8 * S, w + 16 * S, h + 16 * S);
  ctx.lineWidth = 3 * S; ctx.strokeStyle = C.red; glow(ctx, C.red, 8); ctx.beginPath(); const cxl = centreRight ? x0 + w : x0; ctx.moveTo(cxl, y0); ctx.lineTo(cxl, y0 + h); ctx.stroke();
  ctx.strokeStyle = C.cyan; glow(ctx, C.cyan, 8); ctx.beginPath(); const wx = centreRight ? x0 : x0 + w; ctx.moveTo(wx, y0); ctx.lineTo(wx, y0 + h); ctx.stroke(); glow(ctx, null, 0);
  ctx.strokeStyle = 'rgba(255,225,77,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x0 + w / 2, y0); ctx.lineTo(x0 + w / 2, y0 + h); ctx.stroke(); ctx.setLineDash([]);
  const grip = Number.isFinite(me.gripLeft) ? me.gripLeft : 1, drift = Number.isFinite(me.drift) ? me.drift : 0, slide = 1 - grip;
  if (slide > LANE_HUD.slideAt) text(ctx, `SLIDE ${Math.round(grip * 100)}% GRIP`, x0 + 4 * S, y0 - 9 * S, LANE_HUD.font * S, C.cyan);
  if (slide > LANE_HUD.slideAt && Math.abs(drift) > 1e-3) {
    ctx.save(); ctx.translate(X(me.y), y0 + h / 2); ctx.rotate((me.psi + drift) * LANE_HUD.turnGain); ctx.strokeStyle = C.cyan; ctx.lineWidth = 1.5 * S; glow(ctx, C.cyan, 6); ctx.strokeRect(-LANE_HUD.markerW / 2 * S, -LANE_HUD.markerH / 2 * S, LANE_HUD.markerW * S, LANE_HUD.markerH * S); glow(ctx, null, 0); ctx.restore();
  }
  const danger = Math.abs(me.y) > LANE.limit * 0.7, col = me.crossed ? C.red : danger ? C.org : C.yel;
  ctx.translate(X(me.y), y0 + h / 2); ctx.rotate(me.psi * LANE_HUD.turnGain); ctx.fillStyle = col; glow(ctx, col, 10); ctx.fillRect(-6 * S, -12 * S, 12 * S, 24 * S); glow(ctx, null, 0); ctx.fillStyle = '#05010f'; ctx.fillRect(-4 * S, -12 * S, 8 * S, 5 * S);
  ctx.restore();
}
