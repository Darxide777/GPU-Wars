// Shared class ids for GPU Wars. Pure data, no imports: the game can import this file directly.
//
// Class = "integrated"  OR  "discrete-<vendor>-<era>".
// Vendors: amd, nvidia, intel, other.  Eras (GPU generation buckets by release year):
//   retro (before 2014), classic (2014-2017), modern (2018-2021), current (2022 and later).
// Quarter-mile ET floors are the fastest believable time for that class; they are tunable
// anti-cheat bounds, not game physics. They sit a little outside what the simulation gives for the
// class's top card with a perfect tune on the thinnest, coolest, grippiest day (measured over 80 seeds,
// see docs/CALIBRATION.md): current 3.9 s at up to 351 mph, modern 4.4 at 300, classic 4.98 at 260,
// retro 5.68 at 228, integrated 9.07 at 145. The ceiling on ET is generic (a bad run is slow, not impossible).

export const VENDORS = ['amd', 'nvidia', 'intel', 'other'] as const;
export const ERAS = ['retro', 'classic', 'modern', 'current'] as const;
export type Vendor = (typeof VENDORS)[number];
export type Era = (typeof ERAS)[number];
export type ClassId = 'integrated' | `discrete-${Vendor}-${Era}`;
export const CATEGORIES = ['manual', 'autopilot'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface ClassBounds {
  minQuarterEt: number; // seconds
  maxQuarterEt: number;
  maxTrapSpeed: number; // mph
  minTrapSpeed: number;
}

const ERA_BOUNDS: Record<Era, ClassBounds> = {
  retro: { minQuarterEt: 5.3, maxQuarterEt: 30, minTrapSpeed: 60, maxTrapSpeed: 245 },
  classic: { minQuarterEt: 4.6, maxQuarterEt: 30, minTrapSpeed: 60, maxTrapSpeed: 280 },
  modern: { minQuarterEt: 4.1, maxQuarterEt: 30, minTrapSpeed: 60, maxTrapSpeed: 320 },
  current: { minQuarterEt: 3.6, maxQuarterEt: 30, minTrapSpeed: 60, maxTrapSpeed: 370 },
};

export const CLASS_IDS: ClassId[] = [
  'integrated',
  ...VENDORS.flatMap((v) => ERAS.map((e) => `discrete-${v}-${e}` as ClassId)),
];

export const CLASS_BOUNDS: Record<ClassId, ClassBounds> = Object.fromEntries(
  CLASS_IDS.map((id) => [
    id,
    id === 'integrated'
      ? { minQuarterEt: 8.5, maxQuarterEt: 30, minTrapSpeed: 60, maxTrapSpeed: 170 }
      : ERA_BOUNDS[id.split('-')[2] as Era],
  ]),
) as Record<ClassId, ClassBounds>;

export function isClassId(value: unknown): value is ClassId {
  return typeof value === 'string' && (CLASS_IDS as string[]).includes(value);
}
export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}
