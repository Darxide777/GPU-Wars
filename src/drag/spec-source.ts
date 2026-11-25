// WHERE THE CAR'S NUMBERS COME FROM. Every race and every tune screen asks this one file for the car's spec.
//
// With no benchmark result the stock dragster races as it is (so the game plays before the benchmark is run). With one, the SCORE sets the engine:
// peak torque, the revs where it peaks, the limiter, and the SHAPE of the torque curve. The stock parts (STOCK_PARTS) are the same for everyone, so the score (and the class limits) are what make one car stronger than another.
// The torque range stops near 1500 Nm on purpose: the dragster's grip is the limit past that, and with the default tune more torque only adds wheelspin (checked in tests/benchmark.test.mjs: a higher score is never slower with the default tune).
// Everything here is a pure function of the saved result: the same result in gives the same spec out.
import { DRAG_CARS, STOCK_PARTS } from './data.ts';
import { specFor } from './tune.ts';
import { isClassId, eraOf, type ClassId, type Era } from '../classes.ts';
import type { BenchmarkResult } from '../save.ts';
import type { DragCarDef, DragSpec, TorqueCurve } from './types.ts';
import { BENCHMARK } from '../benchmark/constants.ts';

/** the one car of the game */
export const STOCK_CAR: DragCarDef = DRAG_CARS[0] as DragCarDef;
/** the stock dragster: the top level of every part, a fresh clutch unless told otherwise */
export const stockSpec = (clutchCondition = 1): DragSpec => specFor(STOCK_CAR, STOCK_PARTS, clutchCondition);

/** horsepower from torque (Nm) and revs: hp = Nm x rpm / 7127 */
export const HP_DIVISOR = 7127;

/** SCORE -> ENGINE. Each row is what a card of that score gets when it is "even" (sustain 0.5): peak torque (Nm), the revs where torque peaks and the limiter. Between rows the numbers are blended in a straight line. Turn this table first. */
export const BENCHMARK_TO_SPEC: readonly { score: number; torqueNm: number; peakRpm: number; redline: number }[] = [
  { score: 0, torqueNm: 600, peakRpm: 5000, redline: 6800 },
  { score: 2000, torqueNm: 800, peakRpm: 5500, redline: 7400 },
  { score: 4000, torqueNm: 1000, peakRpm: 6000, redline: 8000 },
  { score: 6000, torqueNm: 1200, peakRpm: 6500, redline: 8500 },
  { score: 8000, torqueNm: 1350, peakRpm: 7000, redline: 9000 },
  { score: 10000, torqueNm: 1500, peakRpm: 7400, redline: 9400 },
];
/** how far sustain moves the torque peak: a sustained card peaks this much higher in the revs than an even one, a burst card this much lower (rpm at the two ends: sustain 1 and 0) */
export const SUSTAIN_PEAK_SHIFT_RPM = 1400;
/** the most the torque peak may sit below the limiter, and the least (rpm) */
export const PEAK_BELOW_LIMITER = { min: 1000, maxShare: 0.55 } as const;

/** what a class may have: the torque and the limiter must stay inside these, whatever the score says (an anti-cheat bound as well as a balance) */
export interface SpecLimits { torqueNm: [number, number]; redline: [number, number] }
export const CLASS_SPEC_LIMITS: Record<'integrated' | Era, SpecLimits> = {
  integrated: { torqueNm: [600, 1000], redline: [6600, 8000] },
  retro: { torqueNm: [650, 1100], redline: [6800, 8200] },
  classic: { torqueNm: [700, 1250], redline: [7000, 8600] },
  modern: { torqueNm: [800, 1400], redline: [7200, 9000] },
  current: { torqueNm: [900, 1500], redline: [7400, 9400] },
};
export const specLimitsOf = (cls: ClassId): SpecLimits => CLASS_SPEC_LIMITS[eraOf(cls) ?? 'integrated'];

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

/** the row of the table for a score: a straight-line blend between the two rows around it (the score is first kept to 0 and the highest score) */
export function tableRowFor(score: number): { torqueNm: number; peakRpm: number; redline: number } {
  const s = clamp(Number.isFinite(score) ? score : 0, 0, BENCHMARK.maxScore), t = BENCHMARK_TO_SPEC;
  for (let i = 1; i < t.length; i++) {
    const a = t[i - 1]!, b = t[i]!;
    if (s <= b.score) { const k = (s - a.score) / Math.max(1, b.score - a.score); return { torqueNm: mix(a.torqueNm, b.torqueNm, k), peakRpm: mix(a.peakRpm, b.peakRpm, k), redline: mix(a.redline, b.redline, k) }; }
  }
  const last = t[t.length - 1]!; return { torqueNm: last.torqueNm, peakRpm: last.peakRpm, redline: last.redline };
}

/** how steady this result says the card is (0 burst, 1 sustained): the measured value, else the class's usual */
export const sustainOf = (b: BenchmarkResult): number => (typeof b.sustain === 'number' && Number.isFinite(b.sustain) ? clamp(b.sustain, 0, 1) : b.class === 'integrated' ? SUSTAIN_BY_KIND.integrated : SUSTAIN_BY_KIND.discrete);

/** the car to race for this save's benchmark result (null: the benchmark has not been run, so the stock dragster). Deterministic: same result in, same spec out. */
export function specForBenchmark(benchmark: BenchmarkResult | null, clutchCondition = 1): DragSpec {
  const stock = stockSpec(clutchCondition);
  if (!benchmark || !isClassId(benchmark.class)) return stock;
  const limits = specLimitsOf(benchmark.class), row = tableRowFor(benchmark.score), sustain = sustainOf(benchmark);
  const redline = Math.round(clamp(row.redline, limits.redline[0], limits.redline[1]) / 50) * 50;
  const peakWanted = row.peakRpm + (sustain - 0.5) * SUSTAIN_PEAK_SHIFT_RPM;
  const peakRpm = Math.round(clamp(peakWanted, redline * PEAK_BELOW_LIMITER.maxShare, redline - PEAK_BELOW_LIMITER.min) / 50) * 50;
  const torque = Math.round(clamp(row.torqueNm, limits.torqueNm[0], limits.torqueNm[1]));
  return { ...stock, torque, peakRpm, redline, curve: curveForSustain(sustain) };
}
