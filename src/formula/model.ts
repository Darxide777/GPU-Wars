// The Formula rules for the save, with no screen: the car ready to race (its spec from the benchmark, its tune made safe), the tune and its six slots, and what a finished lap records.
// The same shape as src/drag/model.ts. Every function returns a new save and leaves the one it was given alone. There is no money, shop or points.
import { clearSlot, putSlot, type TuneSlots } from '../tune-slots.ts';
import type { FormulaRunRecord, Save } from '../save.ts';
import { cleanFormulaTune, formulaSpecForBenchmark } from './car.ts';
import type { FormulaSpec, FormulaTimeslip, FormulaTune } from './types.ts';

const HISTORY_MAX = 10;
/** the car (its spec from the benchmark result) and the tune made safe for it: what a lap or the tune screen uses */
export function formulaCar(save: Save): { spec: FormulaSpec; tune: FormulaTune } { return { spec: formulaSpecForBenchmark(save.benchmark), tune: cleanFormulaTune(save.formula.tune) }; }
/** keep a tune (made safe first) */
export const saveFormulaTune = (save: Save, tune: Partial<FormulaTune>): Save => ({ ...save, formula: { ...save.formula, tune: cleanFormulaTune(tune) } });
export const formulaSlots = (save: Save): TuneSlots => save.formula.slots;
export const saveToFormulaSlot = (save: Save, i: number, name: string, tune: Partial<FormulaTune>): Save => ({ ...save, formula: { ...save.formula, slots: putSlot(save.formula.slots, i, name, { ...cleanFormulaTune(tune) }) } });
export const clearFormulaSlot = (save: Save, i: number): Save => ({ ...save, formula: { ...save.formula, slots: clearSlot(save.formula.slots, i) } });
/** loading a slot makes its tune the tune (made safe first); an empty slot changes nothing */
export function loadFormulaSlot(save: Save, i: number): Save { const slot = save.formula.slots[i]; return slot ? saveFormulaTune(save, slot.tune as Partial<FormulaTune>) : save; }

export type FormulaRaceKind = 'test' | 'ranked' | 'solo';
/** a new save with a lap recorded: totals, the bests from a clean lap, and the last ten laps. `records` names the bests broken (a first lap sets the bests without "breaking" one). `won` is: a clean lap faster than the class leader's. */
export function recordFormulaLap(save: Save, o: { kind: FormulaRaceKind; slip: FormulaTimeslip; won: boolean }, now: number): { save: Save; records: string[] } {
  const s = o.slip, clean = s.finished && s.valid, d = { ...save.formula.records, bestSectors: [...save.formula.records.bestSectors] }, records: string[] = [];
  if (o.kind !== 'test') { d.races++; if (o.won && clean) d.wins++; }
  if (s.jumpStart) d.jumpStarts++;
  d.wallHits += s.wallHits;
  if (clean) {
    if (d.bestLap === 0 || s.lapTime < d.bestLap) { if (d.bestLap > 0) records.push('BEST LAP'); d.bestLap = +s.lapTime.toFixed(3); }
    s.sectors.forEach((t, i) => { const old = d.bestSectors[i] ?? 0; if (old === 0 || t < old) { if (old > 0) records.push(`BEST SECTOR ${i + 1}`); d.bestSectors[i] = +t.toFixed(3); } });
    if (s.topSpeed > d.bestTopSpeed) { if (d.bestTopSpeed > 0) records.push('BEST TOP SPEED'); d.bestTopSpeed = +s.topSpeed.toFixed(1); }
    if (s.reaction !== null && s.reaction >= 0 && (d.bestReaction === 0 || s.reaction < d.bestReaction)) { if (d.bestReaction > 0) records.push('BEST REACTION'); d.bestReaction = +s.reaction.toFixed(3); }
  }
  const run: FormulaRunRecord = { against: o.kind === 'test' ? 'TEST RUN' : o.kind === 'solo' ? 'SOLO LAP' : 'CLASS LEADER', lapTime: s.finished ? s.lapTime : 0, reaction: s.reaction ?? 0, topSpeed: s.topSpeed, valid: clean, jumpStart: s.jumpStart, at: now };
  d.history = [...d.history, run].slice(-HISTORY_MAX);
  return { save: { ...save, formula: { ...save.formula, records: d } }, records };
}
