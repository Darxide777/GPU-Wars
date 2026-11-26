// Formula's side of the leaderboard as the page uses it: the class leader's ghost (the server's, or the bundled placeholder lap when offline or empty) and sending a clean ranked lap.
// The rules live in src/leaderboard/: `loadFormulaLeader` (formula-leader.ts) finds the leader and builds the ghost, `buildFormulaPayload` and `whyFormulaNotRanked` (formula-payload.ts) make and check
// the payload (with the compact ghost from the real lap trace). This file only keeps the state the page needs and the line shown on the timeslip.
import type { BenchmarkResult } from '../save.ts';
import { DEFAULT_CLASS, DEFAULT_TRACK, classLabel, isClassId, type Category, type ClassId } from '../classes.ts';
import type { FormulaScorePayload, LeaderboardClient, Failure, SubmitOk } from '../leaderboard/client.ts';
import { fallbackFormulaLeader, ghostOfFormulaLeader, loadFormulaLeader, type FormulaLeaderGhost } from '../leaderboard/formula-leader.ts';
import { buildFormulaPayload, whyFormulaNotRanked } from '../leaderboard/formula-payload.ts';
import { trackById } from './tracks.ts';
import type { FormulaGhost, FormulaTimeslip, FormulaTune, LapTrace } from './types.ts';

export interface FormulaOnlineOptions {
  client: Pick<LeaderboardClient, 'leader' | 'submit'>; benchmark: () => BenchmarkResult | null; playerName: () => string; category: () => Category; onChange: () => void;
  /** how a lap is sent and kept for later when it cannot be (the page passes `lb.sendRun`, which holds one unsent run in the profile); without it the lap is sent once and not kept */
  sendRun?: (payload: FormulaScorePayload) => Promise<SubmitOk | Failure>;
}
export function createFormulaOnline(o: FormulaOnlineOptions) {
  const track = trackById(DEFAULT_TRACK.formula), send = o.sendRun ?? ((p: FormulaScorePayload) => o.client.submit(p));
  let loaded: FormulaLeaderGhost | null = null, loadedKey = '', askedKey = '', status = '', ghostKey = '', ghostCache: FormulaGhost | null = null;
  let fallbackKey = '', fallback: FormulaLeaderGhost | null = null;
  const playerClass = (): ClassId => { const b = o.benchmark(); return b && isClassId(b.class) ? b.class : DEFAULT_CLASS; };
  const keyNow = (): string => `${playerClass()}|${o.category()}`;
  /** the leader you race: the server's answer for this class and category, or until it answers (or when it cannot) the bundled placeholder lap, so there is always a ghost */
  const current = (): FormulaLeaderGhost => {
    const key = keyNow(); if (loaded && loadedKey === key) return loaded;
    if (!fallback || fallbackKey !== key) { const record = fallbackFormulaLeader(playerClass(), o.category()); fallback = { record, ghost: ghostOfFormulaLeader(track, record), source: 'fallback', online: false, note: '' }; fallbackKey = key; }
    return fallback;
  };
  const api = {
    playerClass, className: (): string => classLabel(playerClass()),
    leader: () => current().record,
    /** 'server': a real player's lap; 'fallback': the bundled placeholder lap (offline, or nobody has a lap yet) */
    source: (): 'server' | 'fallback' => current().source,
    /** the line the screens show about the leader (why the bundled lap is used); empty for a real leader */
    note: (): string => current().note,
    /** the ghost you race (cached: the same record gives the very same ghost) */
    ghost(): FormulaGhost | null {
      const c = current(), rec = c.record, key = JSON.stringify([c.source, rec.class, rec.category, rec.name, rec.timeS, rec.topSpeed]);
      if (key !== ghostKey) { ghostKey = key; ghostCache = c.ghost; }
      return ghostCache;
    },
    /** ask the server once per class and category (until forced). It never throws: no answer means the bundled lap. */
    async refreshLeader(force = false): Promise<void> {
      const key = keyNow(); if (!force && askedKey === key) return; askedKey = key;
      loaded = await loadFormulaLeader(o.client, playerClass(), o.category(), track.id); loadedKey = key; o.onChange();
    },
    /** send a clean ranked lap (with its recorded trace, which gives the compact ghost); returns the line to show on the timeslip: the reason it is not ranked, or how it went */
    async submitLap(slip: FormulaTimeslip, tune: FormulaTune, trace?: LapTrace | null): Promise<string> {
      const benchmark = o.benchmark(), why = whyFormulaNotRanked({ benchmark, slip });
      if (why) { status = why; o.onChange(); return status; }
      const payload = buildFormulaPayload({ playerName: o.playerName(), category: o.category(), benchmark, slip, tune, seed: 0, track, trace });
      if (!payload) { status = 'THIS LAP COULD NOT BE RANKED'; o.onChange(); return status; }
      status = 'SENDING TO THE LEADERBOARD...'; o.onChange();
      const r = await send(payload);
      if (r.ok) { status = `SENT: RANK ${r.classRank} IN ${classLabel(payload.class)}${r.verified ? ' (VERIFIED)' : ''}`; askedKey = ''; }
      else status = r.kind === 'rejected' ? r.message : `${r.message}${r.kind === 'rate-limited' || !o.sendRun ? '' : ': SAVED, WILL SEND NEXT TIME'}`;
      o.onChange(); return status;
    },
    get status(): string { return status; }, clearStatus(): void { status = ''; },
  };
  return api;
}
export type FormulaOnline = ReturnType<typeof createFormulaOnline>;
