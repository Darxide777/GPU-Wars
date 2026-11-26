// Runs the benchmark: a warm-up, then the timed passes, then the score (score.ts). Nothing here needs the real page: the workload, the clock and the waiting are handed in, so the tests run it with a fake card.
import { BENCHMARK, type BackendId } from './constants.ts';
import { outcomeFromPasses, type BenchmarkOutcome } from './score.ts';
import { createWorkload, type Frame, type Workload } from './workload.ts';
import { NO_BEAT, type BeatState } from '../beat/clock.ts';
import type { ClassId } from '../classes.ts';

export type RunResult = { status: 'done'; outcome: BenchmarkOutcome } | { status: 'failed'; reason: string } | { status: 'cancelled' };
export interface RunDeps {
  /** the class the score will be capped for */ cls: ClassId;
  /** the card is masked: the class is decided from the measured speed after the run (`cls` is only the default) */ masked?: boolean;
  /** the song's beat now (the clock's `beatAt` of the playing song, or a made-up beat with no music), and the seconds the shader's animation is at */
  beat: (seconds: number) => BeatState;
  /** where to show the canvas and the status text; leave out to run without showing anything (tests) */ host?: HTMLElement;
  /** a fake card, clock and wait for tests */ createWorkload?: () => Workload | null; now?: () => number; sleep?: () => Promise<void>;
  /** whether the page has been hidden since the run started */ wasHidden?: () => boolean;
  /** told what is happening now: the words and how far along the run is (0 to 1) */ onStatus?: (text: string, progress: number) => void;
}
export interface RunHandle { done: Promise<RunResult>; cancel(): void }

/** the batch of draws between two syncs grows or shrinks so one sync takes about `BENCHMARK.batchTargetMs`, whatever the card */
export function nextBatch(batch: number, tookMs: number): number {
  if (tookMs < BENCHMARK.batchTargetMs * 0.6) return Math.min(256, batch * 2);
  if (tookMs > BENCHMARK.batchTargetMs * 2) return Math.max(1, Math.floor(batch / 2));
  return batch;
}

export function startBenchmark(deps: RunDeps): RunHandle {
  let cancelled = false, hidden = false;
  const now = deps.now ?? (() => performance.now()), sleep = deps.sleep ?? (() => new Promise<void>(r => setTimeout(r, 0)));
  const onHide = (): void => { if (typeof document !== 'undefined' && document.hidden) hidden = true; };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onHide);
  const status = (text: string, progress: number): void => { deps.onStatus?.(text, Math.max(0, Math.min(1, progress))); };
  const done = (async (): Promise<RunResult> => {
    const workload = (deps.createWorkload ?? createWorkload)();
    if (!workload) return { status: 'failed', reason: 'THIS BROWSER CANNOT DRAW THE BENCHMARK' };
    deps.host?.appendChild(workload.canvas);
    try {
      const runStart = now(); let batch = 1;
      /** work for `ms` and return the work units done and the clock time it took */
      const work = async (ms: number, label: (elapsed: number) => void): Promise<{ units: number; wallMs: number }> => {
        const start = now(); let units = 0;
        while (now() - start < ms) {
          if (cancelled) return { units, wallMs: now() - start };
          const t = now(), seconds = (t - runStart) / 1000, beat = deps.beat(seconds) ?? NO_BEAT;
          const frame: Frame = { time: seconds, beat };
          units += workload.run(batch, frame);
          batch = nextBatch(batch, now() - t); label(now() - start); await sleep();
        }
        return { units, wallMs: now() - start };
      };
      const total = BENCHMARK.warmupMs + BENCHMARK.passes * BENCHMARK.passMs;
      await work(BENCHMARK.warmupMs, e => status('WARMING UP', e / total));
      const passes: { rate: number; wallMs: number }[] = [];
      for (let p = 0; p < BENCHMARK.passes && !cancelled; p++) {
        const r = await work(BENCHMARK.passMs, e => status(`PASS ${p + 1} OF ${BENCHMARK.passes}`, (BENCHMARK.warmupMs + p * BENCHMARK.passMs + e) / total));
        if (cancelled) break;
        passes.push({ rate: r.units / Math.max(0.001, r.wallMs / 1000), wallMs: r.wallMs });
      }
      if (cancelled) return { status: 'cancelled' };
      const outcome = outcomeFromPasses(passes, now() - runStart, hidden || (deps.wasHidden?.() ?? false), workload.backend as BackendId, deps.cls, deps.masked === true);
      return outcome.ok ? { status: 'done', outcome } : { status: 'failed', reason: outcome.reason };
    } catch (e) {
      return { status: 'failed', reason: 'THE GRAPHICS CARD STOPPED RESPONDING' };
    } finally {
      workload.canvas.remove(); workload.dispose();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onHide);
    }
  })();
  return { done, cancel(): void { cancelled = true; } };
}
