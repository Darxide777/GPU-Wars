// The Formula car with no screen: its stock parts, its tune and how the two (and the benchmark) become the numbers the driving physics reads. There is no shop: the parts are the TOP level of every part
// (`STOCK_SPEC`), the same for everyone; the benchmark score only sets the engine's power inside the class window (`formulaSpecForBenchmark`, the same idea as src/drag/spec-source.ts).
// Ported from Chromium Halo: Neon's src/race/car.ts (`raceCarStats`, the tune).
import { isClassId, type ClassId } from '../classes.ts';
import { classScoreCap } from '../benchmark/score.ts';
import type { BenchmarkResult } from '../save.ts';
import { cleanSlots, type TuneSlots } from '../tune-slots.ts';
import { BASE, GRIP, NITRO, TUNE_EFFECT as TE } from './constants.ts';
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
  gearing: 'SHORT GEARS PULL HARDER OFF THE LINE; TALL GEARS HAVE A HIGHER TOP SPEED, BUT TOO TALL LOSES IT AGAIN.',
  downforce: 'MORE DOWNFORCE GRIPS THE TURNS HARDER, FOR A LOWER TOP SPEED ON THE STRAIGHTS.',
  steering: 'QUICKER STEERING TURNS IN SHARPER BUT HAS LESS GRIP; SLOWER IS SAFER.',
  pressure: 'SOFT TYRES GRIP MORE; HARD TYRES ROLL FASTER, BUT TOO HARD LOSES IT.',
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
    vmax: BASE.vmax * BASE.vmaxScale * GRIP.speedUp * (1 + 0.05 * E + 0.025 * A) * (1 + TE.gearingTop * t.gearing - TE.gearingCurve * t.gearing * t.gearing) * (1 - TE.downforceTop * t.downforce) * (1 + TE.pressureTop * t.pressure - TE.pressureCurve * t.pressure * t.pressure),
    accel: BASE.accel * GRIP.accelUp * (1 + 0.09 * E + 0.07 * B) * (1 - TE.gearingPull * t.gearing),
    grip: BASE.grip * (1 + 0.1 * Ty + 0.05 * A) * (1 + TE.downforceGrip * (t.downforce - 0.5)) * (1 - TE.pressureGrip * t.pressure) * (1 - TE.steeringGrip * t.steering) * nitroWeight,
    turn: BASE.turn * (1 + 0.07 * St) * (1 + TE.steeringTurn * t.steering),
    radius: BASE.radius, nitroShots: t.nitro, gearbox: t.gearbox, shiftLight: t.shiftLight,
  };
}

/** WHERE THE CAR'S POWER COMES FROM, CALIBRATED (docs/CALIBRATION.md, phase 3). Two steps, the same idea as Drag's `BENCHMARK_TO_SPEC`:
 *  1. `FORMULA_CLASS_WINDOWS`: the engine level at the slowest card of a class and at its class cap. Integrated runs from -1.44 (a 55 s lap, score 0) to 3.55 (44.5 s, score 8000); discrete from 4.47 (43 s, score 0) to 8 (38 s, the best card, score 10000, the source game's top engine).
 *     The windows do not overlap and the best integrated card is slower than the weakest discrete one, as in Drag. The engine level is a number the physics reads (pull 9 percent and top speed 5 percent per level), so it may be negative for a weak card.
 *  2. `FORMULA_SCORE_TO_ENGINE`: where in the window a score sits (the score as a share of the class cap, then the share of the window), blended in a straight line between rows. The rows were solved from the target lap times
 *     (default tune, the autopilot's lap on BEACH): integrated 55 s at score 0, 51 s at 1302 (the S24 Ultra phone, measured), 47 s at 5005 (the Radeon 8060S, measured), 44.5 s at the cap; discrete 43 s at 0 down to 38 s at 10000 in the shape of Drag's discrete curve (steep at the bottom, flat at the top).
 *  These are the OWNER'S CONSTANTS: change a target lap, solve the engine again (the bisection in tests/formula-calibration.test.mjs does it) and rewrite the row. The lap table is `PRINT_LAP_TABLE=1 node --test tests/formula-calibration.test.mjs`. */
export const FORMULA_CLASS_WINDOWS: Record<ClassId, { engine: [number, number] }> = {
  integrated: { engine: [-1.444, 3.552] },
  discrete: { engine: [4.474, PART_MAX.engine] },
};
export const FORMULA_SCORE_TO_ENGINE: Record<ClassId, readonly { share: number; engineShare: number }[]> = {
  integrated: [
    { share: 0, engineShare: 0 }, { share: 0.08125, engineShare: 0.1599 }, { share: 0.16275, engineShare: 0.3325 }, { share: 0.375, engineShare: 0.5033 },
    { share: 0.62562, engineShare: 0.7205 }, { share: 0.8125, engineShare: 0.8573 }, { share: 1, engineShare: 1 },
  ],
  discrete: [
    { share: 0, engineShare: 0 }, { share: 0.2, engineShare: 0.3906 }, { share: 0.4, engineShare: 0.6481 }, { share: 0.6, engineShare: 0.8159 }, { share: 0.8, engineShare: 0.9378 }, { share: 1, engineShare: 1 },
  ],
};
/** the car that skipped the benchmark has the weakest engine there is, below the slowest card's (a 58 s lap), so it is slower than any benchmarked car */
export const UNBENCHMARKED_ENGINE = -2.54;
const mix = (a: number, b: number, share: number): number => a + (b - a) * share;
/** where in a class's window a share of its top score sits: a straight-line blend between the two rows around it */
export function engineShareFor(cls: ClassId, share: number): number {
  const rows = FORMULA_SCORE_TO_ENGINE[cls], x = Math.max(0, Math.min(1, share));
  for (let i = 1; i < rows.length; i++) { const a = rows[i - 1] as typeof rows[number], b = rows[i] as typeof rows[number]; if (x <= b.share) return mix(a.engineShare, b.engineShare, (x - a.share) / Math.max(1e-9, b.share - a.share)); }
  return (rows[rows.length - 1] as typeof rows[number]).engineShare;
}
/** the stock car with the engine this benchmark result gives it. With no result (or one that is not believable) it is the WEAKEST car. Same result in, same spec out. */
export function formulaSpecForBenchmark(benchmark: BenchmarkResult | null): FormulaSpec {
  if (!benchmark || !isClassId(benchmark.class) || !Number.isFinite(benchmark.score)) return { ...STOCK_SPEC, engine: UNBENCHMARKED_ENGINE };
  const cls = benchmark.class as ClassId, share = Math.max(0, Math.min(1, benchmark.score / Math.max(1, classScoreCap(cls)))), window = FORMULA_CLASS_WINDOWS[cls].engine;
  return { ...STOCK_SPEC, engine: Math.round(mix(window[0], window[1], engineShareFor(cls, share)) * 1000) / 1000 };
}
