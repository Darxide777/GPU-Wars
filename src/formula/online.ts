// Formula's side of the leaderboard: the class leader's ghost for the lap, and sending a clean ranked lap. It talks to the shared client (src/leaderboard/client.ts: `leader(..., { mode: 'formula' })`, `submit(FormulaScorePayload)`),
// so nothing in src/leaderboard/ changes. Drag's `createLeaderboardUi` (src/leaderboard/ui.ts) stays Drag's.
// TODO(leaderboard owner): when src/leaderboard/ui.ts and payload.ts grow documented formula support (a formula leader, a formula payload builder, keeping an unsent formula lap in `profile.pending`), replace this file with calls to them.
// Until then a lap that could not be sent (offline) is NOT kept for later, and the optional ghost is not sent.
import type { BenchmarkResult } from '../save.ts';
import { DEFAULT_CLASS, DEFAULT_TRACK, classLabel, isClassId, type Category, type ClassId } from '../classes.ts';
import type { FormulaLeaderRecord, FormulaScorePayload, LeaderboardClient } from '../leaderboard/client.ts';
import { ghostFromLeader } from './ghost.ts';
import { trackById } from './tracks.ts';
import type { FormulaGhost, FormulaTimeslip, FormulaTune } from './types.ts';

const KMH_PER_MPH = 1.609344, MPH_PER_KMH = 0.621371, round = (v: number, digits: number): number => Math.round(v * 10 ** digits) / 10 ** digits;
/** the formula tune as plain numbers with short names (the gearbox is 1 for auto, 0 for manual) */
export function flattenFormulaTune(tune: FormulaTune): Record<string, number> {
  return { gearing: tune.gearing, downforce: tune.downforce, steering: tune.steering, pressure: tune.pressure, nitro: tune.nitro, shiftLight: tune.shiftLight, gearboxAuto: tune.gearbox === 'auto' ? 1 : 0 };
}
/** why a lap cannot be sent (a line for the screen), or null when it is a clean ranked lap with a benchmark behind it */
export function whyFormulaNotRanked(benchmark: BenchmarkResult | null, slip: FormulaTimeslip): string | null {
  if (!benchmark || !isClassId(benchmark.class)) return 'RUN THE BENCHMARK TO GET A CLASS AND RANK';
  if (slip.jumpStart) return 'A JUMP START IS NOT RANKED';
  if (!slip.finished || !slip.valid) return 'THE LAP DID NOT FINISH';
  return null;
}
/** the sector times the server wants: the elapsed time at the end of sector 1, sector 2 and the lap. The track has more gates than that, so sector 1 ends a third of the way along the gates and sector 2 two thirds (the last split is the finish). */
export function threeSectorSplits(slip: FormulaTimeslip): { sector1: number; sector2: number; lap: number } {
  const n = slip.splits.length, at = (share: number): number => slip.splits[Math.max(0, Math.min(n - 1, Math.round(n * share) - 1))] as number;
  return { sector1: round(at(1 / 3), 3), sector2: round(at(2 / 3), 3), lap: round(slip.lapTime, 3) };
}
/** the payload for a clean ranked lap, or null when it cannot be ranked */
export function buildFormulaPayload(o: { playerName: string; category: Category; benchmark: BenchmarkResult | null; slip: FormulaTimeslip; tune: FormulaTune; track?: string }): FormulaScorePayload | null {
  if (whyFormulaNotRanked(o.benchmark, o.slip)) return null;
  const b = o.benchmark as BenchmarkResult, splits = threeSectorSplits(o.slip);
  if (!(splits.sector1 > 0 && splits.sector1 < splits.sector2 && splits.sector2 < splits.lap)) return null;
  return {
    mode: 'formula', track: o.track ?? DEFAULT_TRACK.formula, playerName: o.playerName, class: b.class as ClassId, category: o.category,
    benchmarkScore: Math.max(0, Math.min(1e7, round(b.score, 2))), benchmarkVersion: String(b.benchmarkVersion).replace(/[^\w.\-]/g, '').slice(0, 24) || '0', gpuId: b.gpuId.slice(0, 120) || 'unknown',
    splits, topSpeed: round(o.slip.topSpeed * MPH_PER_KMH, 1), seed: 0, tune: flattenFormulaTune(o.tune),
  };
}
/** the ghost of a leader's record: made up from their lap time and top speed (the server's compact ghost is not used yet: its [seconds, metres] pairs have no lane) */
export function ghostForLeader(rec: FormulaLeaderRecord): FormulaGhost | null {
  return ghostFromLeader(trackById(rec.track), { name: rec.name, lapTime: rec.timeS, topSpeed: rec.topSpeed > 0 ? rec.topSpeed * KMH_PER_MPH : undefined });
}

export interface FormulaOnlineOptions { client: LeaderboardClient; benchmark: () => BenchmarkResult | null; playerName: () => string; category: () => Category; onChange: () => void }
export function createFormulaOnline(o: FormulaOnlineOptions) {
  let leader: FormulaLeaderRecord | null = null, leaderKey = '', note = '', askedKey = '', status = '', ghostKey = '', ghostCache: FormulaGhost | null = null;
  const playerClass = (): ClassId => { const b = o.benchmark(); return b && isClassId(b.class) ? b.class : DEFAULT_CLASS; };
  const keyNow = (): string => `${playerClass()}|${o.category()}`;
  const api = {
    playerClass, className: (): string => classLabel(playerClass()),
    /** the leader of your class and category, or null (offline, or nobody has a lap yet: Formula has no bundled time) */
    leader: (): FormulaLeaderRecord | null => (leaderKey === keyNow() ? leader : null), note: (): string => (leaderKey === keyNow() ? note : ''),
    /** the ghost you race (cached: the same record gives the very same ghost) */
    ghost(): FormulaGhost | null {
      const rec = api.leader(), key = rec ? JSON.stringify([rec.class, rec.category, rec.name, rec.timeS, rec.topSpeed]) : '';
      if (key !== ghostKey) { ghostKey = key; ghostCache = rec ? ghostForLeader(rec) : null; }
      return ghostCache;
    },
    /** ask the server once per class and category (until forced) */
    async refreshLeader(force = false): Promise<void> {
      const key = keyNow(); if (!force && askedKey === key) return; askedKey = key;
      const r = await o.client.leader(playerClass(), o.category(), { mode: 'formula', track: DEFAULT_TRACK.formula });
      leader = r.record; leaderKey = key; note = r.note; o.onChange();
    },
    /** send a clean ranked lap; returns the line to show on the timeslip */
    async submitLap(slip: FormulaTimeslip, tune: FormulaTune): Promise<string> {
      const benchmark = o.benchmark(), why = whyFormulaNotRanked(benchmark, slip);
      if (why) { status = why; o.onChange(); return status; }
      const payload = buildFormulaPayload({ playerName: o.playerName(), category: o.category(), benchmark, slip, tune });
      if (!payload) { status = 'THIS LAP COULD NOT BE RANKED'; o.onChange(); return status; }
      status = 'SENDING TO THE LEADERBOARD...'; o.onChange();
      const r = await o.client.submit(payload);
      status = r.ok ? `SENT: RANK ${r.classRank} IN ${classLabel(payload.class)}${r.verified ? ' (VERIFIED)' : ''}` : r.kind === 'rejected' ? r.message : `${r.message} (THIS LAP WAS NOT KEPT FOR LATER)`;
      askedKey = ''; o.onChange(); return status;
    },
    get status(): string { return status; }, clearStatus(): void { status = ''; },
  };
  return api;
}
export type FormulaOnline = ReturnType<typeof createFormulaOnline>;
