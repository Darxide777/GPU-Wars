// The tune screen's PREDICTED TIMESLIP: what a perfect driver (the autopilot) gets from a standing start with this car and tune, on this track. Like `predictDrag` in src/drag/physics.ts: a pure function of the numbers, kept
// after the first time (see `solveLap`), so the tune screen can call it on every change.
import { STOCK_SPEC } from './car.ts';
import { solveLap } from './racingLine.ts';
import { FORMULA_TRACKS } from './tracks.ts';
import type { FormulaSpec, FormulaTimeslip, FormulaTrack, FormulaTune } from './types.ts';

/** the timeslip of a perfect lap with this spec and tune (the tune is made safe first, so any saved or typed tune is fine) */
export function predictFormula(spec: FormulaSpec = STOCK_SPEC, tune: Partial<FormulaTune> | null = null, track: FormulaTrack = FORMULA_TRACKS[0] as FormulaTrack): FormulaTimeslip {
  return solveLap(spec, tune, track).slip;
}
