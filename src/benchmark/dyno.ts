// The dyno sheet: torque and horsepower against revs for a car's spec, from the SAME curve the physics uses (torqueShape), with hp = torque (Nm) x rpm / 7127.
// This is the engine at the flywheel, before the blower's boost, so the power peak shown is consistent with `spec.torque` and the curve.
import { torqueShape } from '../drag/tune.ts';
import { HP_DIVISOR } from '../drag/spec-source.ts';
import type { DragSpec } from '../drag/types.ts';

export type DynoSpec = Pick<DragSpec, 'idle' | 'peakRpm' | 'redline' | 'torque' | 'curve'>;
export interface DynoPoint { rpm: number; torqueNm: number; hp: number }
/** torque at the revs, from the car's curve */
export const torqueAt = (spec: DynoSpec, rpm: number): number => spec.torque * torqueShape(spec, rpm);
/** horsepower at the revs: torque x rpm / 7127 */
export const powerAt = (spec: DynoSpec, rpm: number): number => torqueAt(spec, rpm) * rpm / HP_DIVISOR;
/** the pull from idle to the limiter, every `step` rpm (the last point is the limiter) */
export function dynoCurve(spec: DynoSpec, step = 100): DynoPoint[] {
  const out: DynoPoint[] = [], span = Math.max(1, spec.redline - spec.idle), n = Math.max(2, Math.ceil(span / step));
  for (let i = 0; i <= n; i++) { const rpm = Math.min(spec.redline, spec.idle + (span * i) / n); out.push({ rpm, torqueNm: torqueAt(spec, rpm), hp: powerAt(spec, rpm) }); }
  return out;
}
/** the highest torque and the highest power on the pull, and the revs they are at */
export function dynoPeaks(spec: DynoSpec): { torqueNm: number; torqueRpm: number; hp: number; hpRpm: number } {
  let best = { torqueNm: 0, torqueRpm: spec.idle, hp: 0, hpRpm: spec.idle };
  for (const p of dynoCurve(spec, 25)) { if (p.torqueNm > best.torqueNm) { best.torqueNm = p.torqueNm; best.torqueRpm = p.rpm; } if (p.hp > best.hp) { best.hp = p.hp; best.hpRpm = p.rpm; } }
  return best;
}

/** the dyno graph as an inline SVG (torque in magenta, power in cyan, a yellow line at the shift point and a mark at the power peak). `shiftRpm` is the tune's automatic shift point. */
export function dynoSvg(spec: DynoSpec, shiftRpm: number, width = 420, height = 190): string {
  const pts = dynoCurve(spec, 100), peaks = dynoPeaks(spec), L = 44, R = 44, T = 14, B = 26, w = width - L - R, h = height - T - B;
  const yMax = Math.max(1, Math.ceil(Math.max(peaks.torqueNm, peaks.hp) / 500) * 500);
  const x = (rpm: number): number => L + ((rpm - spec.idle) / Math.max(1, spec.redline - spec.idle)) * w, y = (v: number): number => T + h - (v / yMax) * h;
  const line = (f: (p: DynoPoint) => number): string => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.rpm).toFixed(1)},${y(f(p)).toFixed(1)}`).join('');
  const shift = Math.max(spec.idle, Math.min(spec.redline, Number.isFinite(shiftRpm) ? shiftRpm : spec.redline));
  let grid = ''; for (let v = 0; v <= yMax; v += 500) grid += `<line x1="${L}" x2="${L + w}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#2a1a4a"/><text x="${L - 4}" y="${(y(v) + 3).toFixed(1)}" fill="#8a9ac0" font-size="9" text-anchor="end">${v}</text>`;
  for (let r = Math.ceil(spec.idle / 1000) * 1000; r <= spec.redline; r += 1000) grid += `<text x="${x(r).toFixed(1)}" y="${height - 8}" fill="#8a9ac0" font-size="9" text-anchor="middle">${r / 1000}K</text>`;
  return `<svg class="dyno" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Dyno: torque and horsepower against rpm">${grid}`
    + `<path d="${line(p => p.torqueNm)}" fill="none" stroke="#ff2bd6" stroke-width="2"/><path d="${line(p => p.hp)}" fill="none" stroke="#21e6ff" stroke-width="2"/>`
    + `<line x1="${x(shift).toFixed(1)}" x2="${x(shift).toFixed(1)}" y1="${T}" y2="${T + h}" stroke="#ffe14d" stroke-dasharray="4 3"/><text x="${x(shift).toFixed(1)}" y="${T - 3}" fill="#ffe14d" font-size="9" text-anchor="middle">SHIFT ${Math.round(shift)}</text>`
    + `<circle cx="${x(peaks.hpRpm).toFixed(1)}" cy="${y(peaks.hp).toFixed(1)}" r="4" fill="#21e6ff"/><text x="${(x(peaks.hpRpm) - 6).toFixed(1)}" y="${(y(peaks.hp) - 7).toFixed(1)}" fill="#21e6ff" font-size="10" text-anchor="end">${Math.round(peaks.hp)} HP @ ${Math.round(peaks.hpRpm)}</text>`
    + `<text x="${L + 4}" y="${T + 10}" fill="#ff2bd6" font-size="10">${Math.round(peaks.torqueNm)} NM @ ${Math.round(peaks.torqueRpm)}</text></svg>`;
}
