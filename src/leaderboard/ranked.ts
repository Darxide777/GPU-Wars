// RANKED RUNS: one fixed "class day" for everyone, so the board compares cars and drivers, not weather. Free play (the tune screen's TEST RUN) keeps its random weather.
import { CONDITIONS, FUEL, airDensity, createDragStrip, trackGrip } from '../drag/physics.ts';
import type { DragConditions, DragStrip } from '../drag/types.ts';

/** Turn `seed` first to change the day for everyone (it also fixes the tree's timing); `conditions` to change the weather. Changing either makes old times incomparable:
 * bump the benchmark/ranked version when you do. The wind is calm and the weather front is flat on the class day, so no player gets a tailwind. */
const RANKED_AIR_C = 22, RANKED_TRACK_C = 36, RANKED_ALTITUDE_M = 300;
export const RANKED = {
  seed: 20260101,
  conditions: {
    airC: RANKED_AIR_C, altitude: RANKED_ALTITUDE_M, trackC: RANKED_TRACK_C,
    grip: trackGrip(RANKED_TRACK_C), rho: airDensity(RANKED_AIR_C, RANKED_ALTITUDE_M),
    headwind: 0, crosswind: 0, gust: 0, headPhase: 0, crossPhase: 0, weather: { air: 0, track: 0, grip: 0, phase: 0 },
  } as DragConditions,
  /** Everyone starts a ranked run the same way: a clean strip with no rubber from earlier runs, a new clutch, a full tank and an engine at the day's air temperature. */
  rubberPolicy: 'fresh strip, new clutch, full tank, cool engine',
} as const;

/** a new, empty strip for a ranked run (the rubber policy: nothing carries over from earlier races in the visit) */
export const rankedStrip = (): DragStrip => createDragStrip(2);
/** the car's starting state for a ranked run, the same for everyone */
export const rankedStart = (): { clutchCondition: number; fuel: number; engineTemp: number } => ({ clutchCondition: 1, fuel: FUEL.capacity, engineTemp: RANKED.conditions.airC });

/** density altitude in feet: the height in a standard atmosphere that has the same air density (hot or high air is "thin" and slows the car). pressure altitude plus 120 ft per degree C above standard. */
export function densityAltitudeFt(cond: Pick<DragConditions, 'airC' | 'altitude'>): number {
  const metres = Number.isFinite(cond.altitude) ? cond.altitude as number : 0, standardC = CONDITIONS.seaLevelK - 273.15 - CONDITIONS.lapseKPerM * metres;
  return Math.round(metres * 3.28084 + 120 * (cond.airC - standardC));
}
/** the line shown on the race screen: ranked or free play, and the numbers that matter for the run */
export function conditionsBanner(cond: DragConditions, ranked: boolean): string {
  const wind = Math.abs(cond.headwind) < 0.05 && Math.abs(cond.crosswind) < 0.05 ? 'CALM' : `WIND H${cond.headwind >= 0 ? '+' : ''}${cond.headwind.toFixed(1)}`;
  return `${ranked ? 'RANKED CLASS DAY (SAME FOR EVERYONE)' : 'FREE PLAY'}  DENSITY ALT ${densityAltitudeFt(cond)} FT  AIR ${Math.round(cond.airC)}C  TRACK ${Math.round(cond.trackC)}C  ${wind}${ranked ? '  FRESH STRIP' : ''}`;
}
