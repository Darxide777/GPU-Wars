// The one save for GPU Wars: the benchmark result, the tune, the tune slots and the records. Small, versioned and repaired on load, so a damaged or old save can never stop the game.
// No profile, points, shop or other game's section lives here. Settings (volume, key binds) are kept separately by src/options/model.ts.
import type { Store } from './browser-store.ts';
import { cleanSlots, emptySlots, type TuneSlots } from './tune-slots.ts';
import { cleanDragGhost } from './drag/physics.ts';
import type { DragGhost, Tune } from './drag/types.ts';
import { isClassId } from './classes.ts';
import { BENCHMARK } from './benchmark/constants.ts';

export const SAVE_KEY = 'gpuwars.save';
export const SAVE_VERSION = 1;
const HISTORY_MAX = 10;

/** what the benchmark leaves behind. It is re-run only when `gpuId` or `benchmarkVersion` changes (src/benchmark/rules.ts). `class` is a class id (src/classes.ts); `sustain` (0 to 1, optional) is how steady the card was across the passes: it shapes the torque curve. */
export interface BenchmarkResult { score: number; class: string; benchmarkVersion: number; gpuId: string; date: number; sustain?: number }
/** a class the player picked by hand because the browser did not name the card: locked to that card's `gpuId` */
export interface ClassLock { class: string; gpuId: string; date: number }
/** one race, as kept in the history: what it was against, how it went and the timeslip's main numbers */
export interface RunRecord { against: string; won: boolean; foul: boolean; crossed: boolean; crashed: boolean; reaction: number; et: number; trap: number; at: number }
export interface Records { races: number; wins: number; fouls: number; crashes: number; bestEt: number; best60: number; bestTrap: number; bestReaction: number; history: RunRecord[] }
export interface Save {
  version: number;
  /** null until the benchmark has been run */ benchmark: BenchmarkResult | null;
  /** the hand-picked class, locked to one graphics card (null: none picked) */ classLock: ClassLock | null;
  /** the tune, as typed (made safe for the car when it is used) */ tune: Partial<Tune> | null;
  /** the six named tune slots */ slots: TuneSlots;
  records: Records;
  /** your best clean pass: the stand-in for the class leader's ghost until the leaderboard exists */ ghost: DragGhost | null;
}

export const emptyRecords = (): Records => ({ races: 0, wins: 0, fouls: 0, crashes: 0, bestEt: 0, best60: 0, bestTrap: 0, bestReaction: 0, history: [] });
export const emptySave = (): Save => ({ version: SAVE_VERSION, benchmark: null, classLock: null, tune: null, slots: emptySlots(), records: emptyRecords(), ghost: null });

const num = (v: unknown, d = 0, lo = 0, hi = 1e9): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const count = (v: unknown): number => Math.floor(num(v, 0, 0, 1e15));      // (large enough for a date in milliseconds)
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[^\x20-\x7e]/g, '').slice(0, max) : '');
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** a benchmark result from a save, or null when it is missing or not believable */
export function cleanBenchmark(raw: unknown): BenchmarkResult | null {
  if (!isObject(raw)) return null;
  const score = typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : -1, gpuId = text(raw.gpuId, 200), cls = text(raw.class, 60);
  if (score < 0 || !gpuId || !isClassId(cls)) return null;
  const out: BenchmarkResult = { score: Math.round(Math.min(BENCHMARK.maxScore, score)), class: cls, benchmarkVersion: count(raw.benchmarkVersion), gpuId, date: count(raw.date) };
  if (typeof raw.sustain === 'number' && Number.isFinite(raw.sustain)) out.sustain = Math.max(0, Math.min(1, raw.sustain));
  return out;
}
/** a class lock from a save, or null when it is missing or not a real class */
export function cleanClassLock(raw: unknown): ClassLock | null {
  if (!isObject(raw)) return null;
  const gpuId = text(raw.gpuId, 200), cls = text(raw.class, 60);
  return gpuId && isClassId(cls) ? { class: cls, gpuId, date: count(raw.date) } : null;
}
function cleanRecords(raw: unknown): Records {
  const r = isObject(raw) ? raw : {}, out = emptyRecords();
  out.races = count(r.races); out.wins = count(r.wins); out.fouls = count(r.fouls); out.crashes = count(r.crashes);
  out.bestEt = num(r.bestEt); out.best60 = num(r.best60); out.bestTrap = num(r.bestTrap); out.bestReaction = num(r.bestReaction);
  if (Array.isArray(r.history)) out.history = r.history.filter(isObject).slice(-HISTORY_MAX).map(h => ({ against: text(h.against, 20) || 'SOLO', won: h.won === true, foul: h.foul === true, crossed: h.crossed === true, crashed: h.crashed === true, reaction: num(h.reaction, 0, -10, 10), et: num(h.et), trap: num(h.trap), at: count(h.at) }));
  return out;
}
/** whatever was stored (maybe old, partial or damaged) made into a valid save; tunes are checked again against the car when they are used */
export function sanitizeSave(raw: unknown): Save {
  const r = isObject(raw) ? raw : {};
  return {
    version: SAVE_VERSION, benchmark: cleanBenchmark(r.benchmark), classLock: cleanClassLock(r.classLock), tune: isObject(r.tune) ? (JSON.parse(JSON.stringify(r.tune)) as Partial<Tune>) : null,
    slots: cleanSlots(r.slots, t => t), records: cleanRecords(r.records), ghost: cleanDragGhost(r.ghost as DragGhost | null | undefined),
  };
}
export function loadSave(store: Store): Save { let raw: unknown = null; try { raw = JSON.parse(store.get(SAVE_KEY) || 'null'); } catch (e) { /* damaged: start fresh */ } return sanitizeSave(raw); }
export function writeSave(store: Required<Store>, save: Save): void { try { store.set(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* cannot be kept: the game goes on */ } }
export function eraseSave(store: Required<Store>): void { store.remove(SAVE_KEY); }
