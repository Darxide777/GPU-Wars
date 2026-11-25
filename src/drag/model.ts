// The drag rules for the save, with no screen: the car ready to race, the tune and its slots, and what a finished race records. There is no money, shop or points.
// Every function returns a new save and leaves the one it was given alone.
import { clearSlot, emptySlots, putSlot, type TuneSlots } from '../tune-slots.ts';
import type { Save } from '../save.ts';
import { betterDragGhost, cleanDragGhost } from './physics.ts';
import { specForBenchmark, STOCK_CAR } from './spec-source.ts';
import { cleanTune } from './tune.ts';
import type { DragCarDef, DragGhost, DragRaceKind, DragSpec, Timeslip, Tune } from './types.ts';

const HISTORY_MAX = 10;
/** the car, its spec (from the benchmark result) and the tune made safe for it: what a race or the tune screen uses */
export function readyCar(save: Save, clutchCondition = 1): { car: DragCarDef; spec: DragSpec; tune: Tune } {
  const spec = specForBenchmark(save.benchmark, clutchCondition);
  // (the default tune is built for this engine's revs, so a lower limiter does not start with a shift point above it)
  const car = { ...STOCK_CAR, peakRpm: spec.peakRpm, redline: spec.redline };
  return { car: STOCK_CAR, spec, tune: cleanTune(save.tune, car, spec) };
}
/** keep a tune (made safe for the car first) */
export function saveTune(save: Save, tune: Partial<Tune>): Save { const { car, spec } = readyCar(save); return { ...save, tune: cleanTune(tune, car, spec) }; }
/** TUNE SLOTS: named tunes to switch between (the weather, a mood); loading one makes it the tune, made safe first */
export const tuneSlots = (save: Save): TuneSlots => save.slots ?? emptySlots();
export function saveToSlot(save: Save, i: number, name: string, tune: Partial<Tune>): Save { const { car, spec } = readyCar(save); return { ...save, slots: putSlot(tuneSlots(save), i, name, cleanTune(tune, car, spec) as unknown as Record<string, unknown>) }; }
export const clearSaveSlot = (save: Save, i: number): Save => ({ ...save, slots: clearSlot(tuneSlots(save), i) });
export function loadFromSlot(save: Save, i: number): Save { const s = tuneSlots(save)[i]; return s ? saveTune(save, s.tune as Partial<Tune>) : save; }

/** a new save with a race recorded: totals, the bests from a clean run, your best-pass ghost, and the last ten runs; `records` names the bests broken. */
export function recordRace(save: Save, o: { kind: DragRaceKind; won: boolean; slip: Timeslip; ghost?: DragGhost | null; crashed?: boolean }, now: number): { save: Save; records: string[]; ghost: DragGhost | null; improved: boolean } {
  const s = o.slip, foul = s.foul || !!s.aborted || !!s.crossed, crashed = o.crashed === true || s.crashed === true, won = o.won && !crashed, d = { ...save.records }, records: string[] = [];
  const candidate = o.kind === 'test' ? null : cleanDragGhost(o.ghost), improved = betterDragGhost(save.ghost, candidate);
  let ghost = save.ghost;
  if (improved && candidate) { ghost = candidate; if (save.ghost) records.push('BEST PASS'); }
  if (o.kind !== 'test') { d.races++; if (won) d.wins++; }
  if (foul) d.fouls++; if (crashed) d.crashes++;
  if (!foul && !crashed && s.quarter !== undefined) {
    const better = (k: 'bestEt' | 'best60', v: number | undefined, label: string): void => { if (v === undefined) return; if (d[k] === 0 || v < d[k]) { if (d[k] > 0) records.push(label); d[k] = +v.toFixed(3); } };
    better('bestEt', s.quarter, 'BEST ET'); better('best60', s.ft60, 'BEST 60 FT');
    if (s.trap !== undefined && s.trap > d.bestTrap) { if (d.bestTrap > 0) records.push('BEST TRAP SPEED'); d.bestTrap = +s.trap.toFixed(1); }
    if (s.reaction !== null && s.reaction >= 0 && (d.bestReaction === 0 || s.reaction < d.bestReaction)) { if (d.bestReaction > 0) records.push('BEST REACTION'); d.bestReaction = +s.reaction.toFixed(3); }
  }
  const against = o.kind === 'test' ? 'TEST RUN' : o.kind === 'solo' ? 'SOLO' : 'BEST PASS';
  d.history = [...d.history, { against, won, foul, crossed: !!s.crossed, crashed, reaction: s.reaction ?? 0, et: s.quarter ?? 0, trap: s.trap ?? 0, at: now }].slice(-HISTORY_MAX);
  return { save: { ...save, records: d, ghost }, records, ghost, improved };
}
