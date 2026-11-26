// Every number the benchmark can be tuned with, in one place. Turn `version` whenever the workload or the scoring changes: every saved result is then out of date and must be re-run.
// The two `rate` ranges (rateMin, rateMax) are the first things to calibrate on real hardware: they decide which graphics card scores what.
import type { ClassId } from '../classes.ts';
export type BackendId = 'webgl2' | 'webgl1' | 'canvas2d';

export const BENCHMARK = {
  /** the version of the workload and the scoring; a saved result with another version must be run again */
  version: 2,
  /** warm-up before the timed passes: shaders compile, clocks rise and the batch size settles. Not scored. */
  warmupMs: 2000,
  /** how many timed passes, and how long each lasts */
  passes: 5, passMs: 2000,
  /** a pass slower than the median by more than this share is a thermal-throttled outlier and is discarded */
  throttleDrop: 0.2,
  /** a pass faster than the median by more than this share is a boost spike and is discarded too */
  spikeRise: 0.35,
  /** at least this many passes must survive the discarding, or the run is unstable and must be repeated */
  minKeptPasses: 3,
  /** plausible duration: every timed pass must take between these shares of `passMs` on the clock (a hidden tab or a stalled page runs long, a broken timer runs short) */
  minPassShare: 0.9, maxPassShare: 1.6,
  /** the whole run, warm-up included, must finish within this many ms of the clock or it is thrown away */
  maxRunMs: 30000,
  /** the highest score there is; anything above is capped to it */
  maxScore: 10000,
  /** the work each frame is drawn at, whatever the window size (so every card does the same work) */
  width: 1280, height: 720,
  /** the loop count of the fragment shader: more is heavier per pixel */
  shaderIterations: 160,
  /** one sync should take about this long: the batch of draws before it grows or shrinks to fit (ms) */
  batchTargetMs: 30,
  /** work units per second that score 0 and the full `maxScore` (log scale), for each way of drawing. One unit is one shader iteration of one pixel (or one filled pixel on the 2D canvas). Calibrate on real cards. */
  rate: {
    webgl2: { min: 3e10, max: 4e12 },
    webgl1: { min: 3e10, max: 4e12 },
    canvas2d: { min: 1e8, max: 1e10 },
  } as Record<BackendId, { min: number; max: number }>,
  /** the 2D canvas fallback is not a real GPU test: its score can never pass this share of `maxScore` */
  canvas2dScoreShare: 0.4,
  /** what the screen shows */
  hudText: 'ESC TO CANCEL',
} as const;

/** the most a class may score as a share of `maxScore`, so a wrongly chosen or impossible score cannot out-run its class (a tunable anti-cheat bound, like the backend's ET floors) */
export const CLASS_SCORE_SHARE = { integrated: 0.8, discrete: 1 } as const satisfies Record<ClassId, number>;

/** THE RULE FOR A MASKED CARD (the browser hides its name, see gpu.ts): the class comes from the measured work rate. A rate above `referenceRate(referenceCard) x margin` is more than any built-in GPU does: DISCRETE; otherwise INTEGRATED.
 *  The reference is the strongest integrated card in reference.ts (the 8060S, MEASURED at score 5005). A margin of 2 puts the line at twice its rate (score about 6420, a class cap of 8000 is above it): a faster iGPU or a boost spike is still integrated, only a card clearly beyond any built-in GPU becomes discrete.
 *  Conservative on purpose: a strong iGPU must never be raced as discrete; a masked weak discrete card is raced as integrated (slower class, honest score). Documented in docs/CALIBRATION.md. */
export const MASKED_GPU_RULE = { referenceCard: 'AMD Radeon 8060S', margin: 2 } as const;
