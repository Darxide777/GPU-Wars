// THE GHOST. A ghost is a lap to race against, played from a compact LAP TRACE: every `TRACE.step` seconds from the green, how far along the lap the car was (decimetres from the start line, negative behind it), how far across the road
// (decimetres) and its speed (decimetres per second), all whole numbers. A trace can come from a lap you drove (`ghostFromLap`) or be MADE UP from the leader's lap time and splits (`ghostFromLeader`): it does not have to follow
// the simulation, it only has to cross the start line, every gate and the finish at the leader's times. The same record always gives the same ghost (the small wander across the road comes from the seeded random source,
// never Math.random). Same pattern as the Drag class-leader ghost in src/leaderboard/ghost.ts.
import { createRng } from '../arena/rng.ts';
import { TRACE } from './constants.ts';
import { placeOnTrack } from './physics.ts';
import { alongOf, cumulativeLengths, pointAtAlong } from './road.ts';
import type { FormulaGhost, FormulaTimeslip, FormulaTrack, LapTrace } from './types.ts';

/** Turn `launchAccel` first to change how fast the made-up ghost leaves the grid (it only sets the time from the green to the start line, which a real leader's record does not hold). */
export const GHOST = {
  /** the pull (m/s2) a made-up ghost has from the grid to the start line, and the reaction it is given when the record has none */ launchAccel: 40, reaction: 0.2,
  /** the made-up speed shape of a lap with no splits: the car is at `startShare` of its average speed at the line and reaches full speed over `accelMetres` (it only places the splits) */ startShare: 0.55, accelMetres: 150,
  /** after its finish a ghost keeps rolling for this many seconds and slows with this time constant, so it does not stop dead on the line */ rolloutSeconds: 4, rolloutTau: 1.2,
  /** the wander across the road, metres, and the waves' frequencies (Hz) and weights (a made-up ghost drifts a little instead of sliding on rails) */ wanderMetres: 0.35, wanderHz: [0.021, 0.057, 0.13] as number[], wanderWeight: [0.55, 0.3, 0.15] as number[],
  /** what a ghost may hold (a bound on saved and sent ghosts): the longest lap (s), the most samples, the most splits */ maxLapTime: 600, minLapTime: 5, maxSamples: 6000, maxSplits: 64,
} as const;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** a monotone curve through points (t increasing, s never falling): it never overshoots, so the ghost never goes backwards. Starts at rest (slope 0) and ends with the last stretch's slope. */
function monotoneCurve(ts: number[], ss: number[]): (t: number) => number {
  const n = ts.length, d: number[] = [], m: number[] = new Array(n).fill(0) as number[];
  for (let k = 0; k < n - 1; k++) d.push(((ss[k + 1] as number) - (ss[k] as number)) / Math.max(1e-6, (ts[k + 1] as number) - (ts[k] as number)));
  for (let k = 1; k < n - 1; k++) { const a = d[k - 1] as number, b = d[k] as number; m[k] = a * b <= 0 ? 0 : (2 * a * b) / (a + b); }
  m[0] = 0; m[n - 1] = d[n - 2] as number;
  const slopeAtEnd = m[n - 1] as number;
  const eval_ = (t: number): number => {
    if (t <= (ts[0] as number)) return ss[0] as number;
    if (t >= (ts[n - 1] as number)) { const over = t - (ts[n - 1] as number); return (ss[n - 1] as number) + slopeAtEnd * GHOST.rolloutTau * (1 - Math.exp(-over / GHOST.rolloutTau)); }
    let k = 0; while (k < n - 2 && t > (ts[k + 1] as number)) k++;
    const h = (ts[k + 1] as number) - (ts[k] as number), u = (t - (ts[k] as number)) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * (ss[k] as number) + (u3 - 2 * u2 + u) * h * (m[k] as number) + (-2 * u3 + 3 * u2) * (ss[k + 1] as number) + (u3 - u2) * h * (m[k + 1] as number);
  };
  return eval_;
}

/** the gate splits a lap of this time would have with no record of them: the time to each gate, from a made-up speed that starts slow at the line and builds (`GHOST.startShare`, `accelMetres`) */
export function defaultSplits(track: FormulaTrack, lapTime: number): number[] {
  const speedAt = (s: number): number => GHOST.startShare + (1 - GHOST.startShare) * (1 - Math.exp(-s / GHOST.accelMetres)), cum: number[] = [0], step = 1;
  for (let s = 0; s < track.length; s += step) cum.push((cum[cum.length - 1] as number) + step / speedAt(s + step / 2));
  const total = cum[cum.length - 1] as number, timeAt = (s: number): number => lapTime * (cum[Math.min(cum.length - 1, Math.round(s / step))] as number) / total;
  return track.gates.slice(1).map(g => timeAt(alongOf(track.road, g.i, 0))).concat(lapTime);
}
/** whether a list of split times is usable: finite, rising, one for every gate (the last is the finish, equal to the lap time) */
const splitsOk = (splits: unknown, gates: number, lapTime: number): splits is number[] => Array.isArray(splits) && splits.length === gates && splits.every((t, i) => isNumber(t) && t > 0 && (i === 0 || t > (splits[i - 1] as number))) && Math.abs((splits[gates - 1] as number) - lapTime) < 0.02;

/** the made-up ghost of a leader: crosses the start line at `launchTime` after the green, every gate at the leader's split and the finish at the leader's lap time. `splits` (one per gate, the last is the lap time) are made from the lap time when missing or wrong. */
export function ghostFromLeader(track: FormulaTrack, o: { name: string; lapTime: number; splits?: number[]; reaction?: number; topSpeed?: number }): FormulaGhost | null {
  if (!isNumber(o.lapTime) || o.lapTime < GHOST.minLapTime || o.lapTime > GHOST.maxLapTime) return null;
  const reaction = isNumber(o.reaction) ? clamp(o.reaction, 0, 3) : GHOST.reaction, gates = track.gates.length, splits = splitsOk(o.splits, gates, o.lapTime) ? o.splits.map(t => +t.toFixed(3)) : defaultSplits(track, o.lapTime).map(t => +t.toFixed(3));
  const back = -alongOfGrid(track), gridAcross = placeOnTrack(track, track.grid.x, track.grid.y).across, launchTime = reaction + Math.sqrt(2 * back / GHOST.launchAccel);
  // (time from the green, along the lap): standing on the grid until the reaction, then the start line, each gate and the finish
  const ts: number[] = [0, reaction, launchTime], ss: number[] = [-back, -back, 0];
  track.gates.slice(1).forEach((g, k) => { ts.push(launchTime + (splits[k] as number)); ss.push(alongOf(track.road, g.i, 0)); });
  ts.push(launchTime + o.lapTime); ss.push(track.length);
  const along = monotoneCurve(ts, ss), rng = createRng(seedOf(track.id, o.name, o.lapTime)), phases = GHOST.wanderHz.map(() => rng.next() * Math.PI * 2), end = launchTime + o.lapTime + GHOST.rolloutSeconds;
  const trace: LapTrace = { step: TRACE.step, s: [], o: [], v: [] };
  for (let k = 0; k * TRACE.step <= end + 1e-9; k++) {
    const t = k * TRACE.step, s = along(t), t0 = Math.max(0, t - 0.05), t1 = t + 0.05;
    // it leaves the grid place and settles onto the line over the first 60 m, and the wander builds up as it goes
    const build = clamp((s + back) / 60, 0, 1), gridSide = (1 - build) * gridAcross;
    const wander = gridSide + build * GHOST.wanderMetres * GHOST.wanderHz.reduce((sum, hz, i) => sum + (GHOST.wanderWeight[i] as number) * Math.sin(2 * Math.PI * hz * s + (phases[i] as number)), 0);
    trace.s.push(Math.round(s * 10)); trace.o.push(Math.round(wander * 10)); trace.v.push(Math.round(Math.max(0, (along(t1) - along(t0)) / (t1 - t0)) * 10));
  }
  const top = isNumber(o.topSpeed) && o.topSpeed > 0 ? o.topSpeed : Math.max(...trace.v) / 10 * 3.6;
  return cleanGhost({ trackId: track.id, name: o.name, reaction, launchTime, lapTime: o.lapTime, splits, topSpeed: top, trace });
}
/** where the grid is along the lap (negative: behind the start line) */
const alongOfGrid = (track: FormulaTrack): number => { const c = cumulativeLengths(track.road), n = track.road.path.length; let best = 0, bd = Infinity; for (let i = 0; i < n; i++) { const p = track.road.path[i] as { x: number; y: number }, d = Math.hypot(p.x - track.grid.x, p.y - track.grid.y); if (d < bd) { bd = d; best = i; } } const s = c[best] as number; return s > track.length / 2 ? s - track.length : s; };
/** a repeatable seed from a track, a name and a lap time (a small string hash, never a random call) */
function seedOf(trackId: string, name: string, lapTime: number): number {
  let h = 2166136261; for (const ch of `${trackId}|${name}|${lapTime.toFixed(3)}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0;
}

/** the ghost of a lap you drove: the trace the race recorded and the times from its timeslip (null when the lap was not finished cleanly) */
export function ghostFromLap(track: FormulaTrack, slip: FormulaTimeslip, trace: LapTrace, name: string): FormulaGhost | null {
  if (!slip.valid || !slip.finished) return null;
  return cleanGhost({ trackId: track.id, name, reaction: slip.reaction ?? GHOST.reaction, launchTime: slip.launchTime, lapTime: slip.lapTime, splits: slip.splits, topSpeed: slip.topSpeed, trace });
}
/** a ghost (from a save or the network) made safe, or null when it cannot be made into a valid one: numbers finite and bounded, the trace whole numbers of one length that never goes backwards */
export function cleanGhost(raw: unknown): FormulaGhost | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Record<string, unknown>, t = g.trace as Record<string, unknown> | undefined;
  if (typeof g.trackId !== 'string' || !t || !Array.isArray(t.s) || !Array.isArray(t.o) || !Array.isArray(t.v)) return null;
  if (!isNumber(g.lapTime) || g.lapTime < GHOST.minLapTime || g.lapTime > GHOST.maxLapTime || !isNumber(t.step) || t.step < 0.02 || t.step > 1) return null;
  const n = t.s.length; if (n < 2 || n > GHOST.maxSamples || t.o.length !== n || t.v.length !== n) return null;
  const s: number[] = [], o: number[] = [], v: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = t.s[i], b = t.o[i], c = t.v[i]; if (!isNumber(a) || !isNumber(b) || !isNumber(c)) return null;
    // (along never falls: a sample under the one before it is lifted to it)
    // (+ 0 turns a negative zero into a plain zero, so a ghost compares equal to its saved copy)
    s.push(Math.max(Math.round(a), i ? (s[i - 1] as number) : -1e6) + 0); o.push(clamp(Math.round(b), -2000, 2000) + 0); v.push(clamp(Math.round(c), 0, 20000) + 0);
  }
  const splits = Array.isArray(g.splits) ? g.splits.filter(isNumber).slice(0, GHOST.maxSplits).map(x => +x.toFixed(3)) : [];
  return {
    trackId: g.trackId.slice(0, 32), name: (typeof g.name === 'string' ? g.name : 'GHOST').replace(/[^\x20-\x7e]/g, '').trim().toUpperCase().slice(0, 20) || 'GHOST',
    reaction: isNumber(g.reaction) ? clamp(g.reaction, -1, 5) : GHOST.reaction, launchTime: isNumber(g.launchTime) ? clamp(g.launchTime, 0, 60) : 0, lapTime: +g.lapTime.toFixed(3), splits, topSpeed: isNumber(g.topSpeed) ? clamp(g.topSpeed, 0, 2000) : 0,
    trace: { step: t.step, s, o, v },
  };
}

/** where the ghost is `t` seconds after the green: along the lap, across the road, its speed (m/s), the place and heading on the ground, and whether it has finished its lap */
export interface GhostPose { along: number; across: number; speed: number; x: number; y: number; a: number; finished: boolean }
export function ghostPose(ghost: FormulaGhost, track: FormulaTrack, t: number): GhostPose {
  const tr = ghost.trace, n = tr.s.length, f = clamp(t / tr.step, 0, n - 1), k = Math.min(n - 2, Math.floor(f)), u = f - k;
  const mix = (arr: number[]): number => ((arr[k] as number) * (1 - u) + (arr[k + 1] as number) * u) / 10;
  const along = mix(tr.s), across = mix(tr.o), speed = mix(tr.v), at = pointAtAlong(track.road, along, across);
  return { along, across, speed, x: at.x, y: at.y, a: at.a, finished: t >= ghost.launchTime + ghost.lapTime };
}
/** the time (seconds from the green) the ghost reached a place `along` the lap: how far ahead or behind you are is your time there against this */
export function ghostTimeAt(ghost: FormulaGhost, along: number): number {
  const tr = ghost.trace, n = tr.s.length, target = along * 10;
  if (target <= (tr.s[0] as number)) return 0; if (target >= (tr.s[n - 1] as number)) return (n - 1) * tr.step;
  let lo = 0, hi = n - 1; while (lo < hi - 1) { const mid = (lo + hi) >> 1; if ((tr.s[mid] as number) <= target) lo = mid; else hi = mid; }
  const a = tr.s[lo] as number, b = tr.s[hi] as number, u = b > a ? (target - a) / (b - a) : 0;
  return (lo + u) * tr.step;
}
