// The rules around the benchmark, with no screen: when it must be run again, and when the class can be changed. Pure functions, so the tests can check them.
//
// RE-RUN: a saved result stands until the graphics card (`gpuId`) or the benchmark's `version` changes. Nothing else (a new day, a new tab) asks for it again.
// CLASS LOCK: a class that the browser's own text plainly names is "detected" and cannot be changed. When the text does not say, the player picks the class by hand; ENTER on the CLASS row
// locks it for that card. A lock belongs to one `gpuId`: on a different card it no longer applies and the pick starts again. A result already benchmarked also locks the class it was run with.
import { CLASS_IDS, isClassId, type ClassId } from '../classes.ts';
import { BENCHMARK } from './constants.ts';
import type { BenchmarkResult, ClassLock } from '../save.ts';
import type { GpuIdentity } from './gpu.ts';

export type RerunReason = 'never run' | 'new graphics card' | 'new benchmark version' | null;
/** why the benchmark must be run (null: the saved result is still good) */
export function rerunReason(result: BenchmarkResult | null, gpuId: string, version: number = BENCHMARK.version): RerunReason {
  if (!result) return 'never run';
  if (result.gpuId !== gpuId) return 'new graphics card';
  if (result.benchmarkVersion !== version) return 'new benchmark version';
  return null;
}
export const needsBenchmark = (result: BenchmarkResult | null, gpuId: string, version: number = BENCHMARK.version): boolean => rerunReason(result, gpuId, version) !== null;

export interface ClassState {
  /** the class now in force, or null while the player still has to pick */
  locked: ClassId | null;
  /** how it was fixed: named by the browser, picked by the player, or not yet */
  how: 'detected' | 'manual' | 'none';
  /** whether LEFT and RIGHT on the CLASS row may change it */
  canChange: boolean;
}
/** which class applies to this card and whether it can still be changed */
export function classState(gpu: Pick<GpuIdentity, 'gpuId' | 'detectedClass'>, lock: ClassLock | null, result: BenchmarkResult | null): ClassState {
  if (gpu.detectedClass) return { locked: gpu.detectedClass, how: 'detected', canChange: false };
  if (lock && lock.gpuId === gpu.gpuId && isClassId(lock.class)) return { locked: lock.class, how: 'manual', canChange: false };
  // a benchmark already run on this card was run in a class: keep it (it was locked when it was made, even if the lock was lost)
  if (result && result.gpuId === gpu.gpuId && isClassId(result.class)) return { locked: result.class, how: 'manual', canChange: false };
  return { locked: null, how: 'none', canChange: true };
}
/** the next class in the list when picking by hand (wraps around); starts from the first when none is shown */
export function stepClass(current: ClassId | null, d: number): ClassId {
  const i = current ? CLASS_IDS.indexOf(current) : -1, n = CLASS_IDS.length;
  return CLASS_IDS[((i < 0 ? (d > 0 ? 0 : n - 1) : i + d) % n + n) % n] as ClassId;
}
/** lock a hand-picked class to this card: refused when the class is already fixed or is not a real class */
export function lockClass(state: ClassState, gpuId: string, pick: unknown, now: number): ClassLock | null {
  if (!state.canChange || !isClassId(pick) || !gpuId) return null;
  return { class: pick, gpuId, date: Math.max(0, Math.floor(now)) };
}

/** a benchmark result from a finished run, made ready to save */
export function resultFromRun(o: { score: number; sustain: number; cls: ClassId; gpuId: string; now: number }): BenchmarkResult {
  return { score: o.score, class: o.cls, benchmarkVersion: BENCHMARK.version, gpuId: o.gpuId, date: Math.max(0, Math.floor(o.now)), sustain: Math.max(0, Math.min(1, o.sustain)) };
}
