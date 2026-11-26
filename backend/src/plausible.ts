// SCORE-AWARE PLAUSIBILITY: for a class and a benchmark score, the quarter-mile times and speeds an honest run can have.
// Pure TypeScript, no imports from the game. The class-wide bounds in classes.ts stay as the outer limit; this window sits inside them,
// so a weak card cannot claim a high-end card's run (a score-1000 discrete card cannot post 3.7 s).
//
// THE TABLE comes from the game's physics: the perfect-driver prediction on the ranked class day with the DEFAULT tune
// (docs/CALIBRATION.md, tests/calibration.test.mjs). tests/score-bounds.test.mjs sweeps both classes densely with the default tune and a good tune and fails
// if the physics ever leaves the window, so this table cannot drift from the physics unnoticed. After a physics change, copy the new rows from
// `PRINT_ET_TABLE=1 node --test tests/calibration.test.mjs` (or the sweep in the score-bounds test) into SCORE_CURVE.

import { CLASS_BOUNDS, CLASS_SCORE_CAP, type ClassId } from './classes';

/** one knot of the curve: the score, then what the default tune gives on the ranked day (ET s, trap mph, 60 ft s, 1/8 mile s) */
type Knot = readonly [score: number, et: number, trapMph: number, ft60: number, eighth: number];

/** integrated: 0 to 8000 in steps of 800; discrete: 0 to 10000 in steps of 1000 (default tune, ranked class day) */
export const SCORE_CURVE: Record<ClassId, readonly Knot[]> = {
  integrated: [
    [0, 12.33, 106.1, 2.27, 7.91], [800, 11.92, 109.8, 2.18, 7.64], [1600, 11.55, 113.0, 2.10, 7.39], [2400, 11.24, 116.3, 2.04, 7.20],
    [3200, 10.90, 119.9, 1.97, 6.96], [4000, 10.58, 123.8, 1.91, 6.77], [4800, 10.31, 127.0, 1.86, 6.60], [5600, 10.07, 130.1, 1.82, 6.44],
    [6400, 9.85, 133.0, 1.78, 6.30], [7200, 9.62, 136.2, 1.73, 6.14], [8000, 9.44, 138.9, 1.70, 6.04],
  ],
  discrete: [
    [0, 6.94, 184.5, 1.19, 4.40], [1000, 6.23, 205.7, 1.05, 3.94], [2000, 5.74, 224.1, 0.97, 3.63], [3000, 5.34, 241.8, 0.91, 3.38],
    [4000, 5.01, 259.1, 0.86, 3.18], [5000, 4.76, 274.6, 0.84, 3.03], [6000, 4.56, 288.8, 0.82, 2.91], [7000, 4.38, 302.6, 0.81, 2.81],
    [8000, 4.24, 314.1, 0.80, 2.73], [9000, 4.12, 326.7, 0.80, 2.66], [10000, 4.03, 338.5, 0.80, 2.61],
  ],
};

/** The allowances for what honest players vary, in seconds unless noted. They are added to the default-tune curve. */
export const PLAUSIBLE_TOLERANCE = {
  /** the most a fully tuned car can be quicker than the default tune: a search of every tune setting (tests/score-bounds.test.mjs, docs/CALIBRATION.md) gains 1.03 to 1.27 s on integrated and 0.27 to 0.66 s on discrete, so the allowance sits just above that.
   *  A tight allowance rejects honest, well-tuned runs, so it is per class. */
  goodTune: { integrated: 1.3, discrete: 0.7 } as Record<ClassId, number>,
  /** room for a small physics change before the table is refreshed */
  physicsMargin: 0.1,
  /** autopilot is about this much slower than a manual run; it only matters on the slow side */
  autopilot: 0.12,
  /** the ranked day is fixed, so no weather allowance on the fast side. Slow side: a clumsy but honest drive may be this much slower than the curve (share, then seconds) */
  slowShare: 0.25,
  slowExtra: 1.5,
  /** trap speed: a mistimed shift or a bad launch traps lower, a good tune a little higher (share, then mph) */
  trapLowShare: 0.25,
  trapHighShare: 0.1,
  trapExtraMph: 5,
  /** floors for 60 ft and 1/8 mile as a share of the default time, minus a little (a full tune cuts the 60 ft by up to about 24 percent and the eighth by up to about 15 percent) */
  ft60Share: 0.7,
  eighthShare: 0.8,
  floorExtra: 0.05,
} as const;

export interface PlausibleWindow {
  /** the fastest and slowest believable quarter-mile ET (s) */
  minEt: number;
  maxEt: number;
  /** the believable trap speed window (mph) */
  minTrapMph: number;
  maxTrapMph: number;
  /** the quickest believable 60 ft and 1/8 mile elapsed times (s) */
  minFt60: number;
  minEighth: number;
}

/** linear interpolation along the curve; a score outside it uses the nearest end */
function curveAt(knots: readonly Knot[], score: number): { et: number; trap: number; ft60: number; eighth: number } {
  const s = Math.min(Math.max(score, knots[0][0]), knots[knots.length - 1][0]);
  let i = 1;
  while (i < knots.length - 1 && knots[i][0] < s) i++;
  const a = knots[i - 1], b = knots[i], u = b[0] === a[0] ? 0 : (s - a[0]) / (b[0] - a[0]);
  const mix = (k: 1 | 2 | 3 | 4) => a[k] + (b[k] - a[k]) * u;
  return { et: mix(1), trap: mix(2), ft60: mix(3), eighth: mix(4) };
}

/** the plausible window for a class and benchmark score; the class-wide bounds (CLASS_BOUNDS) are applied on top as the outer limit */
export function plausibleWindow(cls: ClassId, benchmarkScore: number): PlausibleWindow {
  const t = PLAUSIBLE_TOLERANCE, bounds = CLASS_BOUNDS[cls];
  const c = curveAt(SCORE_CURVE[cls], Math.min(Math.max(benchmarkScore, 0), CLASS_SCORE_CAP[cls]));
  return {
    minEt: Math.max(bounds.minQuarterEt, c.et - t.goodTune[cls] - t.physicsMargin),
    maxEt: Math.min(bounds.maxQuarterEt, c.et * (1 + t.slowShare) + t.slowExtra + t.autopilot),
    minTrapMph: Math.max(bounds.minTrapSpeed, c.trap * (1 - t.trapLowShare)),
    maxTrapMph: Math.min(bounds.maxTrapSpeed, c.trap * (1 + t.trapHighShare) + t.trapExtraMph),
    minFt60: c.ft60 * t.ft60Share - t.floorExtra,
    minEighth: c.eighth * t.eighthShare - t.floorExtra,
  };
}

/** null when the run is plausible for the score, otherwise a clear reason (used as the 422 message) */
export function implausibleReason(cls: ClassId, benchmarkScore: number, run: { quarter: number; ft60: number; eighth: number; trapSpeed: number }): string | null {
  const w = plausibleWindow(cls, benchmarkScore), score = Math.round(benchmarkScore), f = (n: number) => n.toFixed(2);
  const who = `a card of class ${cls} with benchmark score ${score}`;
  if (run.quarter < w.minEt) return `quarter ET ${f(run.quarter)} s is faster than plausible for ${who} (fastest ${f(w.minEt)} s)`;
  if (run.quarter > w.maxEt) return `quarter ET ${f(run.quarter)} s is slower than plausible for ${who} (slowest ${f(w.maxEt)} s)`;
  if (run.trapSpeed < w.minTrapMph || run.trapSpeed > w.maxTrapMph)
    return `trap speed ${run.trapSpeed.toFixed(0)} mph is outside ${w.minTrapMph.toFixed(0)}-${w.maxTrapMph.toFixed(0)} mph for ${who}`;
  if (run.ft60 < w.minFt60) return `60 ft time ${f(run.ft60)} s is faster than plausible for ${who} (fastest ${f(w.minFt60)} s)`;
  if (run.eighth < w.minEighth) return `1/8 mile time ${f(run.eighth)} s is faster than plausible for ${who} (fastest ${f(w.minEighth)} s)`;
  return null;
}
