// The rules around the benchmark, with no screen: when it must be run again, and what happens to an old save. Pure functions, so the tests can check them.
//
// RE-RUN: a saved result stands until the graphics card (`gpuId`), the benchmark's `version` or the DETECTED CLASS changes. Nothing else (a new day, a new tab) asks for it again.
// THE CLASS IS NEVER PICKED: it is always the class the game detects from the graphics card (src/benchmark/gpu.ts). A save from an older build may hold a hand-picked class or a `classLock`;
// `repairBenchmark` throws such a result away so the car goes back to stock numbers until the benchmark is run again in the detected class.
import type { ClassId } from '../classes.ts';
import { BENCHMARK } from './constants.ts';
import type { BenchmarkResult, Save } from '../save.ts';
import type { GpuIdentity } from './gpu.ts';
import { classScoreCap, maskedDiscreteMinScore } from './score.ts';

export type RerunReason = 'never run' | 'new graphics card' | 'new benchmark version' | 'class changed' | null;
/** why the benchmark must be run (null: the saved result is still good). `detectedClass` is the class the game sees now. */
export function rerunReason(result: BenchmarkResult | null, gpuId: string, version: number = BENCHMARK.version, detectedClass: ClassId | null = null, masked = false): RerunReason {
  if (!result) return 'never run';
  if (result.gpuId !== gpuId) return 'new graphics card';
  if (result.benchmarkVersion !== version) return 'new benchmark version';
  // a masked card's class came from its measured speed: the pre-benchmark default (integrated) is not compared with it, or the two would flip-flop
  if (detectedClass && !(masked && result.classFromSpeed) && result.class !== detectedClass) return 'class changed';
  return null;
}
export const needsBenchmark = (result: BenchmarkResult | null, gpu: Pick<GpuIdentity, 'gpuId' | 'gpuClass'> & { masked?: boolean }, version: number = BENCHMARK.version): boolean => rerunReason(result, gpu.gpuId, version, gpu.gpuClass, gpu.masked === true) !== null;

/** the save with a benchmark result that does not match the detected class removed (null: nothing to repair). The page keeps the rest of the save. */
export function repairBenchmark(save: Save, gpu: Pick<GpuIdentity, 'gpuClass' | 'ready'> & { masked?: boolean }): Save | null {
  const b = save.benchmark;
  if (!gpu.ready || !b) return null;
  if (gpu.masked && b.classFromSpeed) {
    // a speed-decided class stands, but never a faster class than its score supports (an edited save): discrete needs a score above the masked line, and no class may exceed its cap
    const bad = (b.class !== 'integrated' && b.class !== 'discrete') || (b.class === 'discrete' && b.score < maskedDiscreteMinScore()) || b.score > classScoreCap(b.class as ClassId);
    return bad ? { ...save, benchmark: null } : null;
  }
  if (b.class === gpu.gpuClass) return null;
  return { ...save, benchmark: null };
}

/** a benchmark result from a finished run, made ready to save */
export function resultFromRun(o: { score: number; sustain: number; cls: ClassId; gpuId: string; now: number; classFromSpeed?: boolean }): BenchmarkResult {
  // a score above the class's cap can never be saved in that class
  const out: BenchmarkResult = { score: Math.min(o.score, classScoreCap(o.cls)), class: o.cls, benchmarkVersion: BENCHMARK.version, gpuId: o.gpuId, date: Math.max(0, Math.floor(o.now)), sustain: Math.max(0, Math.min(1, o.sustain)) };
  if (o.classFromSpeed) out.classFromSpeed = true;
  return out;
}
