// THE CLASS-LEADER GHOST. It is NOT a second physics car and NOT an exact replay: it is a smooth path x(t) built from the leader's numbers (ET, splits, trap speed, seed)
// so that it crosses every mark at the leader's time. Missing splits are made from a class-specific acceleration envelope. The same record always gives the same ghost
// (the lane drift comes from the seeded random source, never Math.random). The result goes through cleanDragGhost like any saved ghost.
import { createRng } from '../arena/rng.ts';
import { DRAG, cleanDragGhost, stageRolloutTime } from '../drag/physics.ts';
import type { DragGhost, GhostSample, Mark } from '../drag/types.ts';
import { eraOf, type ClassId } from './classes.ts';
import type { LeaderRecord } from './leader.ts';

/** Turn `powerByEra` first to change how a class launches (higher: a slower start and a harder pull at the end); `driftMetres` for how much the lane wanders. */
export const LEADERBOARD_GHOST = {
  /** seconds between samples */ step: 0.05,
  /** seconds the path continues after the quarter-mile line (the same as a recorded ghost) */ tail: 0.1,
  /** the acceleration envelope: distance grows as time to this power, x = quarter * (t / ET)^power. 2 is constant acceleration; more means a slower start and a harder end. */
  powerByEra: { integrated: 1.55, retro: 1.6, classic: 1.65, modern: 1.7, current: 1.75 } as Record<string, number>,
  /** the power is also pulled toward what the trap speed says (trap * ET / quarter distance): this share comes from the trap speed, the rest from the class */ trapShare: 0.5,
  powerRange: [1.2, 2.4] as [number, number],
  /** the smallest gap between two marks, seconds (a generated split never gets closer than this to its neighbours) */ minGap: 0.04,
  /** the sideways wander in the lane: how far (m), the waves' frequencies (Hz) and weights, and how long it takes to build up after the launch (s) */
  driftMetres: 0.1, driftHz: [0.31, 0.83, 1.7] as number[], driftWeight: [0.55, 0.3, 0.15] as number[], driftRamp: 0.6,
  /** the canned staging path: the ghost starts this far (m) behind the staging beam, this many seconds before it rolls in, and creeps up to the beam */
  stagingBack: 0.1, stagingLead: 3.5,
  /** the longest the ghost plays, seconds (like GHOST.maxTime) */ maxSeconds: 40,
} as const;

const MPH_TO_MS = 0.44704;
type SplitMark = Exclude<Mark, 'trapStart'>;
const MARKS: SplitMark[] = ['ft60', 'ft330', 'eighth', 'ft1000', 'quarter'];
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const smooth = (u: number): number => { const t = clamp(u, 0, 1); return t * t * (3 - 2 * t); };

/** the exponent of the class's envelope, mixed with the one the trap speed implies */
export function envelopePower(cls: ClassId, quarter: number, trapMph: number): number {
  const G = LEADERBOARD_GHOST, classPower = G.powerByEra[eraOf(cls)] ?? 1.65;
  const fromTrap = trapMph > 0 ? trapMph * MPH_TO_MS * quarter / DRAG.marks.quarter : classPower;
  return clamp(G.trapShare * fromTrap + (1 - G.trapShare) * classPower, G.powerRange[0], G.powerRange[1]);
}

/** The times at every mark: the leader's own where they make sense, the rest from the envelope. A missing time is placed between the nearest known times
 * (before it and after it) in proportion to the envelope, so the marks are always strictly increasing and a known time is never moved. */
export function completeSplits(rec: LeaderRecord): Record<SplitMark, number> {
  const G = LEADERBOARD_GHOST, quarter = rec.splits.quarter, power = envelopePower(rec.class, quarter, rec.trapSpeed);
  const envelope = (m: SplitMark): number => quarter * Math.pow(DRAG.marks[m] / DRAG.marks.quarter, 1 / power);
  const known: Partial<Record<SplitMark, number>> = {}; let lastKnown = 0;
  for (const m of MARKS) {
    const v = rec.splits[m];
    // a given time counts only if it is later than the one before and leaves room before the quarter
    if (typeof v === 'number' && Number.isFinite(v) && v > lastKnown + G.minGap && (m === 'quarter' || v < quarter - G.minGap)) { known[m] = v; lastKnown = v; }
  }
  known.quarter = quarter;
  const out = {} as Record<SplitMark, number>;
  MARKS.forEach((m, i) => {
    const given = known[m]; if (given !== undefined) { out[m] = given; return; }
    let lo = -1, hi = MARKS.length - 1;
    for (let k = i - 1; k >= 0; k--) if (known[MARKS[k] as SplitMark] !== undefined) { lo = k; break; }
    for (let k = i + 1; k < MARKS.length; k++) if (known[MARKS[k] as SplitMark] !== undefined) { hi = k; break; }
    const tLo = lo < 0 ? 0 : known[MARKS[lo] as SplitMark] as number, eLo = lo < 0 ? 0 : envelope(MARKS[lo] as SplitMark), tHi = known[MARKS[hi] as SplitMark] as number, eHi = envelope(MARKS[hi] as SplitMark);
    out[m] = tLo + (tHi - tLo) * (envelope(m) - eLo) / Math.max(1e-9, eHi - eLo);
  });
  return out;
}

/** a monotone cubic through (time, distance) points with a given slope at both ends (Fritsch-Carlson): smooth, and the car never goes backwards */
export function monotoneCurve(ts: number[], xs: number[], startSlope: number, endSlope: number): (t: number) => { x: number; v: number } {
  const n = ts.length, h: number[] = [], d: number[] = [];
  for (let i = 0; i < n - 1; i++) { h.push(ts[i + 1]! - ts[i]!); d.push((xs[i + 1]! - xs[i]!) / h[i]!); }
  const m: number[] = new Array(n).fill(0);
  m[0] = startSlope; m[n - 1] = endSlope;
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1]! * d[i]! <= 0 ? 0 : 3 * (h[i - 1]! + h[i]!) / ((2 * h[i]! + h[i - 1]!) / d[i - 1]! + (h[i]! + 2 * h[i - 1]!) / d[i]!);
  // keep each slope within three times its neighbouring average speeds so the curve stays monotone
  for (let i = 0; i < n - 1; i++) { m[i] = Math.min(m[i]!, 3 * d[i]!); m[i + 1] = Math.min(m[i + 1]!, 3 * d[i]!); }
  return (t: number) => {
    if (t <= ts[0]!) return { x: xs[0]!, v: m[0]! };
    if (t >= ts[n - 1]!) return { x: xs[n - 1]! + m[n - 1]! * (t - ts[n - 1]!), v: m[n - 1]! };
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ts[mid]! <= t) lo = mid; else hi = mid; }
    const u = (t - ts[lo]!) / h[lo]!, u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    const x = h00 * xs[lo]! + h10 * h[lo]! * m[lo]! + h01 * xs[lo + 1]! + h11 * h[lo]! * m[lo + 1]!;
    const v = ((6 * u2 - 6 * u) * xs[lo]! + (3 * u2 - 4 * u + 1) * h[lo]! * m[lo]! + (-6 * u2 + 6 * u) * xs[lo + 1]! + (3 * u2 - 2 * u) * h[lo]! * m[lo + 1]!) / h[lo]!;
    return { x, v: Math.max(0, v) };
  };
}

/** the ghost of a leader, or null when the record cannot make a valid one */
export function buildLeaderGhost(rec: LeaderRecord): DragGhost | null {
  const G = LEADERBOARD_GHOST;
  if (!(rec.splits.quarter > 0) || rec.splits.quarter > G.maxSeconds - 2) return null;
  const marks = completeSplits(rec), quarter = marks.quarter, reaction = clamp(Number.isFinite(rec.reactionTime) ? rec.reactionTime : 0.07, 0, 0.5);
  const trapMs = rec.trapSpeed > 0 ? rec.trapSpeed * MPH_TO_MS : DRAG.marks.quarter / quarter * 1.25;
  // the launch curve: from the line, through every mark, to the trap speed at the quarter
  const ts = [0, ...MARKS.map(m => marks[m])], xs = [0, ...MARKS.map(m => DRAG.marks[m])];
  const curve = monotoneCurve(ts, xs, 0, trapMs);
  // the lane drift: a few seeded waves that build up after the launch, so the same leader wanders the same way every time
  const rng = createRng(rec.seed), phases = G.driftHz.map(() => rng.range(0, Math.PI * 2)), strength = G.driftMetres * rng.range(0.6, 1);
  const driftAt = (tau: number): { y: number; dy: number } => {
    const ramp = smooth(tau / G.driftRamp); let y = 0, dy = 0;
    G.driftHz.forEach((hz, i) => { const w = (G.driftWeight[i] ?? 0) * strength, a = 2 * Math.PI * hz; y += w * Math.sin(a * tau + (phases[i] as number)); dy += w * a * Math.cos(a * tau + (phases[i] as number)); });
    return { y: y * ramp, dy: dy * ramp };
  };
  const rollTime = stageRolloutTime(false), stageX = -DRAG.stageRollout, rollStart = reaction - rollTime, firstT = rollStart - G.stagingLead, endTau = quarter + G.tail;
  const at = (t: number): GhostSample => {
    if (t >= reaction) {
      const tau = t - reaction, c = curve(tau), { y, dy } = driftAt(tau);
      return { t, x: c.x, y, psi: clamp(dy / Math.max(8, c.v), -0.2, 0.2), v: c.v };
    }
    if (t >= rollStart) { const f = (t - rollStart) / rollTime; return { t, x: stageX * (1 - f), y: 0, psi: 0, v: -stageX / rollTime }; }
    // the canned staging: a slow settle up to the beam from a little behind it, then still
    const settle = smooth((t - firstT) / Math.max(0.1, G.stagingLead - 0.6));
    return { t, x: stageX - G.stagingBack * (1 - settle), y: 0, psi: 0, v: 0 };
  };
  const times = new Set<number>([firstT, rollStart, reaction, reaction + quarter + G.tail]);
  for (let t = Math.ceil(firstT / G.step) * G.step; t < reaction + endTau; t += G.step) times.add(Math.round(t * 1e6) / 1e6);
  for (const m of MARKS) times.add(reaction + marks[m]);
  const samples = [...times].sort((a, b) => a - b).map(at);
  const ghost = cleanDragGhost({ car: 'leader', name: rec.name.slice(0, 20) || 'CLASS LEADER', reaction, marks, trap: trapMs * 3.6, total: reaction + quarter, samples });
  // (rounding can leave a negative zero: make it a plain zero so a ghost compares equal to itself and to a saved copy)
  return ghost && { ...ghost, samples: ghost.samples.map(s => ({ t: s.t + 0, x: s.x + 0, y: s.y + 0, psi: s.psi + 0, v: s.v + 0 })) };
}
