// The FORMULA class leader as the game uses it: the server's record (GET /leader?mode=formula&track=beach) or, when there is no server or no leader yet, a bundled placeholder lap per class,
// so the ghost works from the first lap (like src/leaderboard/leader.ts for Drag). The ghost is built from the lap time and splits (or the server's ghost pairs) by formula-ghost.ts.
import { CLASS_IDS, DEFAULT_TRACK, type Category, type ClassId } from '../classes.ts';
import { trackById, type FormulaGhost, type FormulaTrack } from '../formula/index.ts';
import type { FormulaLeaderRecord, LeaderboardClient } from './client.ts';
import { ghostFromRecord } from './formula-ghost.ts';
import { textSeed } from './leader.ts';

/** CALIBRATION TODO (phase 3): THESE LAP TIMES ARE PLACEHOLDERS, not real players. Turn `classLapTime` first once real laps exist.
 *  They come from the src/formula simulation on BEACH with the DEFAULT tune and the autopilot's lap (docs/ARCHITECTURE.md: best discrete about 38.1 s, best integrated 45.5 s, slowest of all 51.5 s):
 *  a made-up leader is a card at 70% of its class's top score (integrated 5600: 47.1 s, discrete 7000: 39.8 s with a default tune) and drives ONE SECOND better than that default lap (a modest tune gain).
 *  So a default tune of a typical card does not beat the leader, a good tune does (a good tune gains about 3 to 4 s), and a top-score card with a default tune beats it only a little (integrated 45.5 s, discrete 38.1 s). */
export const FORMULA_FALLBACK_LEADERS = {
  placeholder: true,
  classLapTime: { integrated: 46.1, discrete: 38.8 } as Record<string, number>,
  /** the autopilot lap is the default-tune lap, a little slower than a hand-tuned leader */ autopilotExtraLap: 0.6,
  /** the made-up top speed, mph, per class (a little over each leader lap's average speed, which the server checks) */ topSpeedMph: { integrated: 244, discrete: 290 } as Record<string, number>,
  /** the made-up sector 1 and sector 2 as shares of the lap (the sim's own: about 0.29 and 0.71) */ sectorShare: [0.29, 0.71] as [number, number],
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
