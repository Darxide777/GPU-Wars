// The rules around the benchmark, with no screen: when it must be run again, and what happens to an old save. Pure functions, so the tests can check them.
//
// RE-RUN: a saved result stands until the graphics card (`gpuId`), the benchmark's `version` or the DETECTED CLASS changes. Nothing else (a new day, a new tab) asks for it again.
// THE CLASS IS NEVER PICKED: it is always the class the game detects from the graphics card (src/benchmark/gpu.ts). A save from an older build may hold a hand-picked class or a `classLock`;
// `repairBenchmark` throws such a result away so the car goes back to stock numbers until the benchmark is run again in the detected class.
import type { ClassId } from '../classes.ts';
import { BENCHMARK } from './constants.ts';
import type { BenchmarkResult, Save } from '../save.ts';
import type { GpuIdentity } from './gpu.ts';

export type RerunReason = 'never run' | 'new graphics card' | 'new benchmark version' | 'class changed' | null;
/** why the benchmark must be run (null: the saved result is still good). `detectedClass` is the class the game sees now. */
export function rerunReason(result: BenchmarkResult | null, gpuId: string, version: number = BENCHMARK.version, detectedClass: ClassId | null = null): RerunReason {
  if (!result) return 'never run';
  if (result.gpuId !== gpuId) return 'new graphics card';
  if (result.benchmarkVersion !== version) return 'new benchmark version';
  if (detectedClass && result.class !== detectedClass) return 'class changed';
  return null;
}
export const needsBenchmark = (result: BenchmarkResult | null, gpu: Pick<GpuIdentity, 'gpuId' | 'gpuClass'>, version: number = BENCHMARK.version): boolean => rerunReason(result, gpu.gpuId, version, gpu.gpuClass) !== null;

/** the save with a benchmark result that does not match the detected class removed (null: nothing to repair). The page keeps the rest of the save. */
export function repairBenchmark(save: Save, gpu: Pick<GpuIdentity, 'gpuClass' | 'ready'>): Save | null {
  if (!gpu.ready || !save.benchmark || save.benchmark.class === gpu.gpuClass) return null;
  return { ...save, benchmark: null };
}

/** a benchmark result from a finished run, made ready to save */
export function resultFromRun(o: { score: number; sustain: number; cls: ClassId; gpuId: string; now: number }): BenchmarkResult {
  return { score: o.score, class: o.cls, benchmarkVersion: BENCHMARK.version, gpuId: o.gpuId, date: Math.max(0, Math.floor(o.now)), sustain: Math.max(0, Math.min(1, o.sustain)) };
}
