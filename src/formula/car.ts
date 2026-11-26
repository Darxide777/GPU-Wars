// The Formula car with no screen: its stock parts, its tune and how the two (and the benchmark) become the numbers the driving physics reads. There is no shop: the parts are the TOP level of every part
// (`STOCK_SPEC`), the same for everyone; the benchmark score only sets the engine's power inside the class window (`formulaSpecForBenchmark`, the same idea as src/drag/spec-source.ts).
// Ported from Chromium Halo: Neon's src/race/car.ts (`raceCarStats`, the tune).
import { isClassId, type ClassId } from '../classes.ts';
import { classScoreCap } from '../benchmark/score.ts';
import type { BenchmarkResult } from '../save.ts';
import { cleanSlots, type TuneSlots } from '../tune-slots.ts';
import { BASE, GRIP, NITRO } from './constants.ts';
import type { CarStats, FormulaSpec, FormulaTune } from './types.ts';

/** the parts that matter and the top level of each (the source's RACE_PARTS maxima); the engine's level is a real number so the benchmark can set it finely */
export const PART_MAX = { engine: 8, gearbox: 5, tyres: 6, steering: 5, aero: 5 } as const;
/** the stock car: the top level of every part. Only the engine changes with the benchmark. */
export const STOCK_SPEC: FormulaSpec = { name: 'FORMULA', col: '#21e6ff', trim: '#ff2bd6', engine: PART_MAX.engine, gearbox: PART_MAX.gearbox, tyres: PART_MAX.tyres, steering: PART_MAX.steering, aero: PART_MAX.aero };

export const DEFAULT_FORMULA_TUNE: FormulaTune = { gearing: 0, downforce: 0.5, steering: 0, pressure: 0, nitro: 0, gearbox: 'manual', shiftLight: 0.9 };
/** each setting's range ([lowest, highest]); the nitro is whole bottles */
export const FORMULA_TUNE_LIMITS = { gearing: [-1, 1], downforce: [0, 1], steering: [-1, 1], pressure: [-1, 1], nitro: [0, NITRO.maxBottles], shiftLight: [0.6, 1] } as const satisfies Record<string, readonly [number, number]>;
const clampNumber = (v: unknown, lo: number, hi: number, fallback: number): number => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback; };
/** a tune made safe: every setting in its range (in steps of 0.1, the nitro in whole bottles), the gearbox one of the two, anything missing or not a number put back to the default. Nothing a saved or sent tune holds can make the car faster than the limits allow. */
export function cleanFormulaTune(raw: Partial<FormulaTune> | Record<string, unknown> | null | undefined): FormulaTune {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, out: FormulaTune = { ...DEFAULT_FORMULA_TUNE };
  for (const key of ['gearing', 'downforce', 'steering', 'pressure', 'shiftLight'] as const) { const [lo, hi] = FORMULA_TUNE_LIMITS[key]; out[key] = Math.round(clampNumber(r[key], lo, hi, DEFAULT_FORMULA_TUNE[key]) * 10) / 10; }
  out.nitro = Math.round(clampNumber(r.nitro, FORMULA_TUNE_LIMITS.nitro[0], FORMULA_TUNE_LIMITS.nitro[1], DEFAULT_FORMULA_TUNE.nitro));
  out.gearbox = r.gearbox === 'auto' ? 'auto' : 'manual';
  return out;
}
/** the six tune slots (src/tune-slots.ts) with every tune made safe */
export const cleanFormulaSlots = (raw: unknown): TuneSlots => cleanSlots(raw, t => ({ ...cleanFormulaTune(t) }));
/** one line for every tune row (the tune screen's help text) */
export const FORMULA_TUNE_HELP: Record<keyof FormulaTune, string> = {
  gearing: 'SHORT GEARS PULL HARDER OFF THE LINE; TALL GEARS HAVE A HIGHER TOP SPEED.',
  downforce: 'MORE DOWNFORCE GRIPS THE TURNS HARDER, FOR A LOWER TOP SPEED ON THE STRAIGHTS.',
  steering: 'QUICKER STEERING TURNS IN SHARPER BUT HAS LESS GRIP; SLOWER IS SAFER.',
  pressure: 'SOFT TYRES GRIP MORE; HARD TYRES ROLL FASTER ON THE STRAIGHTS.',
  nitro: 'BOTTLES CARRIED: EACH IS A BURST OF PULL, AND ITS WEIGHT COSTS A LITTLE GRIP.',
  gearbox: 'MANUAL: YOU SHIFT, THE SHIFT LIGHT SAYS WHEN. AUTO: THE CAR SHIFTS FOR YOU AT THE SHIFT LIGHT.',
  shiftLight: 'THE SHARE OF A GEAR\'S REVS AT WHICH THE LIGHT COMES ON (AUTO SHIFTS THERE TOO).',
};

/** the car's numbers for the physics: from its parts and tune (the source game's `raceCarStats`) */
export function carStats(spec: FormulaSpec, tune: FormulaTune): CarStats {
  const t = cleanFormulaTune(tune), E = spec.engine, B = spec.gearbox, Ty = spec.tyres, St = spec.steering, A = spec.aero;
  const nitroWeight = 1 - NITRO.gripPerBottle * t.nitro;
  return {
    aero: t.downforce * (1 + 0.12 * A),
    vmax: BASE.vmax * BASE.vmaxScale * GRIP.speedUp * (1 + 0.05 * E + 0.025 * A) * (1 + 0.08 * t.gearing) * (1 - 0.07 * t.downforce) * (1 + 0.03 * t.pressure),
    accel: BASE.accel * GRIP.accelUp * (1 + 0.09 * E + 0.07 * B) * (1 - 0.12 * t.gearing),
    grip: BASE.grip * (1 + 0.1 * Ty + 0.05 * A) * (1 + 0.3 * (t.downforce - 0.5)) * (1 - 0.08 * t.pressure) * (1 - 0.08 * t.steering) * nitroWeight,
    turn: BASE.turn * (1 + 0.07 * St) * (1 + 0.15 * t.steering),
    radius: BASE.radius, nitroShots: t.nitro, gearbox: t.gearbox, shiftLight: t.shiftLight,
  };
}

/** WHERE THE CAR'S POWER COMES FROM. The benchmark score sets the engine's level inside the class's window: `share` is the score as a share of the most the class can score (0 the slowest card, 1 the fastest), the engine runs from the
 *  window's bottom to its top in a straight line. A strong built-in GPU is a slow car, the best separate card a fast one; the windows do not overlap. These windows are PLACEHOLDERS until the lap times are calibrated per class (phase 3); turn them first. */
export const FORMULA_CLASS_WINDOWS: Record<ClassId, { engine: [number, number] }> = {
  integrated: { engine: [0, 3] },
  discrete: { engine: [3.5, PART_MAX.engine] },
};
/** the car that skipped the benchmark has the weakest engine there is, a little under the slowest card's, so it is slower than any benchmarked car */
export const UNBENCHMARKED_ENGINE = -0.4;
const mix = (a: number, b: number, share: number): number => a + (b - a) * share;
/** the stock car with the engine this benchmark result gives it. With no result (or one that is not believable) it is the WEAKEST car. Same result in, same spec out. */
export function formulaSpecForBenchmark(benchmark: BenchmarkResult | null): FormulaSpec {
  if (!benchmark || !isClassId(benchmark.class) || !Number.isFinite(benchmark.score)) return { ...STOCK_SPEC, engine: UNBENCHMARKED_ENGINE };
  const cls = benchmark.class as ClassId, share = Math.max(0, Math.min(1, benchmark.score / Math.max(1, classScoreCap(cls)))), window = FORMULA_CLASS_WINDOWS[cls].engine;
  return { ...STOCK_SPEC, engine: Math.round(mix(window[0], window[1], share) * 1000) / 1000 };
}
