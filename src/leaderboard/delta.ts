// The ghost delta: how far ahead (minus) or behind (plus) the class leader you are at each mark, on the race HUD and on the timeslip.
import { C } from '../sim/constants.ts';
import type { Mark } from '../drag/types.ts';

export const DELTA_MARKS: Array<{ mark: Mark; label: string }> = [{ mark: 'ft60', label: '60 FT' }, { mark: 'ft330', label: '330 FT' }, { mark: 'eighth', label: '1/8 MILE' }, { mark: 'ft1000', label: '1000 FT' }, { mark: 'quarter', label: '1/4 MILE' }];
export interface MarkDelta { label: string; /** seconds, negative = you are ahead of the leader */ seconds: number }

/** your time minus the leader's at every mark you have both reached (reaction time first, when you have launched) */
export function markDeltas(mine: Partial<Record<Mark, number>>, leader: Partial<Record<Mark, number>>, myReaction?: number | null, leaderReaction?: number | null): MarkDelta[] {
  const out: MarkDelta[] = [];
  if (typeof myReaction === 'number' && myReaction >= 0 && typeof leaderReaction === 'number') out.push({ label: 'R/T', seconds: myReaction - leaderReaction });
  for (const { mark, label } of DELTA_MARKS) { const a = mine[mark], b = leader[mark]; if (typeof a === 'number' && typeof b === 'number') out.push({ label, seconds: a - b }); }
  return out;
}
export const deltaText = (seconds: number): string => `${seconds <= 0 ? '-' : '+'}${Math.abs(seconds).toFixed(3)}`;
/** green when you are ahead, red when behind */
export const deltaColour = (seconds: number): string => (seconds <= 0 ? '#34ff7a' : '#ff3355');

/** the deltas as small lines on the race HUD, under the progress bars on the right-hand side of the top */
export function drawDeltas(ctx: CanvasRenderingContext2D, W: number, S: number, name: string, deltas: MarkDelta[]): void {
  if (!deltas.length) return;
  const x = W - 24 * S, y0 = 30 * S;
  ctx.save(); ctx.textAlign = 'right'; ctx.shadowBlur = 0; ctx.font = `bold ${Math.round(12 * S)}px monospace`; ctx.fillStyle = C.mag; ctx.globalAlpha = 0.9;
  ctx.fillText(`VS ${name}`, x, y0 - 4 * S);
  deltas.forEach((d, i) => { ctx.fillStyle = deltaColour(d.seconds); ctx.fillText(`${d.label}  ${deltaText(d.seconds)}`, x, y0 + (i + 1) * 17 * S); });
  ctx.restore();
}
/** the banner line at the top middle of the race screen (ranked or free play, density altitude) */
export function drawBanner(ctx: CanvasRenderingContext2D, W: number, S: number, line: string, ranked: boolean): void {
  ctx.save(); ctx.textAlign = 'center'; ctx.shadowBlur = 0; ctx.font = `bold ${Math.round(12 * S)}px monospace`; ctx.fillStyle = ranked ? C.yel : C.cyan; ctx.globalAlpha = 0.9;
  ctx.fillText(line, W / 2, 16 * S); ctx.restore();
}
/** timeslip rows for the delta against the leader: `<tr>` with a coloured value */
export function deltaRowsHtml(deltas: MarkDelta[]): string {
  return deltas.map(d => `<tr><td>${d.label}</td><td style="color:${deltaColour(d.seconds)}">${deltaText(d.seconds)}</td></tr>`).join('');
}
