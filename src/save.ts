// The one save for GPU Wars: the benchmark result, the tune, the tune slots and the records. Small, versioned and repaired on load, so a damaged or old save can never stop the game.
// No profile, points, shop or other game's section lives here. Settings (volume, key binds) are kept separately by src/options/model.ts.
import type { Store } from './browser-store.ts';
import { cleanSlots, emptySlots, type TuneSlots } from './tune-slots.ts';
import type { Tune } from './drag/types.ts';
import { BENCHMARK } from './benchmark/constants.ts';
import { cleanFormulaSlots, cleanFormulaTune } from './formula/car.ts';
import type { FormulaTune } from './formula/types.ts';
import { MODE_IDS, DEFAULT_MODE, type ModeId } from './classes.ts';

export const SAVE_KEY = 'gpuwars.save';
/** 2: the class is detected, never picked: `classLock` is gone (an older save's lock is dropped on load, see repairBenchmark in src/benchmark/rules.ts).
 *  3: Formula mode: `mode` (the game mode last picked) and `formula` (its tune, slots and records). A version 1 or 2 save loads unchanged: every Drag field is kept as it was and the new ones start empty. */
export const SAVE_VERSION = 3;
const HISTORY_MAX = 10;

/** what the benchmark leaves behind. It is re-run only when `gpuId` or `benchmarkVersion` changes (src/benchmark/rules.ts). `class` is a class id (src/classes.ts); `sustain` (0 to 1, optional) is how steady the card was across the passes: it shapes the torque curve. */
export interface BenchmarkResult { score: number; class: string; benchmarkVersion: number; gpuId: string; date: number; sustain?: number; /** true when the class was decided from the measured speed (the browser hid the card's name) */ classFromSpeed?: boolean }
/** one race, as kept in the history: what it was against, how it went and the timeslip's main numbers */
export interface RunRecord { against: string; won: boolean; foul: boolean; crossed: boolean; crashed: boolean; reaction: number; et: number; trap: number; at: number }
export interface Records { races: number; wins: number; fouls: number; crashes: number; bestEt: number; best60: number; bestTrap: number; bestReaction: number; history: RunRecord[] }
/** one Formula lap, as kept in the history: the lap time (0 for a lap that did not count), the reaction, the top speed (km/h) and whether it was a clean lap (no jump start, finished) */
export interface FormulaRunRecord { against: string; lapTime: number; reaction: number; topSpeed: number; valid: boolean; jumpStart: boolean; at: number }
/** Formula's personal bests: shared nowhere with Drag's records (a lap time is not a quarter-mile ET). Autopilot laps never touch them. */
export interface FormulaRecords { races: number; wins: number; jumpStarts: number; wallHits: number; bestLap: number; bestSectors: number[]; bestTopSpeed: number; bestReaction: number; history: FormulaRunRecord[] }
/** everything Formula keeps: its own tune and six tune slots (the benchmark, class, options and name are shared with Drag) and its records */
export interface FormulaSave { tune: Partial<FormulaTune> | null; slots: TuneSlots; records: FormulaRecords }
export interface Save {
  version: number;
  /** the game mode picked on the title screen (remembered) */ mode: ModeId;
  /** Formula's tune, slots and records */ formula: FormulaSave;
  /** null until the benchmark has been run */ benchmark: BenchmarkResult | null;
  /** the tune, as typed (made safe for the car when it is used) */ tune: Partial<Tune> | null;
  /** the six named tune slots */ slots: TuneSlots;
  records: Records;
}

export const emptyRecords = (): Records => ({ races: 0, wins: 0, fouls: 0, crashes: 0, bestEt: 0, best60: 0, bestTrap: 0, bestReaction: 0, history: [] });
export const emptyFormulaRecords = (): FormulaRecords => ({ races: 0, wins: 0, jumpStarts: 0, wallHits: 0, bestLap: 0, bestSectors: [], bestTopSpeed: 0, bestReaction: 0, history: [] });
export const emptyFormulaSave = (): FormulaSave => ({ tune: null, slots: emptySlots(), records: emptyFormulaRecords() });
export const emptySave = (): Save => ({ version: SAVE_VERSION, mode: DEFAULT_MODE, formula: emptyFormulaSave(), benchmark: null, tune: null, slots: emptySlots(), records: emptyRecords() });

const num = (v: unknown, d = 0, lo = 0, hi = 1e9): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const count = (v: unknown): number => Math.floor(num(v, 0, 0, 1e15));      // (large enough for a date in milliseconds)
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[^\x20-\x7e]/g, '').slice(0, max) : '');
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** a benchmark result from a save, or null when it is missing or not believable */
export function cleanBenchmark(raw: unknown): BenchmarkResult | null {
  if (!isObject(raw)) return null;
  const score = typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : -1, gpuId = text(raw.gpuId, 200), cls = text(raw.class, 60);
  // an old save can hold a class id that no longer exists (the 17-class build): it is KEPT, so the page sees 'class changed' and asks for a new run (src/benchmark/rules.ts)
  if (score < 0 || !gpuId || !/^[a-z0-9-]{1,40}$/.test(cls)) return null;
  const out: BenchmarkResult = { score: Math.round(Math.min(BENCHMARK.maxScore, score)), class: cls, benchmarkVersion: count(raw.benchmarkVersion), gpuId, date: count(raw.date) };
  if (typeof raw.sustain === 'number' && Number.isFinite(raw.sustain)) out.sustain = Math.max(0, Math.min(1, raw.sustain));
  if (raw.classFromSpeed === true) out.classFromSpeed = true;
  return out;
}
function cleanRecords(raw: unknown): Records {
  const r = isObject(raw) ? raw : {}, out = emptyRecords();
  out.races = count(r.races); out.wins = count(r.wins); out.fouls = count(r.fouls); out.crashes = count(r.crashes);
  out.bestEt = num(r.bestEt); out.best60 = num(r.best60); out.bestTrap = num(r.bestTrap); out.bestReaction = num(r.bestReaction);
  if (Array.isArray(r.history)) out.history = r.history.filter(isObject).slice(-HISTORY_MAX).map(h => ({ against: text(h.against, 20) || 'SOLO', won: h.won === true, foul: h.foul === true, crossed: h.crossed === true, crashed: h.crashed === true, reaction: num(h.reaction, 0, -10, 10), et: num(h.et), trap: num(h.trap), at: count(h.at) }));
  return out;
}
function cleanFormulaRecords(raw: unknown): FormulaRecords {
  const r = isObject(raw) ? raw : {}, out = emptyFormulaRecords();
  out.races = count(r.races); out.wins = count(r.wins); out.jumpStarts = count(r.jumpStarts); out.wallHits = count(r.wallHits);
  out.bestLap = num(r.bestLap, 0, 0, 3600); out.bestTopSpeed = num(r.bestTopSpeed, 0, 0, 2000); out.bestReaction = num(r.bestReaction, 0, 0, 10);
  if (Array.isArray(r.bestSectors)) out.bestSectors = r.bestSectors.slice(0, 12).map(v => num(v, 0, 0, 3600));
  if (Array.isArray(r.history)) out.history = r.history.filter(isObject).slice(-HISTORY_MAX).map(h => ({ against: text(h.against, 20) || 'TEST RUN', lapTime: num(h.lapTime, 0, 0, 3600), reaction: num(h.reaction, 0, -10, 10), topSpeed: num(h.topSpeed, 0, 0, 2000), valid: h.valid === true, jumpStart: h.jumpStart === true, at: count(h.at) }));
  return out;
}
function cleanFormulaSave(raw: unknown): FormulaSave {
  const r = isObject(raw) ? raw : {};
  return { tune: isObject(r.tune) ? { ...cleanFormulaTune(r.tune) } : null, slots: cleanFormulaSlots(r.slots), records: cleanFormulaRecords(r.records) };
}
/** whatever was stored (maybe old, partial or damaged) made into a valid save; tunes are checked again against the car when they are used */
export function sanitizeSave(raw: unknown): Save {
  const r = isObject(raw) ? raw : {};
  return {
    version: SAVE_VERSION, mode: (MODE_IDS as readonly string[]).includes(r.mode as string) ? (r.mode as ModeId) : DEFAULT_MODE, formula: cleanFormulaSave(r.formula), benchmark: cleanBenchmark(r.benchmark), tune: isObject(r.tune) ? (JSON.parse(JSON.stringify(r.tune)) as Partial<Tune>) : null,
    slots: cleanSlots(r.slots, t => t), records: cleanRecords(r.records),
  };
}
export function loadSave(store: Store): Save { let raw: unknown = null; try { raw = JSON.parse(store.get(SAVE_KEY) || 'null'); } catch (e) { /* damaged: start fresh */ } return sanitizeSave(raw); }
export function writeSave(store: Required<Store>, save: Save): void { try { store.set(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* cannot be kept: the game goes on */ } }
export function eraseSave(store: Required<Store>): void { store.remove(SAVE_KEY); }
