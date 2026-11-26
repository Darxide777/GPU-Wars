// The RACING LINE: the optional driving line Formula shows to manual drivers. The autopilot drives two laps of the track alone in a car with the player's numbers, and its second lap (a flying lap) is kept as the line to follow,
// with what it did along it: ACCELERATE (green), start SLOWING (yellow: it has come off the throttle, or a braking zone is coming up) or BRAKE (red). No drawing in here (topdown.ts draws it). The same run also gives the timeslip
// of the first (standing start) lap, which is what `predictFormula` returns. Ported from Chromium Halo: Neon's src/arena/racingLine.ts.
import { createFormulaAutopilot } from './autopilot.ts';
import { FORMULA_DT, LAP, LIGHTS } from './constants.ts';
import { cleanFormulaTune, STOCK_SPEC } from './car.ts';
import { createFormulaRace } from './race.ts';
import { roadSurface } from './road.ts';
import { FORMULA_TRACKS } from './tracks.ts';
import type { FormulaSpec, FormulaTimeslip, FormulaTrack, FormulaTune } from './types.ts';

export const LINE = { green: 0, yellow: 1, red: 2 } as const;
export const LINE_COLOURS = ['#34ff7a', '#ffe14d', '#ff3355'] as const;
/** points of the line, about `LINE_SETTINGS.step` metres apart: where it is, how high the road is there, what the driver did, and how fast it went (m/s) */
export interface RacingLine { x: number[]; y: number[]; h: number[]; kind: number[]; speed: number[]; /** how far above the road the line floats (m): more on banked turns, where the road slopes across it */ lift: number }
/** the line's numbers: the spacing (m); the deceleration (m/s2) that counts as braking, and as coming off the throttle; how far before a braking zone the yellow starts (m); and how much the colours are smoothed (passes, window) */
export const LINE_SETTINGS = { step: 3, brake: -5, lift: -0.7, warn: 55, smoothPasses: 3, smoothWindow: 9 } as const;

/** the result of the two-lap run: the line (null when the lap could not be driven) and the timeslip of the standing-start lap */
export interface LapSolution { line: RacingLine | null; slip: FormulaTimeslip }
const cache = new Map<string, LapSolution>();
/** the autopilot's two laps for a car and tune on a track (kept: the same car on the same track is only worked out once, a few tens of milliseconds) */
export function solveLap(spec: FormulaSpec = STOCK_SPEC, tune: Partial<FormulaTune> | null = null, track: FormulaTrack = FORMULA_TRACKS[0] as FormulaTrack): LapSolution {
  const clean = cleanFormulaTune(tune), key = JSON.stringify([track.id, spec, clean]), hit = cache.get(key); if (hit) return hit;
  const race = createFormulaRace({ track, spec, tune: clean, laps: 2 }), driver = createFormulaAutopilot(track, race.state.car.stats);
  const rec: { x: number; y: number; v: number; at: number }[] = []; let lastX = 0, lastY = 0;
  for (let i = 0; i < Math.ceil((LIGHTS.go + LAP.maxSeconds) / FORMULA_DT) && !race.over; i++) {
    race.step(driver.decide(race.view()));
    const s = race.state;
    // the second lap only: a standing start is not the line
    if (s.lap.lap >= 1 && s.lap.phase === 'racing' && (rec.length === 0 || Math.hypot(s.car.x - lastX, s.car.y - lastY) >= LINE_SETTINGS.step)) { lastX = s.car.x; lastY = s.car.y; rec.push({ x: s.car.x, y: s.car.y, v: Math.hypot(s.car.vx, s.car.vy), at: s.lap.clock }); }
  }
  const out: LapSolution = { line: lineFrom(track, rec), slip: race.timeslip(0) };
  if (cache.size > 12) cache.clear(); cache.set(key, out); return out;
}
/** the line from the points of a flying lap: the speed trend over a few points says whether the driver was accelerating, lifting or braking */
function lineFrom(track: FormulaTrack, rec: { x: number; y: number; v: number; at: number }[]): RacingLine | null {
  if (rec.length < 20) return null;
  const n = rec.length, S = LINE_SETTINGS;
  const trend = rec.map((_, j) => { const q = rec[(j + 2) % n] as typeof rec[number], p = rec[(j + n - 2) % n] as typeof rec[number], dt = q.at - p.at; return dt > 0 ? (q.v - p.v) / dt : 0; });
  const kind = trend.map(d => (d <= S.brake ? LINE.red : d <= S.lift ? LINE.yellow : LINE.green) as number);
  // a warning before each braking zone
  for (let j = 0; j < n; j++) if (kind[j] === LINE.red) for (let k = 1; k * S.step <= S.warn; k++) { const b = (j - k + n * 4) % n; if (kind[b] === LINE.green) kind[b] = LINE.yellow; }
  // flicker is smoothed over: a colour holds for a few points at least
  let clean = kind;
  for (let pass = 0; pass < S.smoothPasses; pass++) clean = clean.map((k, j) => { const w = Array.from({ length: S.smoothWindow }, (_, d) => clean[(j + d - (S.smoothWindow >> 1) + n * 4) % n] as number); return [0, 1, 2].reduce((b, c) => (w.filter(x => x === c).length > w.filter(x => x === b).length ? c : b), k); });
  return { x: rec.map(r => +r.x.toFixed(2)), y: rec.map(r => +r.y.toFixed(2)), h: rec.map(r => +(roadSurface(track.road, r.x, r.y)?.height ?? 0).toFixed(2)), kind: clean, speed: rec.map(r => +r.v.toFixed(1)), lift: track.road.bank ? 0.6 : 0.14 };
}
/** the racing line of a track for a car with these numbers (null when none could be worked out) */
export const racingLineFor = (spec: FormulaSpec = STOCK_SPEC, tune: Partial<FormulaTune> | null = null, track: FormulaTrack = FORMULA_TRACKS[0] as FormulaTrack): RacingLine | null => solveLap(spec, tune, track).line;
