// THE ONE PLACE THE CLASS LIST LIVES. Pure data, no imports: the game imports this file directly (src/classes.ts re-exports it) and the leaderboard server uses it too.
//
// There are two classes for now: "integrated" (graphics built into the processor) and "discrete" (a separate graphics card).
// TO ADD A CLASS LATER (a vendor or generation split, for example "discrete-nvidia"): add its id to CLASS_IDS and a row to CLASS_BOUNDS here, then give it
// a row in CLASS_SPEC_LIMITS (src/drag/spec-source.ts) and CLASS_SCORE_SHARE (src/benchmark/constants.ts), a name in src/classes.ts, a leader time in FALLBACK_LEADERS
// (src/leaderboard/leader.ts), a ghost launch share in LEADERBOARD_GHOST if it needs one, a detection rule in src/benchmark/gpu.ts and a band in tests/calibration.test.mjs.
// A server database that holds rows of a removed class id needs a migration that maps them (see migrations/0002_two_classes.sql).
//
// Quarter-mile ET floors are the fastest believable time for the class; they are tunable anti-cheat bounds, not game physics. They sit a little outside what
// the simulation gives for the class's top card with a perfect tune on the thinnest, coolest, grippiest day (measured over 80 seeds, see docs/CALIBRATION.md):
// discrete 3.9 s at up to 351 mph, integrated 9.07 s at 145 mph. The ceiling on ET is generic (a bad run is slow, not impossible).

export const CLASS_IDS = ['integrated', 'discrete'] as const;
export type ClassId = (typeof CLASS_IDS)[number];
export const CATEGORIES = ['manual', 'autopilot'] as const;
export type Category = (typeof CATEGORIES)[number];

/** The game modes the leaderboard knows. Every score belongs to one mode and one track. 'drag' is the original quarter-mile mode (the default everywhere, so an old game build that sends no mode keeps working). */
export const MODE_IDS = ['drag', 'formula'] as const;
export type ModeId = (typeof MODE_IDS)[number];
export const DEFAULT_MODE: ModeId = 'drag';

/** The tracks of each mode, as data so more can be added (a city or mountain circuit later). The first track is the default one for the mode. A new track needs a row here and, for formula, a row in FORMULA_PLACEHOLDER_TABLE (plausible.ts). */
export const TRACKS: Record<ModeId, readonly string[]> = { drag: ['strip'], formula: ['beach'] };
export const DEFAULT_TRACK: Record<ModeId, string> = { drag: 'strip', formula: 'beach' };

/** What the ranking number of a mode is. Both modes store it in the database column `quarter_et` (the old name is kept so the live Worker keeps reading the table), and the API calls it `timeS`. */
export const MODE_METRIC: Record<ModeId, 'quarter_et' | 'lap_time'> = { drag: 'quarter_et', formula: 'lap_time' };

export function isModeId(value: unknown): value is ModeId {
  return typeof value === 'string' && (MODE_IDS as readonly string[]).includes(value);
}
export function isTrackOf(mode: ModeId, value: unknown): value is string {
  return typeof value === 'string' && TRACKS[mode].includes(value);
}

export interface ClassBounds {
  minQuarterEt: number; // seconds
  maxQuarterEt: number;
  maxTrapSpeed: number; // mph
  minTrapSpeed: number;
}

export const CLASS_BOUNDS: Record<ClassId, ClassBounds> = {
  integrated: { minQuarterEt: 8.2, maxQuarterEt: 30, minTrapSpeed: 60, maxTrapSpeed: 170 },
  discrete: { minQuarterEt: 3.6, maxQuarterEt: 30, minTrapSpeed: 60, maxTrapSpeed: 370 },
};

/** The highest benchmark score each class may report (the game's CLASS_SCORE_SHARE x maxScore 10000; tests/score-bounds.test.mjs keeps them equal). The server refuses a higher score. */
export const CLASS_SCORE_CAP: Record<ClassId, number> = { integrated: 8000, discrete: 10000 };

export function isClassId(value: unknown): value is ClassId {
  return typeof value === 'string' && (CLASS_IDS as readonly string[]).includes(value);
}
export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}
