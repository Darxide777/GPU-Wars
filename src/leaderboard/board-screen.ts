// The LEADERBOARD screen's logic, with no page in it: which boards you can flip through, how a row reads, which row is yours, how far a key scrolls, what each failure says,
// and a short-lived cache so flipping between boards is instant and the server (free tier) is asked only once per board. The page (page.ts) only draws what `view()` returns.
import { CLASS_IDS, CATEGORIES, classLabel, type Category, type ClassId } from '../classes.ts';
import type { Board, BoardEntry, Failure, LeaderboardClient } from './client.ts';

/** the most rows the server gives for one board */
export const BOARD_ROWS = 100;
/** a fetched board is reused this long (the server also lets the browser keep it for 10 s) */
export const BOARD_CACHE_MS = 60_000;

export interface BoardChoice { id: 'overall' | ClassId; label: string; scope: 'overall' | 'class'; cls: ClassId }

/** OVERALL first, then every class in the one class list (a class added there appears here by itself) */
export function boardChoices(): BoardChoice[] {
  const first = CLASS_IDS[0] as ClassId;
  return [{ id: 'overall', label: 'OVERALL', scope: 'overall', cls: first }, ...CLASS_IDS.map(id => ({ id, label: classLabel(id), scope: 'class' as const, cls: id }))];
}
/** step a list index left or right, wrapping around */
export const stepIndex = (index: number, delta: number, count: number): number => (count <= 0 ? 0 : (((index + delta) % count) + count) % count);
/** the other category (there are two: manual and autopilot) */
export const nextCategory = (c: Category): Category => CATEGORIES[stepIndex(CATEGORIES.indexOf(c), 1, CATEGORIES.length)] as Category;

/** text safe to put in html (names are already limited to printable characters, but they may hold < > & or quotes) */
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export interface RowText { rank: string; name: string; et: string; trap: string; cls: string }
/** one row as text. The class column only shows on the overall board (a class board is all one class). */
export function formatRow(e: BoardEntry, overall: boolean): RowText {
  return { rank: String(e.rank), name: e.playerName, et: `${e.quarterEt.toFixed(3)} S`, trap: `${Math.round(e.trapSpeed)} MPH`, cls: overall && e.class ? classLabel(e.class as ClassId) : '' };
}
/** your name against a row's (the leaderboard keeps names case-insensitive) */
export const isOwnRow = (e: BoardEntry, myName: string): boolean => e.playerName.toLowerCase() === myName.trim().toLowerCase();
/** the index of your row in the shown rows, or -1 when you are not in them */
export const ownRowIndex = (entries: BoardEntry[], myName: string): number => entries.findIndex(e => isOwnRow(e, myName));

/** where a scroll key lands: `delta` is in rows, the result is clamped so the last row can still sit at the bottom of the window. `visibleRows` is how many rows fit. */
export function scrollTarget(top: number, delta: number, totalRows: number, visibleRows: number): number {
  const most = Math.max(0, totalRows - Math.max(1, visibleRows));
  return Math.max(0, Math.min(most, Math.round(top + delta)));
}
/** a scroll key as a number of rows to move (0 for a key that does not scroll) */
export function scrollKeyRows(key: string, visibleRows: number, totalRows: number): number {
  const page = Math.max(1, visibleRows - 1);
  switch (key) {
    case 'arrowup': case 'w': return -1;
    case 'arrowdown': case 's': return 1;
    case 'pageup': return -page;
    case 'pagedown': return page;
    case 'home': return -totalRows;
    case 'end': return totalRows;
    default: return 0;
  }
}

/** what the screen says for each way a board can fail (all of them can be retried) */
export function failureText(f: Failure): { title: string; detail: string } {
  switch (f.kind) {
    case 'not-configured': return { title: 'NOT CONNECTED', detail: 'THIS BUILD HAS NO LEADERBOARD ADDRESS. THE GAME WORKS OFFLINE.' };
    case 'offline': return { title: 'OFFLINE', detail: 'COULD NOT REACH THE LEADERBOARD. CHECK THE CONNECTION.' };
    case 'rate-limited': return { title: 'SLOW DOWN', detail: 'TOO MANY REQUESTS. WAIT A MINUTE, THEN RETRY.' };
    case 'rejected': return { title: 'REFUSED', detail: f.message };
    default: return { title: 'SERVER PROBLEM', detail: 'THE LEADERBOARD HAD A PROBLEM. TRY AGAIN LATER.' };
  }
}

export type BoardView =
  | { state: 'loading' }
  | { state: 'failed'; failure: Failure; retryable: boolean }
  | { state: 'ready'; entries: BoardEntry[]; ownIndex: number; ownRank: number | null; ageMs: number };

export interface BoardScreenOptions { client: Pick<LeaderboardClient, 'board' | 'configured'>; playerName: () => string; onChange: () => void; now?: () => number; ttlMs?: number }

export function createBoardScreen(o: BoardScreenOptions) {
  const choices = boardChoices(), now = o.now ?? Date.now, ttlMs = o.ttlMs ?? BOARD_CACHE_MS;
  let index = 0, category: Category = 'manual';
  const cache = new Map<string, { board: Board; at: number }>(), failures = new Map<string, Failure>(), loading = new Set<string>();
  const choice = (): BoardChoice => choices[index] as BoardChoice;
  const keyOf = (): string => `${choice().id}|${category}`;

  /** ask for the shown board unless a fresh copy is cached or the same request is already on its way; `force` skips the cache (the REFRESH row) */
  async function load(force = false): Promise<void> {
    const key = keyOf(), hit = cache.get(key);
    if (!force && hit && now() - hit.at < ttlMs) return;
    if (loading.has(key)) return;
    const c = choice(), cat = category;
    loading.add(key); failures.delete(key); o.onChange();
    const r = await o.client.board(c.scope, c.cls, cat, BOARD_ROWS);
    loading.delete(key);
    if (r.ok) cache.set(key, { board: r, at: now() }); else failures.set(key, r);
    o.onChange();
  }
  return {
    choices, load,
    get choice(): BoardChoice { return choice(); }, get category(): Category { return category; }, get key(): string { return keyOf(); },
    get overall(): boolean { return choice().scope === 'overall'; },
    /** flip to the next or previous board (instant when cached) */
    step(delta: number): void { index = stepIndex(index, delta, choices.length); void load(); o.onChange(); },
    toggleCategory(): void { category = nextCategory(category); void load(); o.onChange(); },
    /** drop what failed, and refetch the shown board even if cached */
    refresh(): void { void load(true); },
    view(): BoardView {
      const key = keyOf(), hit = cache.get(key);
      if (loading.has(key) && !hit) return { state: 'loading' };
      if (hit) {
        const entries = hit.board.entries, ownIndex = ownRowIndex(entries, o.playerName());
        return { state: 'ready', entries, ownIndex, ownRank: ownIndex >= 0 ? (entries[ownIndex] as BoardEntry).rank : null, ageMs: now() - hit.at };
      }
      const failure = failures.get(key);
      if (failure) return { state: 'failed', failure, retryable: failure.kind !== 'not-configured' };
      return !o.client.configured ? { state: 'failed', failure: { ok: false, kind: 'not-configured', message: '' }, retryable: false } : { state: 'loading' };
    },
  };
}
export type BoardScreen = ReturnType<typeof createBoardScreen>;
