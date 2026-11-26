import { FORMULA_PLACEHOLDER_TABLE, formulaImplausibleReason, implausibleReason } from './plausible';
import { CLASS_BOUNDS, CLASS_SCORE_CAP, DEFAULT_MODE, DEFAULT_TRACK, MODE_IDS, TRACKS, isCategory, isClassId, isModeId, isTrackOf, type Category, type ClassId, type ModeId } from './classes';

export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_GHOST_SAMPLES = 256;
export const BENCHMARK_VERSION_MAX = 24;

/** What every mode sends. `mode` and `track` may be left out by an old game build: the server then treats the run as drag on the strip. */
interface SubmissionBase {
  playerName: string;
  class: ClassId;
  category: Category;
  benchmarkScore: number;
  benchmarkVersion: string;
  gpuId: string;
  /** drag: seconds from green to launch. formula: a standing start has no reaction time, 0 when left out. */
  reactionTime: number;
  /** the track of the mode (drag: 'strip', formula: 'beach') */
  track: string;
  /** the ranking time in seconds in every mode: the quarter-mile ET in drag, the lap time in formula (stored in the column quarter_et) */
  timeS: number;
  /** Integer seed of the deterministic run (future re-simulation input). */
  seed: number;
  /** Tune knobs: flat map of short names to numbers (future re-simulation input). */
  tune: Record<string, number>;
  /** Optional compact ghost: [elapsedSeconds, distanceFeet] pairs. */
  ghost?: Array<[number, number]>;
}

/** DRAG. `splits` are elapsed times (s) at 60ft, 330ft, 660ft(eighth), 1000ft, 1320ft(quarter). */
export interface DragSubmission extends SubmissionBase {
  mode: 'drag';
  splits: { ft60: number; ft330: number; eighth: number; ft1000: number; quarter: number };
  trapSpeed: number;
}

/** FORMULA. `splits` are the elapsed times (s) at the end of sector 1, the end of sector 2 and the end of the lap (the lap time); three sectors. `topSpeed` is in mph. */
export interface FormulaSubmission extends SubmissionBase {
  mode: 'formula';
  splits: { sector1: number; sector2: number; lap: number };
  topSpeed: number;
}

export type ScoreSubmission = DragSubmission | FormulaSubmission;

export type ValidationResult =
  | { ok: true; value: ScoreSubmission }
  | { ok: false; error: string };

const fail = (error: string): ValidationResult => ({ ok: false, error });
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Name sanitizer: NFKC, strip control chars, allow letters/digits/space/_-.,
 * collapse spaces, 3-16 chars. Returns null when unusable. `blockedWords` is the profanity hook.
 */
export function sanitizeName(raw: unknown, blockedWords: string[] = []): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} _\-.]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length < 3 || cleaned.length > 16) return null;
  if (isNameBlocked(cleaned, blockedWords)) return null;
  return cleaned;
}

/** PROFANITY HOOK: replace/extend with a real list. Matches blocked words as substrings, ignoring case and separators. */
export function isNameBlocked(name: string, blockedWords: string[]): boolean {
  const squashed = name.toLowerCase().replace(/[\s_\-.]/g, '');
  return blockedWords.some((w) => w.trim() !== '' && squashed.includes(w.trim().toLowerCase()));
}

/** the ghost: [seconds, distance] pairs, ordered, within the limits of the mode (drag: feet, formula: metres along the lap) */
function parseGhost(raw: unknown, maxSeconds: number, maxDistance: number): { ok: true; ghost: Array<[number, number]> | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, ghost: undefined };
  if (!Array.isArray(raw) || raw.length > MAX_GHOST_SAMPLES) return { ok: false, error: `ghost must be an array of at most ${MAX_GHOST_SAMPLES} samples` };
  const ghost: Array<[number, number]> = [];
  let lastT = -1;
  let lastD = -1;
  for (const p of raw) {
    if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) return { ok: false, error: 'ghost samples must be [time, distance]' };
    if (p[0] < lastT || p[1] < lastD || p[1] > maxDistance || p[0] > maxSeconds) return { ok: false, error: 'ghost samples must be ordered and in range' };
    lastT = p[0];
    lastD = p[1];
    ghost.push([p[0], p[1]]);
  }
  return { ok: true, ghost };
}

/** Reads the optional `mode` and `track` of a request body or query. Absent means drag on the strip (an old game build). Returns a message when the value is unknown. */
export function parseModeAndTrack(mode: unknown, track: unknown): { ok: true; mode: ModeId; track: string } | { ok: false; error: string } {
  if (mode !== undefined && mode !== null && !isModeId(mode)) return { ok: false, error: `unknown mode (use ${MODE_IDS.join(' or ')})` };
  const m: ModeId = isModeId(mode) ? mode : DEFAULT_MODE;
  if (track !== undefined && track !== null && !isTrackOf(m, track)) return { ok: false, error: `unknown track for mode ${m} (use ${TRACKS[m].join(' or ')})` };
  return { ok: true, mode: m, track: typeof track === 'string' ? track : DEFAULT_TRACK[m] };
}

export function validateSubmission(body: unknown, blockedWords: string[] = []): ValidationResult {
  if (!isObj(body)) return fail('body must be a JSON object');
  const modeTrack = parseModeAndTrack(body.mode, body.track);
  if (!modeTrack.ok) return fail(modeTrack.error);
  const name = sanitizeName(body.playerName, blockedWords);
  if (!name) return fail('playerName must be 3-16 letters, digits, space, _ - . and not blocked');
  if (!isClassId(body.class)) return fail('unknown class');
  if (!isCategory(body.category)) return fail("category must be 'manual' or 'autopilot'");
  if (!isNum(body.benchmarkScore) || body.benchmarkScore < 0 || body.benchmarkScore > 1e7)
    return fail('benchmarkScore out of range');
  if (typeof body.benchmarkVersion !== 'string' || !/^[\w.\-]{1,24}$/.test(body.benchmarkVersion))
    return fail('benchmarkVersion invalid');
  if (typeof body.gpuId !== 'string' || body.gpuId.length < 1 || body.gpuId.length > 120)
    return fail('gpuId must be 1-120 chars');
  // A formula standing start has no reaction time: it may be left out (stored as 0).
  const reactionTime = modeTrack.mode === 'formula' && body.reactionTime === undefined ? 0 : body.reactionTime;
  if (!isNum(reactionTime) || reactionTime < -0.5 || reactionTime > 5)
    return fail('reactionTime out of range');
  if (!isNum(body.seed) || !Number.isInteger(body.seed) || body.seed < 0 || body.seed > 0xffffffff)
    return fail('seed must be a uint32');
  if (!isObj(body.splits)) return fail('splits required');
  const common = { playerName: name, class: body.class, category: body.category, benchmarkScore: body.benchmarkScore, benchmarkVersion: body.benchmarkVersion, gpuId: body.gpuId, reactionTime, track: modeTrack.track, seed: body.seed };
  return modeTrack.mode === 'formula' ? validateFormula(body, common) : validateDrag(body, common);
}

type CommonFields = Pick<SubmissionBase, 'playerName' | 'class' | 'category' | 'benchmarkScore' | 'benchmarkVersion' | 'gpuId' | 'reactionTime' | 'track' | 'seed'>;

/** the tune: a flat map of names to numbers (both modes) */
function parseTune(raw: unknown): { ok: true; tune: Record<string, number> } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: 'tune must be an object of numbers' };
  const entries = Object.entries(raw);
  if (entries.length > 32) return { ok: false, error: 'tune has too many entries' };
  for (const [k, v] of entries) if (!/^[\w]{1,32}$/.test(k) || !isNum(v)) return { ok: false, error: 'tune entries must be name -> number' };
  return { ok: true, tune: Object.fromEntries(entries) as Record<string, number> };
}

function validateDrag(body: Record<string, unknown>, common: CommonFields): ValidationResult {
  const s = body.splits as Record<string, unknown>;
  const keys = ['ft60', 'ft330', 'eighth', 'ft1000', 'quarter'] as const;
  for (const k of keys) if (!isNum(s[k])) return fail(`splits.${k} must be a number`);
  const sp = s as Record<(typeof keys)[number], number>;
  for (let i = 1; i < keys.length; i++)
    if (sp[keys[i]] <= sp[keys[i - 1]]) return fail('splits must be strictly increasing');
  if (sp.ft60 < 0.3) return fail('impossible 60ft time');
  if (!isNum(body.trapSpeed)) return fail('trapSpeed must be a number');
  const tune = parseTune(body.tune);
  if (!tune.ok) return fail(tune.error);

  if (common.benchmarkScore > CLASS_SCORE_CAP[common.class])
    return fail(`benchmarkScore ${Math.round(common.benchmarkScore)} is above the ${common.class} class cap of ${CLASS_SCORE_CAP[common.class]}`);
  const bounds = CLASS_BOUNDS[common.class];
  if (sp.quarter < bounds.minQuarterEt) return fail('quarter ET faster than possible for class');
  if (sp.quarter > bounds.maxQuarterEt) return fail('quarter ET too slow to rank');
  if (body.trapSpeed < bounds.minTrapSpeed || body.trapSpeed > bounds.maxTrapSpeed)
    return fail('trapSpeed outside class bounds');
  // Score-aware window: a weak card cannot claim a high-end card's time (the class bounds above stay as the outer limit).
  const implausible = implausibleReason(common.class, common.benchmarkScore, { quarter: sp.quarter, ft60: sp.ft60, eighth: sp.eighth, trapSpeed: body.trapSpeed });
  if (implausible) return fail(implausible);
  // Physical sanity: average speed over the last 330ft (1320-1000ft) must roughly match the trap speed.
  const lastLegMph = (320 / (sp.quarter - sp.ft1000)) * 0.681818;
  if (lastLegMph > body.trapSpeed * 1.35 + 20 || lastLegMph < body.trapSpeed * 0.6 - 20)
    return fail('trapSpeed inconsistent with splits');
  // Average speed must not decrease wildly leg to leg (car cannot go backwards mid-run).
  if (sp.eighth < sp.ft330 + 0.05) return fail('impossible split spacing');

  const ghost = parseGhost(body.ghost, 40, 1400);
  if (!ghost.ok) return fail(ghost.error);
  return {
    ok: true,
    value: {
      ...common,
      mode: 'drag',
      timeS: sp.quarter,
      splits: { ft60: sp.ft60, ft330: sp.ft330, eighth: sp.eighth, ft1000: sp.ft1000, quarter: sp.quarter },
      trapSpeed: body.trapSpeed,
      tune: tune.tune,
      ghost: ghost.ghost,
    },
  };
}

function validateFormula(body: Record<string, unknown>, common: CommonFields): ValidationResult {
  const s = body.splits as Record<string, unknown>;
  const keys = ['sector1', 'sector2', 'lap'] as const;
  for (const k of keys) if (!isNum(s[k])) return fail(`splits.${k} must be a number`);
  const sp = s as Record<(typeof keys)[number], number>;
  if (sp.sector1 <= 0) return fail('splits must be strictly increasing');
  for (let i = 1; i < keys.length; i++)
    if (sp[keys[i]] <= sp[keys[i - 1]]) return fail('splits must be strictly increasing');
  if (!isNum(body.topSpeed)) return fail('topSpeed must be a number');
  const tune = parseTune(body.tune);
  if (!tune.ok) return fail(tune.error);

  if (common.benchmarkScore > CLASS_SCORE_CAP[common.class])
    return fail(`benchmarkScore ${Math.round(common.benchmarkScore)} is above the ${common.class} class cap of ${CLASS_SCORE_CAP[common.class]}`);
  const outer = FORMULA_PLACEHOLDER_TABLE.outer[common.class];
  if (sp.lap < outer.minLapS) return fail('lap time faster than possible for class');
  if (sp.lap > outer.maxLapS) return fail('lap time too slow to rank');
  if (body.topSpeed < outer.minTopMph || body.topSpeed > outer.maxTopMph) return fail('topSpeed outside class bounds');
  // Score-aware window with the placeholder numbers (see FORMULA_PLACEHOLDER_TABLE in plausible.ts).
  const implausible = formulaImplausibleReason(common.class, common.benchmarkScore, common.track, { sector1: sp.sector1, sector2: sp.sector2, lap: sp.lap, topSpeed: body.topSpeed });
  if (implausible) return fail(implausible);

  const ghost = parseGhost(body.ghost, FORMULA_PLACEHOLDER_TABLE.ghost.maxSeconds, FORMULA_PLACEHOLDER_TABLE.ghost.maxDistanceM);
  if (!ghost.ok) return fail(ghost.error);
  return {
    ok: true,
    value: {
      ...common,
      mode: 'formula',
      timeS: sp.lap,
      splits: { sector1: sp.sector1, sector2: sp.sector2, lap: sp.lap },
      topSpeed: body.topSpeed,
      tune: tune.tune,
      ghost: ghost.ghost,
    },
  };
}

/**
 * RE-SIMULATION HOOK (not implemented on purpose).
 * Later the game's pure, deterministic physics (no Math.random, no DOM) will be imported here and run with
 * { class, benchmarkScore, benchmarkVersion, tune, seed } to reproduce the run. The submission already carries every
 * input needed: class, benchmarkScore (-> horsepower/torque), benchmarkVersion (pins the physics version),
 * tune, seed, plus the claimed splits/ET/trapSpeed to compare against (and optional ghost for a spot check).
 * Return ok only if the simulated ET is within tolerance; accepted runs get verified = 1.
 * Until then every run is stored with verified = 0.
 */
export async function verifyBySimulation(_s: ScoreSubmission): Promise<{ verified: boolean; reason?: string }> {
  return { verified: false, reason: 'resimulation not implemented' };
}
