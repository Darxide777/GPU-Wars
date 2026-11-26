// REFERENCE CARDS: measured (or, until someone reports it, guessed) work rates of real cards on this benchmark, so the `BENCHMARK.rate` ranges can be checked against hardware.
// The rate is what the result screen and the console print as `RATE ... units/s`. Replace a guess with a measurement and say so in `source`. docs/CALIBRATION.md says how.
export interface ReferenceCard { name: string; class: string; /** work units per second, as the benchmark reports it */ rate: number; /** where the number comes from */ source: 'placeholder' | 'measured'; /** what the car should do in the quarter mile (s) */ targetEt?: number }
export const REFERENCE_CARDS: readonly ReferenceCard[] = [
  /** the owner's own machine, a strong integrated GPU: a REAL MEASUREMENT (raw score 5005, a second reading 4944; the rate that gives it on the unchanged BENCHMARK.rate scale; 2026-11-25). The integrated table gives about 10.3 s at that score, which the owner accepts as about 10 s. */
  { name: 'AMD Radeon 8060S', class: 'integrated', rate: 3.4726e11, source: 'measured', targetEt: 10.3 },
  /** a phone: a Samsung Galaxy S24 Ultra (Adreno 750), a REAL MEASUREMENT reported by the owner (raw score 1302; the rate that gives it on the unchanged BENCHMARK.rate scale; 2026-11-26). About 16 percent of the 8060S's rate, close to its share of the raw compute, so the log scale spreads phones and desktop chips alike. The integrated table gives about 11.7 s at that score. */
  { name: 'Samsung Galaxy S24 Ultra (phone)', class: 'integrated', rate: 5.67e10, source: 'measured', targetEt: 11.69 },
  /** Discrete cards, ALL placeholders: a guess of about 5% of the card's fp32 peak on this shader (a rough ratio, not the 8060S's measured one). They check that the log score scale spreads weak and strong discrete cards over the one wide discrete window. */
  { name: 'NVIDIA GeForce GT 710 (weakest)', class: 'discrete', rate: 1.8e10, source: 'placeholder', targetEt: 6.94 },
  { name: 'NVIDIA GeForce GTX 750 Ti', class: 'discrete', rate: 6.5e10, source: 'placeholder' },
  { name: 'NVIDIA GeForce GTX 1060', class: 'discrete', rate: 2.2e11, source: 'placeholder' },
  { name: 'NVIDIA GeForce RTX 3060', class: 'discrete', rate: 6.4e11, source: 'placeholder' },
  { name: 'NVIDIA GeForce RTX 4070', class: 'discrete', rate: 1.45e12, source: 'placeholder' },
  { name: 'NVIDIA GeForce RTX 4090', class: 'discrete', rate: 4.1e12, source: 'placeholder', targetEt: 4.05 },
];
