// WHERE THE CAR'S NUMBERS COME FROM. Every race and every tune screen asks this one file for the car's spec.
//
// With no benchmark result the car gets the WEAKEST spec (WEAKEST_RESULT). With one, the SCORE sets the engine:
// peak torque, the revs where it peaks, the limiter, and the SHAPE of the torque curve. The stock parts (STOCK_PARTS) are the same for everyone, so the score (and the class limits) are what make one car stronger than another.
// The torque range stops near 1500 Nm on purpose: the dragster's grip is the limit past that, and with the default tune more torque only adds wheelspin (checked in tests/benchmark.test.mjs: a higher score is never slower with the default tune).
// Everything here is a pure function of the saved result: the same result in gives the same spec out.
import { DRAG_CARS, STOCK_PARTS } from './data.ts';
import { specFor } from './tune.ts';
import { CLUTCH_MANAGER } from './physics.ts';
import { isClassId, eraOf, type ClassId, type Era } from '../classes.ts';
import type { BenchmarkResult } from '../save.ts';
import type { DragCarDef, DragSpec, TorqueCurve } from './types.ts';
import { BENCHMARK } from '../benchmark/constants.ts';
import { classScoreCap } from '../benchmark/score.ts';

/** the one car of the game */
export const STOCK_CAR: DragCarDef = DRAG_CARS[0] as DragCarDef;
/** the launch rpm a GPU Wars car starts at, as a share of the revs where its torque peaks (the slipping clutch holds the engine in its power band; a little higher still is quicker, so tuning it pays) */
export const LAUNCH_RPM_SHARE = 0.8;
/** the stock dragster: the top level of every part, a fresh clutch unless told otherwise */
export const stockSpec = (clutchCondition = 1): DragSpec => { const plain = specFor(STOCK_CAR, STOCK_PARTS, clutchCondition); return { ...plain, topFuel: true, grip: plain.grip * CLUTCH_MANAGER.gripGain, cda: plain.cda * CLUTCH_MANAGER.dragGain }; };

/** horsepower from torque (Nm) and revs: hp = Nm x rpm / 7127 */
export const HP_DIVISOR = 7127;

/** SCORE -> ENGINE, in two steps, so every class has a LOT of room and the score still matters inside it.
 * 1. The score is first taken as a share of what the class can score at most (`classScoreCap`): 0 is the slowest card of the class, 1 its fastest.
 * 2. `BENCHMARK_TO_SPEC` turns that share into where in the class's window the engine sits (torque share, limiter share, and the revs where torque peaks as a share of the limiter), blended in a straight line between rows.
 * `CLASS_SPEC_LIMITS` is the window itself: the peak torque (Nm) and the limiter (rpm) at the bottom and the top of the class. Turn the WINDOWS first (they set each class's ET range), then this table (how the score spreads inside the window). docs/CALIBRATION.md has the ET each window gives. */
export const BENCHMARK_TO_SPEC: readonly { share: number; torqueShare: number; peakShare: number; redlineShare: number }[] = [
  { share: 0, torqueShare: 0, peakShare: 0.735, redlineShare: 0 },
  { share: 0.25, torqueShare: 0.22, peakShare: 0.75, redlineShare: 0.3 },
  { share: 0.5, torqueShare: 0.48, peakShare: 0.765, redlineShare: 0.58 },
  { share: 0.75, torqueShare: 0.74, peakShare: 0.78, redlineShare: 0.82 },
  { share: 1, torqueShare: 1, peakShare: 0.79, redlineShare: 1 },
];
/** how far sustain moves the torque peak: a sustained card peaks this much higher in the revs than an even one, a burst card this much lower (rpm at the two ends: sustain 1 and 0) */
export const SUSTAIN_PEAK_SHIFT_RPM = 1400;
/** the most the torque peak may sit below the limiter, and the least (rpm) */
export const PEAK_BELOW_LIMITER = { min: 1000, maxShare: 0.55 } as const;

/** what a class may have: the torque and the limiter must stay inside these, whatever the score says (an anti-cheat bound as well as the class's window). The first number of each pair is the slowest card of the class, the second the fastest. */
export interface SpecLimits { torqueNm: [number, number]; redline: [number, number] }
export const CLASS_SPEC_LIMITS: Record<'integrated' | Era, SpecLimits> = {
  integrated: { torqueNm: [360, 575], redline: [6400, 7400] },
  retro: { torqueNm: [1400, 2000], redline: [7400, 8000] },
  classic: { torqueNm: [1950, 2850], redline: [7600, 8500] },
  modern: { torqueNm: [2800, 4200], redline: [7900, 8900] },
  current: { torqueNm: [4650, 6500], redline: [8300, 9400] },
};
export const specLimitsOf = (cls: ClassId): SpecLimits => CLASS_SPEC_LIMITS[eraOf(cls) ?? 'integrated'];

/** the car that skipped the benchmark races with this share of the slowest card's torque, so it is slower than any benchmarked car */
export const UNBENCHMARKED_TORQUE_SHARE = 0.9;

/** THE DEFAULT FINAL DRIVE for an engine: a weak engine wants short gearing to launch (a big number), a strong one tall gearing so it does not run out of revs. Rows of (peak torque, final drive), blended in a straight line in the log of the torque. The best final drive for a card is a little different (the tune screen pays for finding it). */
export const DEFAULT_FINAL_DRIVE: readonly (readonly [number, number])[] = [[400, 4.5], [1700, 3.8], [2500, 3.55], [3500, 3.35], [5500, 3.05]];
export function finalDriveFor(torqueNm: number): number {
  const t = DEFAULT_FINAL_DRIVE, x = Math.log(Math.max(1, torqueNm));
  for (let i = 1; i < t.length; i++) {
    const a = t[i - 1]!, b = t[i]!;
    if (x <= Math.log(b[0])) return Math.round(mix(a[1], b[1], clamp((x - Math.log(a[0])) / (Math.log(b[0]) - Math.log(a[0])), 0, 1)) * 20) / 20;
  }
  return (t[t.length - 1] as readonly [number, number])[1];
}

/** how steady a card is taken to be when the result has no measured `sustain`: built-in graphics throttle and burst, a separate card holds its speed */
export const SUSTAIN_BY_KIND = { integrated: 0.3, discrete: 0.7 } as const;

/** the two ends of the curve shape. BURST: torque comes early and falls away (punchy low and mid revs). SUSTAINED: torque builds slowly and stays up to the limiter (broad, high revs). Both share the same x points so a blend is a straight mix of the heights. */
export const CURVE_BURST: TorqueCurve = {
  rise: [[0, 0.7], [0.25, 0.88], [0.5, 0.96], [0.75, 0.99], [1, 1]],
  fall: [[0, 1], [0.4, 0.88], [0.7, 0.7], [1, 0.52]],
};
export const CURVE_SUSTAINED: TorqueCurve = {
  rise: [[0, 0.42], [0.25, 0.64], [0.5, 0.82], [0.75, 0.94], [1, 1]],
  fall: [[0, 1], [0.4, 0.99], [0.7, 0.96], [1, 0.9]],
};
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
const blendPoints = (a: TorqueCurve['rise'], b: TorqueCurve['rise'], k: number): [number, number][] => a.map((p, i) => [p[0], +mix(p[1], (b[i] as readonly [number, number])[1], k).toFixed(4)]);
/** the torque curve for a sustain from 0 (burst) to 1 (sustained) */
export function curveForSustain(sustain: number): TorqueCurve {
  const k = clamp(Number.isFinite(sustain) ? sustain : 0.5, 0, 1);
  return { rise: blendPoints(CURVE_BURST.rise, CURVE_SUSTAINED.rise, k), fall: blendPoints(CURVE_BURST.fall, CURVE_SUSTAINED.fall, k) };
}

/** the row of the table for a share of the class's top score: a straight-line blend between the two rows around it (the share is first kept to 0..1) */
export function tableRowFor(share: number): { torqueShare: number; peakShare: number; redlineShare: number } {
  const x = clamp(Number.isFinite(share) ? share : 0, 0, 1), t = BENCHMARK_TO_SPEC;
  for (let i = 1; i < t.length; i++) {
    const a = t[i - 1]!, b = t[i]!;
    if (x <= b.share) { const k = (x - a.share) / Math.max(1e-9, b.share - a.share); return { torqueShare: mix(a.torqueShare, b.torqueShare, k), peakShare: mix(a.peakShare, b.peakShare, k), redlineShare: mix(a.redlineShare, b.redlineShare, k) }; }
  }
  const last = t[t.length - 1]!; return { torqueShare: last.torqueShare, peakShare: last.peakShare, redlineShare: last.redlineShare };
}

/** how steady this result says the card is (0 burst, 1 sustained): the measured value, else the class's usual */
export const sustainOf = (b: BenchmarkResult): number => (typeof b.sustain === 'number' && Number.isFinite(b.sustain) ? clamp(b.sustain, 0, 1) : b.class === 'integrated' ? SUSTAIN_BY_KIND.integrated : SUSTAIN_BY_KIND.discrete);

/** the weakest result there can be: score 0 in the integrated class. A player who has not benchmarked races with this, so no one is better off for skipping the benchmark. */
export const WEAKEST_RESULT: BenchmarkResult = { score: 0, class: 'integrated', benchmarkVersion: BENCHMARK.version, gpuId: 'none', date: 0 };

/** the car to race for this save's benchmark result. With no result (or one that is not believable) it is the WEAKEST spec, never stronger than any benchmarked car. Deterministic: same result in, same spec out. */
export function specForBenchmark(benchmark: BenchmarkResult | null, clutchCondition = 1): DragSpec {
  const valid = !!benchmark && isClassId(benchmark.class), result = valid ? benchmark! : WEAKEST_RESULT;
  const cls = result.class as ClassId, stock = stockSpec(clutchCondition), limits = specLimitsOf(cls), row = tableRowFor(result.score / Math.max(1, classScoreCap(cls))), sustain = sustainOf(result);
  const redline = Math.round(mix(limits.redline[0], limits.redline[1], row.redlineShare) / 50) * 50;
  const peakWanted = redline * row.peakShare + (sustain - 0.5) * SUSTAIN_PEAK_SHIFT_RPM;
  const peakRpm = Math.round(clamp(peakWanted, redline * PEAK_BELOW_LIMITER.maxShare, redline - PEAK_BELOW_LIMITER.min) / 50) * 50;
  const torque = Math.round(mix(limits.torqueNm[0], limits.torqueNm[1], row.torqueShare) * (valid ? 1 : UNBENCHMARKED_TORQUE_SHARE));
  return { ...stock, torque, peakRpm, redline, curve: curveForSustain(sustain) };
}
