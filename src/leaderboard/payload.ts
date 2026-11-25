// What a finished ranked run sends to the leaderboard (POST /scores). The shape and limits match backend/src/validate.ts (`ScoreSubmission`):
// the test imports that file and checks every payload this module makes is accepted.
import type { BenchmarkResult } from '../save.ts';
import type { DragGhost, Timeslip, Tune } from '../drag/types.ts';
import { isClassId, type Category, type ClassId } from '../classes.ts';

export interface ScorePayload {
  playerName: string;
  class: ClassId;
  category: Category;
  benchmarkScore: number;
  benchmarkVersion: string;
  gpuId: string;
  /** seconds from green to the launch */ reactionTime: number;
  /** elapsed seconds from the launch to each mark */ splits: { ft60: number; ft330: number; eighth: number; ft1000: number; quarter: number };
  /** miles per hour (the game keeps km/h) */ trapSpeed: number;
  /** the integer seed of the run: for ranked runs always RANKED.seed */ seed: number;
  /** the tune, flattened to name -> number */ tune: Record<string, number>;
  /** optional compact ghost: [elapsed seconds since launch, distance in feet] pairs */ ghost?: Array<[number, number]>;
}

export const SCORE_LIMITS = { maxGhostSamples: 256, maxTuneEntries: 32, maxGhostFeet: 1400, maxGhostSeconds: 40, gpuIdMax: 120 } as const;
const METRES_TO_FEET = 3.28084;
const KMH_TO_MPH = 0.621371;
const round = (v: number, digits: number): number => Math.round(v * 10 ** digits) / 10 ** digits;

/** the tune as plain numbers with short names: manual shifting is 1, auto is 0, and each gear is `gear1`, `gear2`, ... */
export function flattenTune(tune: Tune): Record<string, number> {
  const out: Record<string, number> = { shiftManual: tune.shift === 'manual' ? 1 : 0, finalDrive: tune.final };
  tune.ratios.slice(0, 12).forEach((r, i) => { out[`gear${i + 1}`] = r; });
  const plain: Array<keyof Tune> = ['launchRpm', 'launchAggression', 'shiftRpm', 'pressure', 'ballast', 'stiffness', 'wheelieBar', 'nitroShot', 'nitroGear', 'boostLimit'];
  for (const key of plain) { const v = tune[key]; if (typeof v === 'number' && Number.isFinite(v)) out[key] = round(v, 4); }
  return out;
}

/** the ghost of the run as [seconds since launch, feet] pairs: only the part from the launch on, thinned to at most 256 samples */
export function compactGhost(ghost: DragGhost | null | undefined): Array<[number, number]> | undefined {
  if (!ghost) return undefined;
  const fromLaunch = ghost.samples.filter(s => s.t >= ghost.reaction && s.x >= 0 && s.t - ghost.reaction <= SCORE_LIMITS.maxGhostSeconds);
  if (fromLaunch.length < 2) return undefined;
  const keep = Math.ceil(fromLaunch.length / SCORE_LIMITS.maxGhostSamples), out: Array<[number, number]> = [];
  fromLaunch.forEach((s, i) => {
    if (i % keep !== 0 && i !== fromLaunch.length - 1) return;
    const last = out[out.length - 1], seconds = Math.max(0, round(s.t - ghost.reaction, 3)), feet = Math.min(SCORE_LIMITS.maxGhostFeet, round(s.x * METRES_TO_FEET, 1));
    out.push([Math.max(seconds, last ? last[0] : 0), Math.max(feet, last ? last[1] : 0)]);
  });
  return out.length > SCORE_LIMITS.maxGhostSamples ? out.slice(out.length - SCORE_LIMITS.maxGhostSamples) : out;
}

export interface ScoreInput { playerName: string; category: Category; benchmark: BenchmarkResult | null; slip: Timeslip; tune: Tune; seed: number; ghost?: DragGhost | null }

/** why a run cannot be sent (a string for the screen), or null when it is a clean ranked pass with a benchmark behind it */
export function whyNotRanked(input: Pick<ScoreInput, 'benchmark' | 'slip'>): string | null {
  const s = input.slip;
  if (!input.benchmark || !isClassId(input.benchmark.class)) return 'RUN THE BENCHMARK TO GET A CLASS AND RANK';
  if (s.foul || s.aborted || s.crossed || s.crashed) return 'ONLY A CLEAN PASS IS RANKED';
  if (s.ft60 === undefined || s.ft330 === undefined || s.eighth === undefined || s.ft1000 === undefined || s.quarter === undefined || s.trap === undefined || s.reaction === null) return 'THE RUN DID NOT FINISH';
  return null;
}

/** the payload for a clean ranked run, or null when it cannot be ranked (see whyNotRanked) */
export function buildScorePayload(input: ScoreInput): ScorePayload | null {
  if (whyNotRanked(input)) return null;
  const s = input.slip, b = input.benchmark as BenchmarkResult;
  const splits = { ft60: round(s.ft60 as number, 3), ft330: round(s.ft330 as number, 3), eighth: round(s.eighth as number, 3), ft1000: round(s.ft1000 as number, 3), quarter: round(s.quarter as number, 3) };
  const ghost = compactGhost(input.ghost);
  return {
    playerName: input.playerName, class: b.class as ClassId, category: input.category,
    benchmarkScore: Math.max(0, Math.min(1e7, round(b.score, 2))), benchmarkVersion: String(b.benchmarkVersion).replace(/[^\w.\-]/g, '').slice(0, 24) || '0',
    gpuId: b.gpuId.slice(0, SCORE_LIMITS.gpuIdMax) || 'unknown', reactionTime: round(Math.max(0, s.reaction as number), 3), splits,
    trapSpeed: round((s.trap as number) * KMH_TO_MPH, 1), seed: Math.max(0, Math.min(0xffffffff, Math.floor(input.seed))), tune: flattenTune(input.tune), ...(ghost ? { ghost } : {}),
  };
}
