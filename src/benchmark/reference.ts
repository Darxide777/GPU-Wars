// REFERENCE CARDS: measured (or, until someone reports it, guessed) work rates of real cards on this benchmark, so the `BENCHMARK.rate` ranges can be checked against hardware.
// The rate is what the result screen and the console print as `RATE ... units/s`. Replace a guess with a measurement and say so in `source`. docs/CALIBRATION.md says how.
export interface ReferenceCard { name: string; class: string; /** work units per second, as the benchmark reports it */ rate: number; /** where the number comes from */ source: 'placeholder' | 'measured'; /** what the car should do in the quarter mile (s) */ targetEt?: number }
export const REFERENCE_CARDS: readonly ReferenceCard[] = [
  /** the owner's own machine, a strong integrated GPU (a guess: about 12 TFLOP of fp32 at roughly 5% of peak on this shader): it must land near a 10 s car. Report the real rate and replace this. */
  { name: 'AMD Radeon 8060S', class: 'integrated', rate: 6e11, source: 'placeholder', targetEt: 10 },
];
