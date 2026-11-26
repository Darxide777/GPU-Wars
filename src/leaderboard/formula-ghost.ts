// FORMULA GHOST <-> WIRE FORMAT. Two ghost shapes exist and this file is the only place that converts between them.
//
//   The simulation's ghost (src/formula/ghost.ts, `FormulaGhost`): a lap TRACE every 0.1 s from the green, in whole decimetres along the lap (negative behind the start line), across the road and speed. Rich, but it
//   also holds the grid approach, the wander across the road and the rollout after the finish, and a lap is about 500 samples.
//   The wire format (backend `parseGhost`, `FORMULA_PLACEHOLDER_TABLE.ghost`): `[seconds, metres along the lap]` pairs, ordered, at most 256, within 240 s and 20000 m. It is the same shape as Drag's
//   `[seconds, feet]`, so the backend has ONE ghost parser for both modes.
//
// DECISION: the backend keeps the generic `[seconds, metres]` shape and the client converts. Reasons: (1) the server never needs to know the sim's trace (decimetres, three parallel arrays, a 0.1 s step tied
// to `TRACE.step`), so the sim can change its trace without a backend change or a migration; (2) the pairs are 2 numbers per sample, half the size, and the 256-sample cap already exists and is tested; (3) a rank-1
// ghost only has to reproduce WHEN the leader was WHERE, which the pairs hold exactly; the sideways wander and the grid approach are not part of the ranked lap, and the sim already makes them up
// (`ghostFromLeader`, seeded, never Math.random). Time in the pairs counts from the START LINE (like Drag's launch), so the grid approach and the reaction time are not stored.
// What the round trip loses: the pre-start approach, the real sideways line and the speed samples (speed is re-derived from the pairs). What it keeps: where the car was, at every moment from the line to the finish.
import { alongOf } from '../formula/road.ts';
import { cleanGhost, ghostFromLeader, type FormulaGhost, type FormulaTrack, type LapTrace } from '../formula/index.ts';

/** the limits of the wire format (the backend's `parseGhost` and `FORMULA_PLACEHOLDER_TABLE.ghost`; a test checks they agree) */
export const FORMULA_GHOST_WIRE = { maxSamples: 256, maxSeconds: 240, maxMetres: 20000, targetSamples: 240 } as const;
export type GhostPairs = Array<[number, number]>;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round = (v: number, digits: number): number => Math.round(v * 10 ** digits) / 10 ** digits;

/** metres along the lap at `t` seconds from the green, read from the trace by straight lines between samples (the trace is in decimetres) */
function alongAtGreen(trace: LapTrace, t: number): number {
  const n = trace.s.length, f = Math.max(0, Math.min(n - 1, t / trace.step)), k = Math.min(n - 2, Math.floor(f)), u = f - k;
  return (((trace.s[k] as number) * (1 - u)) + ((trace.s[k + 1] as number) * u)) / 10;
}

/** the wire pairs of a ghost: `[seconds from the start line, metres along the lap]` from the line to the finish, at most `targetSamples` of them, time and distance never falling, first pair [0, 0]-ish and the last at the lap time.
 *  Returns undefined when the ghost has no lap to send. */
export function ghostToPairs(ghost: FormulaGhost | null | undefined): GhostPairs | undefined {
  if (!ghost || !isNum(ghost.lapTime) || ghost.lapTime <= 0 || ghost.lapTime > FORMULA_GHOST_WIRE.maxSeconds) return undefined;
  const count = Math.max(2, Math.min(FORMULA_GHOST_WIRE.targetSamples, Math.ceil(ghost.lapTime / ghost.trace.step) + 1)), out: GhostPairs = [];
  let lastMetres = 0;
  for (let i = 0; i < count; i++) {
    const seconds = (ghost.lapTime * i) / (count - 1), metres = Math.min(FORMULA_GHOST_WIRE.maxMetres, Math.max(lastMetres, alongAtGreen(ghost.trace, ghost.launchTime + seconds)));
    lastMetres = metres;
    out.push([round(seconds, 3), round(metres, 1)]);
  }
  return out;
}

/** wire pairs from the network made safe: finite, ordered, in range and long enough, or null */
export function cleanPairs(raw: unknown): GhostPairs | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > FORMULA_GHOST_WIRE.maxSamples) return null;
  const out: GhostPairs = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) return null;
    const last = out[out.length - 1];
    if (p[0] < 0 || p[0] > FORMULA_GHOST_WIRE.maxSeconds || p[1] < 0 || p[1] > FORMULA_GHOST_WIRE.maxMetres || (last && (p[0] < last[0] || p[1] < last[1]))) return null;
    out.push([p[0], p[1]]);
  }
  return (out[out.length - 1] as [number, number])[0] > (out[0] as [number, number])[0] ? out : null;
}

/** metres along the lap at `t` seconds after the start line, between the pairs by straight lines (before the first pair: the first, after the last: the last) */
export function pairsAlongAt(pairs: GhostPairs, t: number): number {
  if (t <= (pairs[0] as [number, number])[0]) return (pairs[0] as [number, number])[1];
  const last = pairs[pairs.length - 1] as [number, number];
  if (t >= last[0]) return last[1];
  let lo = 0, hi = pairs.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if ((pairs[mid] as [number, number])[0] <= t) lo = mid; else hi = mid; }
  const a = pairs[lo] as [number, number], b = pairs[hi] as [number, number];
  return b[0] > a[0] ? a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0]) : b[1];
}
/** the time (seconds after the start line) the pairs reach `metres` along the lap, or null when they never do */
export function pairsTimeAt(pairs: GhostPairs, metres: number): number | null {
  const first = pairs[0] as [number, number], last = pairs[pairs.length - 1] as [number, number];
  if (metres > last[1] + 1e-6) return null;
  if (metres <= first[1]) return first[0];
  for (let i = 1; i < pairs.length; i++) {
    const a = pairs[i - 1] as [number, number], b = pairs[i] as [number, number];
    if (b[1] >= metres) return b[1] > a[1] ? a[0] + ((b[0] - a[0]) * (metres - a[1])) / (b[1] - a[1]) : b[0];
  }
  return last[0];
}

/** what a stored record (the server's leader, or a saved lap) holds of a ghost */
export interface GhostRecord { name: string; lapTime: number; /** from the start line, one per gate with the finish last (optional) */ splits?: number[]; topSpeed?: number; reaction?: number; /** the wire pairs, if the record has them */ pairs?: unknown }

/** a playable ghost from a record. With pairs, the car is exactly where the pairs say from the start line to the finish (speed is re-derived from them, the sideways wander and the grid approach are made up as for any leader).
 *  Without usable pairs it is made up from the lap time and splits (`ghostFromLeader`). Null when even the lap time is unusable. */
export function ghostFromRecord(track: FormulaTrack, record: GhostRecord): FormulaGhost | null {
  const pairs = cleanPairs(record.pairs);
  const usablePairs = pairs && Math.abs((pairs[pairs.length - 1] as [number, number])[0] - record.lapTime) < 0.5 && Math.abs((pairs[pairs.length - 1] as [number, number])[1] - track.length) < 0.01 * track.length + 15 ? pairs : null;
  // the split times at every gate come from the pairs when there are some: the ghost then crosses each gate when the real lap did
  let splits = record.splits;
  if (usablePairs) {
    const fromPairs = track.gates.slice(1).map(g => pairsTimeAt(usablePairs, alongOf(track.road, g.i, 0)));
    if (fromPairs.every(isNum)) splits = [...(fromPairs as number[]).map(t => round(t, 3)), round(record.lapTime, 3)];
  }
  const base = ghostFromLeader(track, { name: record.name, lapTime: record.lapTime, splits, topSpeed: record.topSpeed, reaction: record.reaction });
  if (!base || !usablePairs) return base;
  const trace = base.trace, s = trace.s.slice(), v = trace.v.slice(), endPair = (usablePairs[usablePairs.length - 1] as [number, number])[0], dt = 0.1;
  for (let k = 0; k < s.length; k++) {
    const local = k * trace.step - base.launchTime;
    if (local < 0 || local > endPair) continue;
    s[k] = Math.round(pairsAlongAt(usablePairs, local) * 10);
    v[k] = Math.max(0, Math.round(((pairsAlongAt(usablePairs, local + dt) - pairsAlongAt(usablePairs, Math.max(0, local - dt))) / (local - dt < 0 ? local + dt : 2 * dt)) * 10));
  }
  return cleanGhost({ ...base, trace: { ...trace, s, v } });
}
