// The neon equalizer from Chromium Halo: Neon (src/neon/building-eq.ts), without Three.js: GPU Wars has no 3D scene, so only the part that follows the music is kept.
// Give it the band levels each frame (`setLevels`, empty with no music) and step it: the levels rise fast and fall slowly, and each band keeps a peak mark that falls slower still.
// The benchmark draws these bars in its shader (src/benchmark/workload.ts).
export const EQ_BANDS = 16;

/** a band's colour as red, green and blue (0 to 1): magenta for the bass through violet to cyan for the highs, the same as the bars in Chromium Halo: Neon */
export function eqColour(band: number): [number, number, number] {
  const t = band / (EQ_BANDS - 1), from = t < 0.5 ? [1, 0.169, 0.839] : [0.541, 0.361, 1], to = t < 0.5 ? [0.541, 0.361, 1] : [0.129, 0.902, 1], k = t < 0.5 ? t * 2 : t * 2 - 1;
  return [from[0]! + (to[0]! - from[0]!) * k, from[1]! + (to[1]! - from[1]!) * k, from[2]! + (to[2]! - from[2]!) * k];
}

export function createBuildingEq() {
  const levels: number[] = new Array(EQ_BANDS).fill(0), peaks: number[] = new Array(EQ_BANDS).fill(0), fade = { k: 0 };
  let input: readonly number[] = [];
  return {
    /** the music's equalizer right now (each band 0 to 1), or none */
    setLevels(l: readonly number[]): void { input = l; },
    /** one step of `dt` seconds */
    step(dt: number): void {
      const on = input.length > 0; fade.k += ((on ? 1 : 0) - fade.k) * Math.min(1, dt * 5); if (!on && fade.k < 0.004) fade.k = 0;
      const rise = 1 - Math.exp(-48 * dt), fall = 1 - Math.exp(-13 * dt);
      for (let b = 0; b < EQ_BANDS; b++) {
        let target = 0;
        if (on) { const u = b / (EQ_BANDS - 1) * (input.length - 1), a = Math.floor(u), f = u - a; target = (input[a] as number) * (1 - f) + (input[Math.min(a + 1, input.length - 1)] as number) * f; }
        const current = levels[b] as number; levels[b] = current + (target - current) * (target > current ? rise : fall);
        const shown = Math.min(1, (levels[b] as number) * 1.5); peaks[b] = Math.max(shown, (peaks[b] as number) - 0.72 * dt);
      }
    },
    /** each band's bar height now, 0 to 1 */
    bars(): number[] { return levels.map(v => Math.min(1, v * 1.5) * fade.k); },
    /** each band's falling peak mark, 0 to 1 */
    peakMarks(): number[] { return peaks.map(v => v * fade.k); },
  };
}
