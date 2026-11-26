// FORMULA MODE: the standalone lap simulation. Everything a page needs is exported from here; nothing in this folder touches the page, the title menu, the backend or the Drag code (phase 2 wires it in).
//   createFormulaRace({ track, spec, tune, ghost })  a race: race.step(input) at FORMULA_DT, race.view(), race.timeslip(), race.trace()
//   step(race, input) / view(race)                    the same as the methods, as functions
//   draw(ctx, W, H, view, options)                    the top-down picture and the lap HUD (topdown.ts, hud.ts)
//   predictFormula(spec, tune, track)                 the tune screen's predicted timeslip
//   createFormulaAutopilot(track, stats)              the autopilot (a driver: view in, FormulaInput out)
export { createFormulaRace, stepLap, newLapState, viewOf, timeslipOf, lightsLit, isGreen, type FormulaRace, type FormulaRaceOptions, type FormulaView } from './race.ts';
export { driveStep, gearPull, cornerSpeed, gripLimit, bankedLimit, revOf, shiftLightOn, placeOnTrack } from './physics.ts';
export { carStats, cleanFormulaTune, cleanFormulaSlots, formulaSpecForBenchmark, STOCK_SPEC, DEFAULT_FORMULA_TUNE, FORMULA_TUNE_LIMITS, FORMULA_TUNE_HELP, FORMULA_CLASS_WINDOWS, FORMULA_SCORE_TO_ENGINE, UNBENCHMARKED_ENGINE, engineShareFor } from './car.ts';
export { TUNE_EFFECT } from './constants.ts';
export { FORMULA_TRACKS, TRACK_SPECS, buildTrack, trackById } from './tracks.ts';
export { createFormulaAutopilot, driveAutopilotLap, AUTOPILOT, AUTOPILOT_CATEGORY } from './autopilot.ts';
export { racingLineFor, solveLap, LINE, LINE_COLOURS } from './racingLine.ts';
export { predictFormula } from './predict.ts';
export { ghostFromLeader, ghostFromLap, cleanGhost, ghostPose, ghostTimeAt, GHOST } from './ghost.ts';
export { draw } from './topdown.ts';
export { FORMULA_DT, LIGHTS, LAP, NITRO, TRACE } from './constants.ts';
export { IDLE_FORMULA_INPUT } from './types.ts';
export type * from './types.ts';

import type { FormulaRace, FormulaView } from './race.ts';
import type { FormulaInput } from './types.ts';
/** one fixed step of a race with the driver's input */
export const step = (race: FormulaRace, input?: Partial<FormulaInput>): void => race.step(input);
/** what to draw and what the autopilot reads */
export const view = (race: FormulaRace): FormulaView => race.view();
