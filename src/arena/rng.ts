// A small seeded random source (mulberry32): the same seed gives the same numbers, so a whole match can be replayed exactly.
export interface Rng { next(): number; range(a: number, b: number): number; int(n: number): number; pick<T>(a: readonly T[]): T; state(): number }
export function createRng(seed: number): Rng {
  let s = (seed >>> 0) || 1;
  const next = (): number => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, range: (a, b) => a + (b - a) * next(), int: n => Math.floor(next() * n), pick: <T>(a: readonly T[]): T => a[Math.floor(next() * a.length)] as T, state: () => s };
}
