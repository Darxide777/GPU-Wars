// TUNE SLOTS: a few named places to keep a tune in Formula, Drag and Rocket, so you can have different ones for different tracks, cars, weather or whatever you like (pure functions, no screen, no clock).
// A slot holds a copy of a tune (a plain object: each game makes it safe again when it is used or loaded) and a name. Every function returns a new array and leaves the one it was given alone.

/** how many slots each game keeps */
export const SLOT_COUNT = 6;
export interface TuneSlot { name: string; tune: Record<string, unknown> }
/** always SLOT_COUNT long; null is an empty slot */
export type TuneSlots = (TuneSlot | null)[];
/** the second half of a slot's name: what it is for, when it is not a place (the first half is the track, car or flight target) */
export const SLOT_CONDITIONS = ['', 'DRY', 'WET', 'HOT', 'COLD', 'NIGHT', 'SPRINT', 'LONG RACE', 'QUALIFYING'];
const NAME_MAX = 30;

export const emptySlots = (): TuneSlots => Array.from({ length: SLOT_COUNT }, () => null);
/** slots from a save, repaired: the right length, names short and printable, each tune a plain object run through the game's own `clean` */
export function cleanSlots(raw: unknown, clean: (t: Record<string, unknown>) => Record<string, unknown>): TuneSlots {
  const out = emptySlots(); if (!Array.isArray(raw)) return out;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const s = raw[i] as { name?: unknown; tune?: unknown } | null | undefined; if (!s || typeof s !== 'object' || !s.tune || typeof s.tune !== 'object' || Array.isArray(s.tune)) continue;
    const name = (typeof s.name === 'string' ? s.name : '').replace(/[^\x20-\x7e]/g, '').trim().toUpperCase().slice(0, NAME_MAX);
    out[i] = { name: name || `SLOT ${i + 1}`, tune: clean(JSON.parse(JSON.stringify(s.tune)) as Record<string, unknown>) };
  }
  return out;
}
/** keep `tune` in slot `i` under `name` (a name left empty is "SLOT n") */
export function putSlot(slots: TuneSlots, i: number, name: string, tune: Record<string, unknown>): TuneSlots {
  if (!(i >= 0 && i < SLOT_COUNT)) return slots; const out = [...cleanSlots(slots, t => t)]; out[i] = { name: name.trim().toUpperCase().slice(0, NAME_MAX) || `SLOT ${i + 1}`, tune: JSON.parse(JSON.stringify(tune)) as Record<string, unknown> }; return out;
}
export function clearSlot(slots: TuneSlots, i: number): TuneSlots { if (!(i >= 0 && i < SLOT_COUNT)) return slots; const out = [...cleanSlots(slots, t => t)]; out[i] = null; return out; }
/** a name from its two halves: "CITY WET", "WET", "CITY" or nothing */
export const slotName = (place: string, condition: string): string => [place, condition].filter(Boolean).join(' ');
/** the next entry of a list after `cur` (d = 1) or before it (d = -1), going round */
export const cycle = <T>(list: readonly T[], cur: T, d: number): T => list[(Math.max(0, list.indexOf(cur)) + d + list.length * 4) % list.length] as T;
