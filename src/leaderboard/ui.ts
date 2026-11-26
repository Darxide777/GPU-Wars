// Everything the page needs from the leaderboard, in one place so page.ts only calls it: which class you race in, the ghost of that class's leader, sending a ranked run,
// and the boards for the RECORDS screen. It keeps its state in this object and tells the page (`onChange`) when something arrived, so the page can redraw.
import type { Store } from '../browser-store.ts';
import type { BenchmarkResult } from '../save.ts';
import type { DragGhost, Timeslip, Tune } from '../drag/types.ts';
import { DEFAULT_CLASS, classLabel, isClassId, type Category, type ClassId } from '../classes.ts';
import { createLeaderboardClient, type Board, type Failure, type LeaderboardClient } from './client.ts';
import { buildLeaderGhost } from './ghost.ts';
import { fallbackLeader, type LeaderRecord } from './leader.ts';
import { buildScorePayload, whyNotRanked } from './payload.ts';
import { createLetterPicker, type LetterPicker } from './letter-picker.ts';
import { loadIdentity, saveIdentity, type Profile } from './profile.ts';
import { LEADERBOARD_API } from './config.ts';

type FetchFn = Parameters<typeof createLeaderboardClient>[0]['fetchFn'];
export interface UiOptions { store: Required<Store>; benchmark: () => BenchmarkResult | null; onChange: () => void; fetchFn?: FetchFn; baseUrl?: string }
export type BoardScope = 'class' | 'overall';

const esc = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export function createLeaderboardUi(o: UiOptions) {
  let profile: Profile = loadIdentity(o.store);
  const client: LeaderboardClient = createLeaderboardClient({ clientId: profile.clientId, fetchFn: o.fetchFn, baseUrl: o.baseUrl });
  saveIdentity(o.store, profile);
  /** the category of runs you drive right now: the autopilot phase sets this to 'autopilot' while its driver races for you */
  let runCategory: Category = 'manual';
  let leader: { record: LeaderRecord; online: boolean; note: string } | null = null, ghostKey = '', ghostCache: DragGhost | null = null, leaderAsked = '';
  let status = '';
  let boardScope: BoardScope = 'class', boardCategory: Category = 'manual', board: Board | Failure | null = null, boardLoading = false;
  let picker: LetterPicker | null = null;

  const playerClass = (): ClassId => { const b = o.benchmark(); return b && isClassId(b.class) ? b.class : DEFAULT_CLASS; };
  const leaderRecord = (): LeaderRecord => (leader && leader.record.class === playerClass() && leader.record.category === runCategory ? leader.record : fallbackLeader(playerClass(), runCategory));
  const api = {
    configured: client.configured, client,
    playerClass, className: (): string => classLabel(playerClass()),
    get profile(): Profile { return profile; },
    get category(): Category { return runCategory; }, setCategory(c: Category): void { runCategory = c; },
    /** the class leader you race, and whether it is a real player (server) or the bundled time */
    leader: leaderRecord, leaderNote: (): string => leader?.note ?? '',
    /** the ghost of the class leader (cached: the same record gives the very same ghost) */
    ghost(): DragGhost | null {
      const rec = leaderRecord(), key = JSON.stringify([rec.class, rec.category, rec.name, rec.splits, rec.trapSpeed, rec.reactionTime, rec.seed]);
      if (key !== ghostKey) { ghostKey = key; ghostCache = buildLeaderGhost(rec); }
      return ghostCache;
    },
    /** ask the server for your class's leader (once per class and category until forced); the fallback ghost is used until it answers or if it never does */
    async refreshLeader(force = false): Promise<void> {
      const cls = playerClass(), key = `${cls}|${runCategory}`; if (!force && leaderAsked === key) return; leaderAsked = key;
      leader = await client.leader(cls, runCategory); o.onChange();
    },
    /** send a finished run if it was a clean ranked one. Returns the line to show on the timeslip. A run that cannot be sent now is kept and sent next time. */
    async submitRun(slip: Timeslip, tune: Tune, seed: number, ghost: DragGhost | null): Promise<string> {
      const benchmark = o.benchmark(), why = whyNotRanked({ benchmark, slip });
      if (why) { status = why; o.onChange(); return status; }
      const payload = buildScorePayload({ playerName: profile.playerName, category: runCategory, benchmark, slip, tune, seed, ghost });
      if (!payload) { status = 'THIS RUN COULD NOT BE RANKED'; o.onChange(); return status; }
      status = 'SENDING TO THE LEADERBOARD...'; o.onChange();
      // keep the faster of this run and one waiting from earlier (same class and category) so a long offline spell sends only the best
      const waiting = profile.pending, best = waiting && waiting.class === payload.class && waiting.category === payload.category && waiting.splits.quarter < payload.splits.quarter ? waiting : payload;
      const r = await client.submit(best);
      if (r.ok) { profile = { ...profile, pending: null }; saveIdentity(o.store, profile); status = `SENT: RANK ${r.classRank} IN ${classLabel(payload.class)}${r.verified ? ' (VERIFIED)' : ''}`; leaderAsked = ''; }
      else { profile = { ...profile, pending: r.kind === 'rejected' ? null : best }; saveIdentity(o.store, profile); status = r.kind === 'rejected' ? r.message : `${r.message}${r.kind === 'rate-limited' ? '' : ': SAVED, WILL SEND NEXT TIME'}`; }
      o.onChange(); return status;
    },
    /** try to send a run kept from an offline spell (called when the records screen opens) */
    async sendPending(): Promise<void> {
      const waiting = profile.pending; if (!waiting || !client.configured) return;
      const r = await client.submit(waiting);
      if (r.ok || r.kind === 'rejected') { profile = { ...profile, pending: null }; saveIdentity(o.store, profile); o.onChange(); }
    },
    get status(): string { return status; }, clearStatus(): void { status = ''; },

    // ---- the boards on the RECORDS screen ----
    get boardScope(): BoardScope { return boardScope; }, get boardCategory(): Category { return boardCategory; },
    setBoardScope(s: BoardScope): void { boardScope = s; void api.loadBoard(); },
    setBoardCategory(c: Category): void { boardCategory = c; void api.loadBoard(); },
    async loadBoard(): Promise<void> {
      boardLoading = true; o.onChange();
      const r = await client.board(boardScope, playerClass(), boardCategory, LEADERBOARD_API.boardRows);
      boardLoading = false; board = r; o.onChange();
    },
    /** the board as table html (or a plain message when offline) */
    boardHtml(): string {
      const title = `${boardScope === 'class' ? classLabel(playerClass()) : 'OVERALL'}  ${boardCategory.toUpperCase()}`;
      if (!client.configured) return `<table><tr><th>${esc(title)}</th><th></th></tr><tr><td>OFFLINE</td><td>LEADERBOARD NOT CONNECTED</td></tr></table>`;
      if (boardLoading) return `<table><tr><th>${esc(title)}</th><th></th></tr><tr><td>LOADING...</td><td></td></tr></table>`;
      if (!board) return `<table><tr><th>${esc(title)}</th><th></th></tr><tr><td>PRESS ENTER ON REFRESH</td><td></td></tr></table>`;
      if (!board.ok) return `<table><tr><th>${esc(title)}</th><th></th></tr><tr><td>OFFLINE</td><td>${esc(board.message)}</td></tr></table>`;
      const mine = profile.playerName.toLowerCase();
      const rows = board.entries.length ? board.entries.map(e => `<tr${e.playerName.toLowerCase() === mine ? ' class="me"' : ''}><td>${e.rank}  ${esc(e.playerName)}</td><td>${e.quarterEt.toFixed(3)} S  ${Math.round(e.trapSpeed)} MPH</td></tr>`).join('') : '<tr><td>NO TIMES YET</td><td>BE THE FIRST</td></tr>';
      return `<table><tr><th>${esc(title)}</th><th></th></tr>${rows}</table>`;
    },

    // ---- your name (picked letter by letter on the NAME screen: works with touch, a gamepad or the arrow keys) ----
    get picker(): LetterPicker | null { return picker; },
    startNameEdit(): void { picker = createLetterPicker(profile.playerName); },
    /** keep the picked name (false when it is not a valid name yet); either way the picker closes only when it was kept */
    finishNameEdit(): boolean { const clean = picker?.result(); if (!clean) return false; profile = { ...profile, playerName: clean }; saveIdentity(o.store, profile); picker = null; return true; },
    cancelNameEdit(): void { picker = null; },
  };
  return api;
}
export type LeaderboardUi = ReturnType<typeof createLeaderboardUi>;
