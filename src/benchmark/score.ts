// From timed passes to a score, with no screen and no clock in it (so the tests can feed it numbers).
import { BENCHMARK, CLASS_SCORE_SHARE, MASKED_GPU_RULE, type BackendId } from './constants.ts';
import { REFERENCE_CARDS } from './reference.ts';
import { type ClassId } from '../classes.ts';

const median = (values: number[]): number => { const s = [...values].sort((a, b) => a - b), m = s.length >> 1; return s.length === 0 ? 0 : s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2; };

export interface PassSummary {
  /** the rate of each pass that was kept, and the ones thrown away (in order) */
  kept: number[]; discarded: number[];
  /** the mean rate of the kept passes (work units per second); 0 when the run is not usable */
  rate: number;
  /** how steady the card was: the slowest pass over the fastest (1 is perfectly steady, 0 is unusable); a burst card falls, a sustained one stays near 1 */
  sustain: number;
  ok: boolean; reason: string;
}

/** throw away throttled (and spiking) passes, then average what is left */
export function summarizePasses(rates: number[]): PassSummary {
  const clean = rates.filter(r => Number.isFinite(r) && r > 0);
  if (clean.length < BENCHMARK.minKeptPasses) return { kept: [], discarded: rates, rate: 0, sustain: 0, ok: false, reason: 'TOO FEW PASSES FINISHED' };
  const mid = median(clean), kept = clean.filter(r => r >= mid * (1 - BENCHMARK.throttleDrop) && r <= mid * (1 + BENCHMARK.spikeRise)), discarded = rates.filter(r => !kept.includes(r));
  const sustain = Math.min(...clean) / Math.max(...clean);
  if (kept.length < BENCHMARK.minKeptPasses) return { kept, discarded, rate: 0, sustain, ok: false, reason: 'THE CARD WAS TOO UNSTEADY: CLOSE OTHER TABS AND TRY AGAIN' };
  return { kept, discarded, rate: kept.reduce((a, b) => a + b, 0) / kept.length, sustain, ok: true, reason: '' };
}

/** the score for a work rate: a log scale between the backend's `min` (0) and `max` (the top score), never beyond either end */
export function scoreFromRate(rate: number, backend: BackendId): number {
  const { min, max } = BENCHMARK.rate[backend];
  if (!Number.isFinite(rate) || rate <= min) return 0;
  const share = Math.log(rate / min) / Math.log(max / min), top = backend === 'canvas2d' ? BENCHMARK.maxScore * BENCHMARK.canvas2dScoreShare : BENCHMARK.maxScore;
  return Math.round(Math.min(1, Math.max(0, share)) * top);
}

/** the work rate above which a masked card is DISCRETE: the strongest built-in reference times the margin (constants.ts, MASKED_GPU_RULE) */
export const maskedDiscreteRate = (): number => (REFERENCE_CARDS.find(c => c.name === MASKED_GPU_RULE.referenceCard)?.rate ?? Infinity) * MASKED_GPU_RULE.margin;
/** the class of a masked card from its measured rate: never a faster class than the speed supports (a bad or missing rate is integrated) */
export const classForMaskedRate = (rate: number, backend: BackendId = 'webgl2'): ClassId => (backend !== 'canvas2d' && Number.isFinite(rate) && rate > maskedDiscreteRate() ? 'discrete' : 'integrated');
/** the lowest score a masked card can have in the discrete class (what a rate just over the line scores) */
export const maskedDiscreteMinScore = (): number => scoreFromRate(maskedDiscreteRate(), 'webgl2');

/** the highest score a class may have */
export const classScoreCap = (id: ClassId): number => Math.round(BENCHMARK.maxScore * CLASS_SCORE_SHARE[id]);
/** a score kept to what is possible: a whole number from 0 to the class's cap */
export function capScore(score: number, id: ClassId): number { return Number.isFinite(score) ? Math.round(Math.max(0, Math.min(classScoreCap(id), score))) : 0; }

/** was the run plausible? Each pass must have taken about as long as it should on the clock, and the run must not have been hidden or too long. */
export function checkDurations(passWallMs: number[], runMs: number, wasHidden: boolean): { ok: boolean; reason: string } {
  if (wasHidden) return { ok: false, reason: 'THE PAGE WAS HIDDEN DURING THE RUN' };
  if (runMs > BENCHMARK.maxRunMs) return { ok: false, reason: 'THE RUN TOOK FAR TOO LONG' };
  const lo = BENCHMARK.passMs * BENCHMARK.minPassShare, hi = BENCHMARK.passMs * BENCHMARK.maxPassShare;
  if (passWallMs.length < BENCHMARK.passes) return { ok: false, reason: 'NOT ALL PASSES FINISHED' };
  if (passWallMs.some(ms => !Number.isFinite(ms) || ms < lo || ms > hi)) return { ok: false, reason: 'A PASS TOOK AN IMPLAUSIBLE TIME: THE PAGE WAS STALLED' };
  return { ok: true, reason: '' };
}

/** everything the run produced */
export interface BenchmarkOutcome { ok: boolean; /** the class the score was kept for: `id` for a known card, from the speed for a masked one */ cls: ClassId; /** true when the class came from the measured speed (masked card) */ classFromSpeed: boolean; reason: string; score: number; rawScore: number; capped: boolean; sustain: number; backend: BackendId; rates: number[]; discarded: number[]; /** the mean work rate of the kept passes (units per second): the number docs/CALIBRATION.md asks you to report */ meanRate: number }

/** from the passes (work rate and clock time of each) to the outcome */
export function outcomeFromPasses(passes: { rate: number; wallMs: number }[], runMs: number, wasHidden: boolean, backend: BackendId, id: ClassId, masked = false): BenchmarkOutcome {
  const rates = passes.map(p => p.rate), blank = { cls: id, classFromSpeed: false, score: 0, rawScore: 0, capped: false, sustain: 0, backend, rates, discarded: [] as number[], meanRate: 0 };
  const dur = checkDurations(passes.map(p => p.wallMs), runMs, wasHidden); if (!dur.ok) return { ok: false, reason: dur.reason, ...blank };
  const sum = summarizePasses(rates); if (!sum.ok) return { ok: false, reason: sum.reason, ...blank, sustain: sum.sustain, discarded: sum.discarded };
  const cls = masked ? classForMaskedRate(sum.rate, backend) : id, raw = scoreFromRate(sum.rate, backend), score = capScore(raw, cls);
  return { ok: true, reason: '', cls, classFromSpeed: masked, score, rawScore: raw, capped: score < raw, sustain: sum.sustain, backend, rates, discarded: sum.discarded, meanRate: sum.rate };
}

/** the work rate in plain words, for example "612.0 G units/s" */
export const rateText = (rate: number): string => (rate >= 1e12 ? `${(rate / 1e12).toFixed(2)} T` : rate >= 1e9 ? `${(rate / 1e9).toFixed(1)} G` : `${(rate / 1e6).toFixed(1)} M`) + ' units/s';
/** THE CALIBRATION LINE: the raw (uncapped) score, the score kept for the class, the class cap and the mean work rate. It is shown on the result screen and written to the console, so a player can report it (docs/CALIBRATION.md). */
export const calibrationLine = (o: BenchmarkOutcome, id: ClassId): string => `RAW SCORE ${o.rawScore} (KEPT ${o.score}, CLASS CAP ${classScoreCap(id)}) | RATE ${o.meanRate.toExponential(3)} units/s (${rateText(o.meanRate)}) | ${o.backend} | version ${BENCHMARK.version}`;
