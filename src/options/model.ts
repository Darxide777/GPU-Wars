// The settings, with no screen attached: volume, and which keys do what (every key can be rebound). Kept apart from the save so erasing a save never loses your controls.
// The OPTIONS screen (src/options/screen.ts) edits these; the input layer (src/input/) reads them.
import type { Store } from '../browser-store.ts';

export const OPTIONS_KEY = 'gpuwars.options';
export type Binds = Record<string, string[]>;
/** gamepad buttons per action (two each, -1 means none): the standard layout's button numbers */
export type PadBinds = Record<string, number[]>;
export type TouchShow = 'auto' | 'on' | 'off';
export type DriverKind = 'manual' | 'autopilot';
export interface TouchOptions { show: TouchShow; /** 0.7 (small) to 1.5 (large) */ size: number; /** the gas pedal reads where on it your thumb is (and the pressure where the screen reports it) */ analog: boolean; haptics: boolean }
export interface Options { music: number; binds: Binds; padBinds: PadBinds; touch: TouchOptions; /** extra milliseconds before a press reaches the car (calibration, 0 to 100) */ latencyOffsetMs: number; driver: DriverKind }

/** each action has up to two keys. A key does one thing: no two actions share a default. */
export const DEFAULT_BINDS: Binds = {
  gas: ['w', 'ArrowUp'], brake: ['s', 'ArrowDown'], steerLeft: ['a', 'ArrowLeft'], steerRight: ['d', 'ArrowRight'],
  chute: ['n', ''], shiftUp: ['e', ''], shiftDown: ['q', ''], burnout: ['j', ''], nitro: ['Shift', ''],
  launch: ['u', ' '], deepStage: ['h', ''], backUp: ['r', ''],
};
/** the gamepad's default buttons (standard layout: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 10 left stick press). The gas and brake read the triggers as analog. Steering is the stick or d-pad, not a button. */
export const DEFAULT_PAD_BINDS: PadBinds = {
  gas: [7, -1], brake: [6, -1], steerLeft: [-1, -1], steerRight: [-1, -1], chute: [3, -1], shiftUp: [5, -1], shiftDown: [4, -1], burnout: [-1, -1], nitro: [1, -1],
  launch: [0, -1], deepStage: [10, -1], backUp: [2, -1],
};
export const DEFAULT_TOUCH: TouchOptions = { show: 'auto', size: 1, analog: true, haptics: true };
export const LATENCY_MAX_MS = 100;
/** the actions the OPTIONS screen will let you rebind, in order, with their names */
export const BIND_ROWS: [string, string][] = [
  ['gas', 'GAS'], ['brake', 'BRAKE'], ['steerLeft', 'TURN LEFT'], ['steerRight', 'TURN RIGHT'], ['chute', 'CHUTE (AFTER THE LINE) / ABORT (BEFORE)'], ['shiftUp', 'SHIFT UP (MANUAL)'], ['shiftDown', 'SHIFT DOWN (MANUAL)'],
  ['burnout', 'BURNOUT (OR HOLD GAS + BRAKE)'], ['nitro', 'NITRO'], ['launch', 'LAUNCH / ROLL OUT'], ['deepStage', 'DEEP STAGE (HOLD)'], ['backUp', 'BACK UP (REVERSE)'],
];
/** keys the menus need, so they cannot be given to an action */
export const RESERVED_KEYS: string[] = ['Escape', 'Enter', 'Tab'];

const volume = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, Math.round(v * 100) / 100)) : d);
const copyPad = (b: PadBinds): PadBinds => Object.fromEntries(Object.keys(DEFAULT_BINDS).map(id => [id, [...((b[id] ?? DEFAULT_PAD_BINDS[id]) as number[])]]));
const copyBinds = (b: Binds): Binds => Object.fromEntries(Object.keys(DEFAULT_BINDS).map(id => [id, [...(b[id] as string[])]]));

/** Turns whatever was stored (maybe old, partial or damaged) into valid options. */
export function sanitizeOptions(raw: unknown): Options {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>, binds = copyBinds(DEFAULT_BINDS);
  for (const id of Object.keys(DEFAULT_BINDS)) {
    const v = r.binds?.[id];
    if (Array.isArray(v) && v.some(k => typeof k === 'string' && k)) binds[id] = [0, 1].map(i => (typeof v[i] === 'string' ? v[i] as string : ''));
  }
  const padBinds = copyPad(DEFAULT_PAD_BINDS);
  for (const id of Object.keys(DEFAULT_BINDS)) {
    const v = r.padBinds?.[id];
    if (Array.isArray(v)) padBinds[id] = [0, 1].map(i => (Number.isInteger(v[i]) && v[i] >= 0 && v[i] < 32 ? v[i] : -1));
  }
  const t = (r.touch && typeof r.touch === 'object' ? r.touch : {}) as Record<string, any>;
  const touch: TouchOptions = { show: t.show === 'on' || t.show === 'off' ? t.show : 'auto', size: typeof t.size === 'number' && Number.isFinite(t.size) ? Math.max(0.7, Math.min(1.5, Math.round(t.size * 10) / 10)) : 1, analog: t.analog !== false, haptics: t.haptics !== false };
  const latencyOffsetMs = typeof r.latencyOffsetMs === 'number' && Number.isFinite(r.latencyOffsetMs) ? Math.max(0, Math.min(LATENCY_MAX_MS, Math.round(r.latencyOffsetMs))) : 0;
  return { music: volume(r.music, 0.5), binds, padBinds, touch, latencyOffsetMs, driver: r.driver === 'autopilot' ? 'autopilot' : 'manual' };
}
export function loadOptions(store: Store): Options { let raw: unknown = null; try { raw = JSON.parse(store.get(OPTIONS_KEY) || 'null'); } catch (e) { /* damaged: use the defaults */ } return sanitizeOptions(raw); }
export function saveOptions(store: Required<Store>, o: Options): void { try { store.set(OPTIONS_KEY, JSON.stringify(o)); } catch (e) { /* cannot be kept */ } }

/** How a key is named on screen. */
export function keyLabel(k: string): string { if (!k) return '-'; if (k === ' ') return 'SPACE'; return k.replace('Arrow', '').toUpperCase(); }

/**
 * Gives `action` the key `key` in key slot `slot` (0 or 1). A key can only do one thing: if another action had it, it loses it, unless that would leave that action with no key at all, in which case nothing changes.
 * Returns { ok, binds, why, tookFrom } (binds is a new object; the old one is left alone; tookFrom names the actions that lost the key).
 */
export function assignKeySlot(binds: Binds, action: string, key: string, slot: 0 | 1): { ok: boolean; binds: Binds; why?: string; tookFrom: string[] } {
  if (!(action in DEFAULT_BINDS)) return { ok: false, binds, why: 'unknown action', tookFrom: [] };
  if (!key || RESERVED_KEYS.includes(key)) return { ok: false, binds, why: `${keyLabel(key)} IS USED BY THE MENUS`, tookFrom: [] };
  const next = copyBinds(binds), tookFrom: string[] = [];
  for (const id of Object.keys(next)) {
    if (id === action || !(next[id] as string[]).includes(key)) continue;
    const left = (next[id] as string[]).filter(k => k && k !== key);
    if (left.length === 0) return { ok: false, binds, why: `${keyLabel(key)} IS THE ONLY KEY FOR ${id.toUpperCase()}`, tookFrom: [] };
    next[id] = [left[0] as string, left[1] || '']; tookFrom.push(id);
  }
  const mine = [...(next[action] as string[])]; mine[slot] = key; if (mine[1 - slot] === key) mine[1 - slot] = '';
  if (!mine[0] && mine[1]) { mine[0] = mine[1]; mine[1] = ''; }
  next[action] = mine; return { ok: true, binds: next, tookFrom };
}
/** the first key of `action` becomes `key` (the second key stays) */
export function assignKey(binds: Binds, action: string, key: string): { ok: boolean; binds: Binds; why?: string; tookFrom: string[] } { return assignKeySlot(binds, action, key, 0); }
/** empties the second key of an action (the first can only be replaced, never left empty) */
export function clearSecondKey(binds: Binds, action: string): Binds { const next = copyBinds(binds); if (next[action]) next[action] = [(next[action] as string[])[0] as string, '']; return next; }

/** How a gamepad button is named on screen. */
export const PAD_BUTTON_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'BACK', 'START', 'L STICK', 'R STICK', 'D UP', 'D DOWN', 'D LEFT', 'D RIGHT'];
export const padLabel = (b: number): string => (b < 0 ? '-' : PAD_BUTTON_NAMES[b] ?? `BTN ${b}`);
/** Gives `action` the gamepad `button` in slot 0 or 1; a button does one thing, so the action that had it loses it (unless it would be left with none: then nothing changes). Menu buttons (START) cannot be bound. */
export function assignPadButton(pad: PadBinds, action: string, button: number, slot: 0 | 1): { ok: boolean; pad: PadBinds; why?: string; tookFrom: string[] } {
  if (!(action in DEFAULT_BINDS)) return { ok: false, pad, why: 'unknown action', tookFrom: [] };
  if (!Number.isInteger(button) || button < 0 || button === 9) return { ok: false, pad, why: `${padLabel(button)} IS USED BY THE MENUS`, tookFrom: [] };
  const next = copyPad(pad), tookFrom: string[] = [];
  for (const id of Object.keys(next)) {
    if (id === action || !(next[id] as number[]).includes(button)) continue;
    const left = (next[id] as number[]).filter(b => b >= 0 && b !== button);
    if (left.length === 0 && !(id === 'steerLeft' || id === 'steerRight' || id === 'burnout')) return { ok: false, pad, why: `${padLabel(button)} IS THE ONLY BUTTON FOR ${id.toUpperCase()}`, tookFrom: [] };
    next[id] = [left[0] ?? -1, left[1] ?? -1]; tookFrom.push(id);
  }
  const mine = [...(next[action] as number[])]; mine[slot] = button; if (mine[1 - slot] === button) mine[1 - slot] = -1;
  if (mine[0] < 0 && (mine[1] as number) >= 0) { mine[0] = mine[1] as number; mine[1] = -1; }
  next[action] = mine; return { ok: true, pad: next, tookFrom };
}
export const resetControls = (o: Options): Options => ({ ...o, binds: copyBinds(DEFAULT_BINDS), padBinds: copyPad(DEFAULT_PAD_BINDS) });
