// The class ids, vendors, eras and bounds come from ONE file: backend/src/classes.ts (pure data, no imports), which the leaderboard server also uses.
// This file re-exports it and adds what only the game needs: names to show on screen.
export * from '../backend/src/classes.ts';
import { isClassId, type ClassId, type Era, type Vendor } from '../backend/src/classes.ts';

/** the class a player races in when they have not run the benchmark yet (no score is sent from it) */
export const DEFAULT_CLASS: ClassId = 'integrated';

const ERA_YEARS: Record<Era, string> = { retro: 'BEFORE 2014', classic: '2014-2017', modern: '2018-2021', current: '2022 AND LATER' };
/** the name shown on screen, for example "DISCRETE NVIDIA MODERN" */
export function classLabel(id: ClassId): string {
  if (!isClassId(id)) return 'UNKNOWN CLASS';
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
