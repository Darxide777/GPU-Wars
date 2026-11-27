// The FORMULA class leader as the game uses it: the server's record (GET /leader?mode=formula&track=beach) or, when there is no server or no leader yet, a bundled placeholder lap per class,
// so the ghost works from the first lap (like src/leaderboard/leader.ts for Drag). The ghost is built from the lap time and splits (or the server's ghost pairs) by formula-ghost.ts.
import { CLASS_IDS, DEFAULT_TRACK, type Category, type ClassId } from '../classes.ts';
import { trackById, type FormulaGhost, type FormulaTrack } from '../formula/index.ts';
import type { FormulaLeaderRecord, LeaderboardClient } from './client.ts';
import { ghostFromRecord } from './formula-ghost.ts';
import { textSeed } from './leader.ts';

/** THE BUNDLED STAND-IN LEADERS (not real players; `placeholder` stays true because a real record replaces them), CALIBRATED in phase 3 to the simulation (docs/CALIBRATION.md, "Formula lap times"). Turn `classLapTime` first.
 *  Each leader sits just UNDER the lap of the BEST card of its class (integrated cap 8000: 44.50 s, discrete cap 10000: 38.00 s, default tune, the autopilot's lap), the way Drag's leader is set from its class's strong cards:
 *  - a DEFAULT tune on the best card only just fails to beat the leader (by 0.10 s integrated, 0.08 s discrete);
 *  - a GOOD tune on the best card beats it (about 1.3 s integrated, 1.1 s discrete), so does a good tune on a strong card;
 *  - a typical or weak card cannot beat it, which is right for a class leader.
 *  The autopilot category's leader is the same car driven by the autopilot, so it is only `autopilotExtraLap` slower: a default-tune autopilot on the best card still just fails (by 0.05 s), a tuned one wins.
 *  tests/formula-calibration.test.mjs asserts all of this. */
export const FORMULA_FALLBACK_LEADERS = {
  placeholder: true,
  classLapTime: { integrated: 44.4, discrete: 37.92 } as Record<string, number>,
  /** the autopilot lap of the same car is this much slower than the manual leader (the autopilot IS the calibration's perfect driver, so the gap is small) */ autopilotExtraLap: 0.05,
  /** the stand-in top speed, mph, per class (a little over each leader lap's average speed, which the server checks; the best card's default-tune top speed is 246 and 288 mph) */ topSpeedMph: { integrated: 247, discrete: 289 } as Record<string, number>,
  /** the stand-in sector 1 and sector 2 as shares of the lap (the sim's own: 0.29 and 0.72) */ sectorShare: [0.29, 0.72] as [number, number],
} as const;

/** the fallback leader record of a class and category: only the lap time is a real number, the sectors, top speed and seed are derived from it */
export function fallbackFormulaLeader(cls: ClassId, category: Category = 'manual', track: string = DEFAULT_TRACK.formula): FormulaLeaderRecord {
  const f = FORMULA_FALLBACK_LEADERS, lap = Math.round(((f.classLapTime[cls] ?? 45) + (category === 'autopilot' ? f.autopilotExtraLap : 0)) * 1000) / 1000;
  return {
    name: category === 'autopilot' ? 'AUTO LEADER' : 'CLASS LEADER', class: cls, category, track, timeS: lap, topSpeed: f.topSpeedMph[cls] ?? 250,
    sectors: { sector1: Math.round(lap * f.sectorShare[0] * 1000) / 1000, sector2: Math.round(lap * f.sectorShare[1] * 1000) / 1000, lap }, seed: textSeed(`formula|${track}|${cls}|${category}`), tune: {}, ghost: null,
  };
}
/** every fallback leader as a list (for tests and an offline records screen) */
export const allFallbackFormulaLeaders = (): FormulaLeaderRecord[] => CLASS_IDS.flatMap(c => (['manual', 'autopilot'] as const).map(cat => fallbackFormulaLeader(c, cat)));

/** the ghost of a leader record: from its ghost pairs when it has good ones, otherwise made up from the lap time (the three sector times do not fit the track's gates, so the ghost makes its own splits) */
export function ghostOfFormulaLeader(track: FormulaTrack, record: FormulaLeaderRecord): FormulaGhost | null {
  return ghostFromRecord(track, { name: record.name, lapTime: record.timeS, topSpeed: record.topSpeed / 0.621371, pairs: record.ghost ?? undefined });
}

export interface FormulaLeaderGhost {
  record: FormulaLeaderRecord; ghost: FormulaGhost | null;
  /** where it came from: the server's board or the bundled placeholder list */ source: 'server' | 'fallback';
  /** the server answered (false: offline or no leader, the bundled lap is used) */ online: boolean; note: string;
}

/** The class leader and its ghost for a Formula race. Always gives a record to race: the server's when there is one, the bundled placeholder lap when offline, empty or broken. Never throws.
 *  A server record whose ghost cannot be played (a lap time the sim refuses) falls back to the bundled leader too. */
export async function loadFormulaLeader(client: Pick<LeaderboardClient, 'leader'>, cls: ClassId, category: Category, trackId: string = DEFAULT_TRACK.formula): Promise<FormulaLeaderGhost> {
  const track = trackById(trackId);
  const fallback = (note: string): FormulaLeaderGhost => { const record = fallbackFormulaLeader(cls, category, trackId); return { record, ghost: ghostOfFormulaLeader(track, record), source: 'fallback', online: false, note }; };
  const answer = await client.leader(cls, category, { mode: 'formula', track: trackId });
  if (!answer.record) return fallback(answer.note ? `${answer.note}: RACING THE BUNDLED TIME` : 'RACING THE BUNDLED TIME');
  const ghost = ghostOfFormulaLeader(track, answer.record);
  return ghost ? { record: answer.record, ghost, source: 'server', online: true, note: '' } : fallback('LEADER LAP NOT PLAYABLE: RACING THE BUNDLED TIME');
}
