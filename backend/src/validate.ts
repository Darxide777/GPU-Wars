import { CLASS_BOUNDS, isCategory, isClassId, type Category, type ClassId } from './classes';

export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_GHOST_SAMPLES = 256;
export const BENCHMARK_VERSION_MAX = 24;

/** What the game sends. `splits` are elapsed times (s) at 60ft, 330ft, 660ft(eighth), 1000ft, 1320ft(quarter). */
export interface ScoreSubmission {
  playerName: string;
  class: ClassId;
  category: Category;
  benchmarkScore: number;
  benchmarkVersion: string;
  gpuId: string;
  reactionTime: number;
  splits: { ft60: number; ft330: number; eighth: number; ft1000: number; quarter: number };
  trapSpeed: number;
  /** Integer seed of the deterministic run (future re-simulation input). */
  seed: number;
  /** Tune knobs: flat map of short names to numbers (future re-simulation input). */
  tune: Record<string, number>;
  /** Optional compact ghost: [elapsedSeconds, distanceFeet] pairs. */
  ghost?: Array<[number, number]>;
}

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

export function validateSubmission(body: unknown, blockedWords: string[] = []): ValidationResult {
  if (!isObj(body)) return fail('body must be a JSON object');
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
  if (!isNum(body.reactionTime) || body.reactionTime < -0.5 || body.reactionTime > 5)
    return fail('reactionTime out of range');
  if (!isNum(body.seed) || !Number.isInteger(body.seed) || body.seed < 0 || body.seed > 0xffffffff)
    return fail('seed must be a uint32');
  if (!isObj(body.splits)) return fail('splits required');
  const s = body.splits;
  const keys = ['ft60', 'ft330', 'eighth', 'ft1000', 'quarter'] as const;
  for (const k of keys) if (!isNum(s[k])) return fail(`splits.${k} must be a number`);
  const sp = s as Record<(typeof keys)[number], number>;
  for (let i = 1; i < keys.length; i++)
    if (sp[keys[i]] <= sp[keys[i - 1]]) return fail('splits must be strictly increasing');
  if (sp.ft60 < 0.3) return fail('impossible 60ft time');
  if (!isNum(body.trapSpeed)) return fail('trapSpeed must be a number');
  if (!isObj(body.tune)) return fail('tune must be an object of numbers');
  const tuneEntries = Object.entries(body.tune);
  if (tuneEntries.length > 32) return fail('tune has too many entries');
  for (const [k, v] of tuneEntries)
    if (!/^[\w]{1,32}$/.test(k) || !isNum(v)) return fail('tune entries must be name -> number');

  const bounds = CLASS_BOUNDS[body.class];
  if (sp.quarter < bounds.minQuarterEt) return fail('quarter ET faster than possible for class');
  if (sp.quarter > bounds.maxQuarterEt) return fail('quarter ET too slow to rank');
  if (body.trapSpeed < bounds.minTrapSpeed || body.trapSpeed > bounds.maxTrapSpeed)
    return fail('trapSpeed outside class bounds');
  // Physical sanity: average speed over the last 330ft (1320-1000ft) must roughly match the trap speed.
  const lastLegMph = (320 / (sp.quarter - sp.ft1000)) * 0.681818;
  if (lastLegMph > body.trapSpeed * 1.35 + 20 || lastLegMph < body.trapSpeed * 0.6 - 20)
    return fail('trapSpeed inconsistent with splits');
  // Average speed must not decrease wildly leg to leg (car cannot go backwards mid-run).
  if (sp.eighth < sp.ft330 + 0.05) return fail('impossible split spacing');

  let ghost: Array<[number, number]> | undefined;
  if (body.ghost !== undefined) {
    if (!Array.isArray(body.ghost) || body.ghost.length > MAX_GHOST_SAMPLES)
      return fail(`ghost must be an array of at most ${MAX_GHOST_SAMPLES} samples`);
    ghost = [];
    let lastT = -1;
    let lastD = -1;
    for (const p of body.ghost) {
      if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1]))
        return fail('ghost samples must be [time, distance]');
      if (p[0] < lastT || p[1] < lastD || p[1] > 1400 || p[0] > 40)
        return fail('ghost samples must be ordered and in range');
      lastT = p[0];
      lastD = p[1];
      ghost.push([p[0], p[1]]);
    }
  }

  return {
    ok: true,
    value: {
      playerName: name,
      class: body.class,
      category: body.category,
      benchmarkScore: body.benchmarkScore,
      benchmarkVersion: body.benchmarkVersion,
      gpuId: body.gpuId,
      reactionTime: body.reactionTime,
      splits: { ft60: sp.ft60, ft330: sp.ft330, eighth: sp.eighth, ft1000: sp.ft1000, quarter: sp.quarter },
      trapSpeed: body.trapSpeed,
      seed: body.seed,
      tune: Object.fromEntries(tuneEntries) as Record<string, number>,
      ghost,
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
