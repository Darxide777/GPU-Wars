// Shared class ids for GPU Wars. Pure data, no imports: the game can import this file directly.
// COPY of backend/src/classes.ts (branch feature/leaderboard-backend): keep the two identical until a shared package exists. Only the label helpers at the bottom are added here.
//
// Class = "integrated"  OR  "discrete-<vendor>-<era>".
// Vendors: amd, nvidia, intel, other.  Eras (GPU generation buckets by release year):
//   retro (before 2014), classic (2014-2017), modern (2018-2021), current (2022 and later).
// Quarter-mile ET floors are the fastest believable time for that class; they are tunable
// anti-cheat bounds, not game physics.

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
  retro: { minQuarterEt: 5.2, maxQuarterEt: 30, minTrapSpeed: 60, maxTrapSpeed: 260 },
  classic: { minQuarterEt: 4.8, maxQuarterEt: 30, minTrapSpeed: 60, maxTrapSpeed: 280 },
  modern: { minQuarterEt: 4.4, maxQuarterEt: 30, minTrapSpeed: 60, maxTrapSpeed: 300 },
  current: { minQuarterEt: 3.6, maxQuarterEt: 30, minTrapSpeed: 60, maxTrapSpeed: 340 },
};

export const CLASS_IDS: ClassId[] = [
  'integrated',
  ...VENDORS.flatMap((v) => ERAS.map((e) => `discrete-${v}-${e}` as ClassId)),
];

export const CLASS_BOUNDS: Record<ClassId, ClassBounds> = Object.fromEntries(
  CLASS_IDS.map((id) => [
    id,
    id === 'integrated'
      ? { minQuarterEt: 5.6, maxQuarterEt: 30, minTrapSpeed: 60, maxTrapSpeed: 250 }
      : ERA_BOUNDS[id.split('-')[2] as Era],
  ]),
) as Record<ClassId, ClassBounds>;

export function isClassId(value: unknown): value is ClassId {
  return typeof value === 'string' && (CLASS_IDS as string[]).includes(value);
}
export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

const ERA_YEARS: Record<Era, string> = { retro: 'BEFORE 2014', classic: '2014-2017', modern: '2018-2021', current: '2022 AND LATER' };
/** the name shown on screen, for example "DISCRETE NVIDIA MODERN" */
export function classLabel(id: ClassId): string {
  if (id === 'integrated') return 'INTEGRATED';
  const [, vendor, era] = id.split('-') as [string, Vendor, Era];
  return `DISCRETE ${vendor.toUpperCase()} ${era.toUpperCase()}`;
}
/** a line saying what the class covers */
export function classNote(id: ClassId): string {
  if (id === 'integrated') return 'graphics built into the processor or a phone chip';
  const era = id.split('-')[2] as Era;
  return `a separate graphics card, released ${ERA_YEARS[era]}`;
}
/** the era of a class (integrated has none) */
export const eraOf = (id: ClassId): Era | null => (id === 'integrated' ? null : (id.split('-')[2] as Era));
