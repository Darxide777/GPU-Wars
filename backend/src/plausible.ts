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


// ====================================================================================================================================================
// FORMULA MODE: THE ONE TABLE OF FORMULA NUMBERS.
//
// CALIBRATED (phase 3) against the formula simulation, the way SCORE_CURVE above is for Drag: the lap time and top speed of a perfect driver (the autopilot) on BEACH with the DEFAULT tune, by benchmark score
// (docs/CALIBRATION.md, "Formula lap times"; `PRINT_LAP_TABLE=1 node --test tests/formula-calibration.test.mjs` prints the rows). tests/formula-calibration.test.mjs sweeps every score densely with the default tune, a good tune and the
// extreme tunes and fails if a lap or top speed leaves the window, so this table cannot drift from the physics unnoticed. After a physics or constants change, copy the new rows from the printed table.
// NOT YET VALIDATED ON REAL HARDWARE: the owner's Radeon 8060S (benchmark score about 5005) and S24 Ultra (1302) are the two measured scores; the discrete scores are still estimates (the card rates are placeholders).
// To re-calibrate: change only this table (and the track length); nothing else in the formula checks has a number in it.
// ====================================================================================================================================================

/** one knot of a formula curve: the benchmark score, the lap time (s) and the top speed (mph) the default tune gives */
type FormulaKnot = readonly [score: number, lapS: number, topMph: number];

export const FORMULA_LAP_TABLE = {
  /** true: the numbers below come from the simulation (phase 3). false would mean guesses. */
  calibrated: true,
  /** false until the owner's real cards (the 8060S and the S24 Ultra) have been raced for these laps; the ranges below are generous enough to survive a small difference */
  hardwareValidated: false,
  /** the length of one lap per track, in metres (used to compare the lap time with the top speed) */
  trackLengthM: { beach: 4828 } as Record<string, number>,
  /** the outer limits of a ranked lap per class (like CLASS_BOUNDS for drag): the fastest and slowest lap (s) and the top speed window (mph). The fast limit sits a little outside the best card's best tune and a driver 3 percent better than the autopilot (integrated 43.3 s at the cap with a good tune, discrete 37.2 s). */
  outer: {
    integrated: { minLapS: 41.5, maxLapS: 200, minTopMph: 60, maxTopMph: 300 },
    discrete: { minLapS: 35.5, maxLapS: 200, minTopMph: 60, maxTopMph: 340 },
  } as Record<ClassId, { minLapS: number; maxLapS: number; minTopMph: number; maxTopMph: number }>,
  /** lap time and top speed for a default-tune car by benchmark score, linear between knots (a strong card is a quick car). Integrated is scored 0 to 8000, discrete 0 to 10000. The knots are the same scores as `FORMULA_SCORE_TO_ENGINE` (src/formula/car.ts): the 1302 row is the S24 Ultra, the 5005 row the Radeon 8060S. */
  curve: {
    integrated: [[0, 55.02, 198], [650, 53.0, 206], [1302, 51.0, 214], [3000, 49.18, 222], [5005, 47.0, 232], [6500, 45.78, 238], [8000, 44.5, 245]],
    discrete: [[0, 43.0, 254], [2000, 40.95, 267], [4000, 39.68, 275], [6000, 38.9, 281], [8000, 38.37, 285], [10000, 38.0, 288]],
  } as Record<ClassId, readonly FormulaKnot[]>,
  /** the allowances around the curve */
  tolerance: {
    /** fastest lap = curve lap x (1 - this): the best tune is worth up to about 3.7 percent of the lap (a full search, weakest cards most), and a driver may beat the autopilot's line by about 3 percent */
    fastShare: 0.07,
    /** slowest lap = curve lap x (1 + share) + seconds: a clumsy but honest drive */
    slowShare: 0.4, slowExtra: 10,
    /** top speed window: lowest = curve x (1 - low share); highest = curve x (1 + high share) + mph (the extreme tunes: no downforce adds about 4 percent, three bottles of nitro about 6 percent for a moment) */
    topLowShare: 0.3, topHighShare: 0.12, topExtraMph: 5,
    /** the end of sector 1 as a share of the lap time, and the end of sector 2 as a share of the lap time */
    sector1Share: [0.15, 0.5], sector2Share: [0.45, 0.85],
    /** the lap's average speed must not beat the top speed by more than this (mph) and must be at least this share of it */
    averageOverTopMph: 2, averageMinShare: 0.2,
  },
  /** the ghost of a formula lap: [seconds, distance along the lap in metres] pairs, at most this long */
  ghost: { maxSeconds: 240, maxDistanceM: 20000 },
} as const;

export interface FormulaWindow {
  /** the fastest and slowest believable lap time (s) */
  minLapS: number;
  maxLapS: number;
  /** the believable top speed window (mph) */
  minTopMph: number;
  maxTopMph: number;
}

/** the default-tune lap time (s) and top speed (mph) the table gives a class and score: straight lines between knots, a score outside the class's range uses its nearest end */
export function formulaCurveAt(cls: ClassId, benchmarkScore: number): { lap: number; top: number } {
  const knots = FORMULA_LAP_TABLE.curve[cls];
  const score = Math.min(Math.max(Number.isFinite(benchmarkScore) ? benchmarkScore : 0, knots[0][0]), Math.min(CLASS_SCORE_CAP[cls], knots[knots.length - 1][0]));
  let i = 1;
  while (i < knots.length - 1 && knots[i][0] < score) i++;
  const a = knots[i - 1], b = knots[i], u = b[0] === a[0] ? 0 : (score - a[0]) / (b[0] - a[0]);
  return { lap: a[1] + (b[1] - a[1]) * u, top: a[2] + (b[2] - a[2]) * u };
}

/** the formula window for a class and benchmark score (see FORMULA_LAP_TABLE); the outer limits are applied on top */
export function formulaWindow(cls: ClassId, benchmarkScore: number): FormulaWindow {
  const t = FORMULA_LAP_TABLE.tolerance, outer = FORMULA_LAP_TABLE.outer[cls], { lap, top } = formulaCurveAt(cls, benchmarkScore);
  return {
    minLapS: Math.max(outer.minLapS, lap * (1 - t.fastShare)),
    maxLapS: Math.min(outer.maxLapS, lap * (1 + t.slowShare) + t.slowExtra),
    minTopMph: Math.max(outer.minTopMph, top * (1 - t.topLowShare)),
    maxTopMph: Math.min(outer.maxTopMph, top * (1 + t.topHighShare) + t.topExtraMph),
  };
}

/** null when a formula lap is plausible for the score, otherwise a clear reason (the 422 message). Checks the lap time, the top speed, how the sectors share the lap, and lap average speed against top speed. */
export function formulaImplausibleReason(cls: ClassId, benchmarkScore: number, track: string, run: { sector1: number; sector2: number; lap: number; topSpeed: number }): string | null {
  const w = formulaWindow(cls, benchmarkScore), t = FORMULA_LAP_TABLE.tolerance, score = Math.round(benchmarkScore), f = (n: number) => n.toFixed(2);
  const who = `a card of class ${cls} with benchmark score ${score}`;
  if (run.lap < w.minLapS) return `lap time ${f(run.lap)} s is faster than plausible for ${who} (fastest ${f(w.minLapS)} s)`;
  if (run.lap > w.maxLapS) return `lap time ${f(run.lap)} s is slower than plausible for ${who} (slowest ${f(w.maxLapS)} s)`;
  if (run.topSpeed < w.minTopMph || run.topSpeed > w.maxTopMph)
    return `top speed ${run.topSpeed.toFixed(0)} mph is outside ${w.minTopMph.toFixed(0)}-${w.maxTopMph.toFixed(0)} mph for ${who}`;
  const s1 = run.sector1 / run.lap, s2 = run.sector2 / run.lap;
  if (s1 < t.sector1Share[0] || s1 > t.sector1Share[1]) return `sector 1 (${f(run.sector1)} s) is not a believable share of a ${f(run.lap)} s lap`;
  if (s2 < t.sector2Share[0] || s2 > t.sector2Share[1]) return `sector 2 (${f(run.sector2)} s) is not a believable share of a ${f(run.lap)} s lap`;
  const lengthM = FORMULA_LAP_TABLE.trackLengthM[track];
  if (lengthM) {
    const averageMph = (lengthM / run.lap) * 2.236936;
    if (averageMph > run.topSpeed + t.averageOverTopMph || averageMph < run.topSpeed * t.averageMinShare)
      return `top speed ${run.topSpeed.toFixed(0)} mph does not fit a ${f(run.lap)} s lap (average ${averageMph.toFixed(0)} mph)`;
  }
  return null;
}
