// The settings, with no screen attached: volume, and which keys do what (every key can be rebound). Kept apart from the save so erasing a save never loses your controls.
// The OPTIONS screen that edits these is a later phase; the page already reads the binds from here.
import type { Store } from '../browser-store.ts';

export const OPTIONS_KEY = 'gpuwars.options';
export type Binds = Record<string, string[]>;
export interface Options { music: number; binds: Binds }

/** each action has up to two keys. A key does one thing: no two actions share a default. */
export const DEFAULT_BINDS: Binds = {
  gas: ['w', 'ArrowUp'], brake: ['s', 'ArrowDown'], steerLeft: ['a', 'ArrowLeft'], steerRight: ['d', 'ArrowRight'],
  chute: ['n', ''], shiftUp: ['e', ''], shiftDown: ['q', ''], burnout: ['j', ''], nitro: ['Shift', ''],
  launch: ['u', ' '], deepStage: ['h', ''],
  /** reverse slowly after the burnout run-out, back to the pre-stage beam */ backUp: ['r', ''],
};
/** the actions the OPTIONS screen will let you rebind, in order, with their names */
export const BIND_ROWS: [string, string][] = [
  ['gas', 'GAS'], ['brake', 'BRAKE'], ['steerLeft', 'TURN LEFT'], ['steerRight', 'TURN RIGHT'], ['chute', 'CHUTE (AFTER THE LINE) / ABORT (BEFORE)'], ['shiftUp', 'SHIFT UP (MANUAL)'], ['shiftDown', 'SHIFT DOWN (MANUAL)'],
  ['burnout', 'BURNOUT (OR HOLD GAS + BRAKE)'], ['nitro', 'NITRO'], ['launch', 'LAUNCH / ROLL OUT'], ['deepStage', 'DEEP STAGE (HOLD)'], ['backUp', 'BACK UP (HOLD)'],
];
/** keys the menus need, so they cannot be given to an action */
export const RESERVED_KEYS: string[] = ['Escape', 'Enter', 'Tab'];

const volume = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, Math.round(v * 100) / 100)) : d);
const copyBinds = (b: Binds): Binds => Object.fromEntries(Object.keys(DEFAULT_BINDS).map(id => [id, [...(b[id] as string[])]]));

/** Turns whatever was stored (maybe old, partial or damaged) into valid options. */
export function sanitizeOptions(raw: unknown): Options {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>, binds = copyBinds(DEFAULT_BINDS);
  for (const id of Object.keys(DEFAULT_BINDS)) {
    const v = r.binds?.[id];
    if (Array.isArray(v) && v.some(k => typeof k === 'string' && k)) binds[id] = [0, 1].map(i => (typeof v[i] === 'string' ? v[i] as string : ''));
  }
  return { music: volume(r.music, 0.5), binds };
}
export function loadOptions(store: Store): Options { let raw: unknown = null; try { raw = JSON.parse(store.get(OPTIONS_KEY) || 'null'); } catch (e) { /* damaged: use the defaults */ } return sanitizeOptions(raw); }
export function saveOptions(store: Required<Store>, o: Options): void { try { store.set(OPTIONS_KEY, JSON.stringify(o)); } catch (e) { /* cannot be kept */ } }

/** How a key is named on screen. */
export function keyLabel(k: string): string { if (!k) return '-'; if (k === ' ') return 'SPACE'; return k.replace('Arrow', '').toUpperCase(); }

/**
 * Gives `action` the key `key` in place of its first key. A key can only do one thing: if another action had it, it loses it, unless that would leave that action with no key at all, in which case nothing changes.
 * Returns { ok, binds, why } (binds is a new object; the old one is left alone).
 */
export function assignKey(binds: Binds, action: string, key: string): { ok: boolean; binds: Binds; why?: string } {
  if (!(action in DEFAULT_BINDS)) return { ok: false, binds, why: 'unknown action' };
  if (!key || RESERVED_KEYS.includes(key)) return { ok: false, binds, why: `${keyLabel(key)} IS USED BY THE MENUS` };
  const next = copyBinds(binds);
  for (const id of Object.keys(next)) {
    if (id === action || !(next[id] as string[]).includes(key)) continue;
    const left = (next[id] as string[]).filter(k => k && k !== key);
    if (left.length === 0) return { ok: false, binds, why: `${keyLabel(key)} IS THE ONLY KEY FOR ${id.toUpperCase()}` };
    next[id] = [left[0] as string, left[1] || ''];
  }
  const mine = next[action] as string[]; next[action] = [key, mine[1] === key ? '' : (mine[1] as string)];      // the new key replaces the first one; the second key stays
  return { ok: true, binds: next };
}
export const resetControls = (o: Options): Options => ({ ...o, binds: copyBinds(DEFAULT_BINDS) });
