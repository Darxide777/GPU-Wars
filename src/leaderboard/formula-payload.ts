// What a finished ranked FORMULA lap sends to the leaderboard (POST /scores with mode 'formula'). Same job as payload.ts for Drag: the shape and limits match backend/src/validate.ts (`validateFormula`),
// and the test imports that file and checks every payload this module makes is accepted. Drag's payload.ts is untouched.
import type { BenchmarkResult } from '../save.ts';
import { cleanFormulaTune, ghostFromLap, type FormulaTimeslip, type FormulaTrack, type FormulaTune, type LapTrace } from '../formula/index.ts';
import { isClassId, DEFAULT_TRACK, type Category, type ClassId } from '../classes.ts';
import type { FormulaScorePayload } from './client.ts';
import { ghostToPairs } from './formula-ghost.ts';
import { SCORE_LIMITS } from './payload.ts';

const KMH_TO_MPH = 0.621371;
const round = (v: number, digits: number): number => Math.round(v * 10 ** digits) / 10 ** digits;

/** the tune as plain numbers with short names (the server stores up to 32 of them for a future re-simulation): gearbox manual is 1 and auto is 0 */
export function flattenFormulaTune(tune: FormulaTune): Record<string, number> {
  const t = cleanFormulaTune(tune);
  return { gearing: t.gearing, downforce: t.downforce, steering: t.steering, pressure: t.pressure, nitro: t.nitro, shiftManual: t.gearbox === 'manual' ? 1 : 0, shiftLight: t.shiftLight };
}

/** the three sector times the server takes, from the track's gate splits (one per gate, the finish last): the end of the first third, the end of the second third, and the lap. A track with seven gates gives the 2nd, 5th and 7th split. */
export function sectorsOf(splits: number[]): { sector1: number; sector2: number; lap: number } | null {
  const n = splits.length;
  if (n < 3 || !splits.every((t, i) => Number.isFinite(t) && t > 0 && (i === 0 || t > (splits[i - 1] as number)))) return null;
  return { sector1: splits[Math.max(0, Math.round(n / 3) - 1)] as number, sector2: splits[Math.max(1, Math.round((2 * n) / 3) - 1)] as number, lap: splits[n - 1] as number };
}

export interface FormulaScoreInput {
  playerName: string; category: Category; benchmark: BenchmarkResult | null; slip: FormulaTimeslip; tune: FormulaTune; seed: number; track: FormulaTrack;
  /** the lap the race recorded (`race.trace()`); gives the optional ghost */ trace?: LapTrace | null;
}

/** why a lap cannot be sent (a string for the screen), or null when it is a clean ranked lap with a benchmark behind it. Same rules as Drag: no benchmark, no rank; a foul is not ranked. */
export function whyFormulaNotRanked(input: Pick<FormulaScoreInput, 'benchmark' | 'slip'>): string | null {
  const s = input.slip;
  if (!input.benchmark || !isClassId(input.benchmark.class)) return 'RUN THE BENCHMARK TO GET A CLASS AND RANK';
  if (s.jumpStart) return 'JUMP START: ONLY A CLEAN LAP IS RANKED';
  if (!s.finished) return 'THE LAP DID NOT FINISH';
  if (!s.valid) return 'ONLY A CLEAN LAP IS RANKED';
  if (!(s.lapTime > 0) || !sectorsOf(s.splits)) return 'THE LAP DID NOT FINISH';
  return null;
}

/** the payload for a clean ranked lap, or null when it cannot be ranked (see whyFormulaNotRanked) */
export function buildFormulaPayload(input: FormulaScoreInput): FormulaScorePayload | null {
  if (whyFormulaNotRanked(input)) return null;
  const s = input.slip, b = input.benchmark as BenchmarkResult, sectors = sectorsOf(s.splits) as { sector1: number; sector2: number; lap: number };
  const ghost = input.trace ? ghostToPairs(ghostFromLap(input.track, s, input.trace, input.playerName)) : undefined;
  return {
    mode: 'formula', track: input.track.id || DEFAULT_TRACK.formula, playerName: input.playerName, class: b.class as ClassId, category: input.category,
    benchmarkScore: Math.max(0, Math.min(1e7, round(b.score, 2))), benchmarkVersion: String(b.benchmarkVersion).replace(/[^\w.\-]/g, '').slice(0, 24) || '0',
    gpuId: b.gpuId.slice(0, SCORE_LIMITS.gpuIdMax) || 'unknown',
    splits: { sector1: round(sectors.sector1, 3), sector2: round(sectors.sector2, 3), lap: round(sectors.lap, 3) },
    topSpeed: round(s.topSpeed * KMH_TO_MPH, 1), seed: Math.max(0, Math.min(0xffffffff, Math.floor(input.seed))), tune: flattenFormulaTune(input.tune), ...(ghost ? { ghost } : {}),
  };
}
