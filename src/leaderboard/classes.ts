// The class ids the leaderboard uses. This is a COPY of backend/src/classes.ts (branch feature/leaderboard-backend): keep the two identical.
// A test (tests/leaderboard.test.mjs) imports the backend file when it is present and checks the ids and bounds still agree.
//
// Class = "integrated"  OR  "discrete-<vendor>-<era>". Eras are GPU generations by release year.
export const VENDORS = ['amd', 'nvidia', 'intel', 'other'] as const;
export const ERAS = ['retro', 'classic', 'modern', 'current'] as const;
export type Vendor = (typeof VENDORS)[number];
export type Era = (typeof ERAS)[number];
export type ClassId = 'integrated' | `discrete-${Vendor}-${Era}`;
export const CATEGORIES = ['manual', 'autopilot'] as const;
export type Category = (typeof CATEGORIES)[number];

/** the fastest believable quarter-mile time for a class, and the trap speed limits (mph): the server's anti-cheat bounds */
export interface ClassBounds { minQuarterEt: number; maxQuarterEt: number; maxTrapSpeed: number; minTrapSpeed: number }

const ERA_BOUNDS: Record<Era, ClassBounds> = {
  retro: { minQuarterEt: 5.2, maxQuarterEt: 30, minTrapSpeed: 60, maxTrapSpeed: 260 },
  classic: { minQuarterEt: 4.8, maxQuarterEt: 30, minTrapSpeed: 60, maxTrapSpeed: 280 },
  modern: { minQuarterEt: 4.4, maxQuarterEt: 30, minTrapSpeed: 60, maxTrapSpeed: 300 },
  current: { minQuarterEt: 3.6, maxQuarterEt: 30, minTrapSpeed: 60, maxTrapSpeed: 340 },
};

export const CLASS_IDS: ClassId[] = ['integrated', ...VENDORS.flatMap(v => ERAS.map(e => `discrete-${v}-${e}` as ClassId))];

export const CLASS_BOUNDS: Record<ClassId, ClassBounds> = Object.fromEntries(
  CLASS_IDS.map(id => [id, id === 'integrated' ? { minQuarterEt: 5.6, maxQuarterEt: 30, minTrapSpeed: 60, maxTrapSpeed: 250 } : ERA_BOUNDS[id.split('-')[2] as Era]]),
) as Record<ClassId, ClassBounds>;

export const isClassId = (value: unknown): value is ClassId => typeof value === 'string' && (CLASS_IDS as string[]).includes(value);
export const isCategory = (value: unknown): value is Category => typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);

/** the era of a class (integrated graphics are their own, slowest, group) */
export const eraOf = (id: ClassId): Era | 'integrated' => (id === 'integrated' ? 'integrated' : (id.split('-')[2] as Era));
/** a class named for a person: "DISCRETE NVIDIA CURRENT", "INTEGRATED" */
export const classLabel = (id: string): string => (isClassId(id) ? id.replace(/-/g, ' ').toUpperCase() : 'UNKNOWN CLASS');

/** the class a player races in when they have not run the benchmark yet (no score is sent from it) */
export const DEFAULT_CLASS: ClassId = 'integrated';
