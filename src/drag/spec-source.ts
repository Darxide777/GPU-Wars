// WHERE THE CAR'S NUMBERS COME FROM. Every race and every tune screen asks this one file for the car's spec, so the benchmark has exactly one place to plug in.
//
// Today (phase 0) it is a PLACEHOLDER: the stock dragster with every part at its top level, whatever the benchmark said.
// The benchmark phase replaces the body of `specForBenchmark` so that the score sets the horsepower and torque (`spec.torque`, and the peak revs if wanted);
// the stock parts (STOCK_PARTS) stay the same for everyone, so the score is the only thing that makes one player's car stronger than another's.
import { DRAG_CARS, STOCK_PARTS } from './data.ts';
import { specFor } from './tune.ts';
import type { BenchmarkResult } from '../save.ts';
import type { DragCarDef, DragSpec } from './types.ts';

/** the one car of the game */
export const STOCK_CAR: DragCarDef = DRAG_CARS[0] as DragCarDef;
/** the stock dragster: the top level of every part, a fresh clutch unless told otherwise */
export const stockSpec = (clutchCondition = 1): DragSpec => specFor(STOCK_CAR, STOCK_PARTS, clutchCondition);
/** the car to race for this save's benchmark result (null: the benchmark has not been run). EXTENSION POINT for the benchmark phase; it must stay deterministic (same result in, same spec out). */
export function specForBenchmark(_benchmark: BenchmarkResult | null, clutchCondition = 1): DragSpec { return stockSpec(clutchCondition); }
