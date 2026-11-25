// The leaderboard client: talks to the Cloudflare Worker (backend/src/index.ts). It NEVER throws and never blocks play: no URL, no network, a blocked request (CORS), a slow
// server or an error answer all come back as `{ ok: false, kind, message }` with a message for the screen. The fetch function and the clock are passed in, so tests need no network.
import { LEADERBOARD_API } from './config.ts';
import { isCategory, isClassId, type Category, type ClassId } from '../classes.ts';
import { fallbackLeader, parseLeader, type LeaderRecord } from './leader.ts';
import type { ScorePayload } from './payload.ts';

export type FailKind = 'not-configured' | 'offline' | 'rate-limited' | 'rejected' | 'server';
export interface Failure { ok: false; kind: FailKind; message: string }
export interface SubmitOk { ok: true; classRank: number; verified: boolean }
export interface BoardEntry { rank: number; playerName: string; class: string; category: string; quarterEt: number; trapSpeed: number; benchmarkScore: number; verified: boolean }
export interface Board { ok: true; scope: 'overall' | 'class'; category: Category; entries: BoardEntry[] }

type FetchFn = (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
export interface ClientOptions { baseUrl?: string; clientId: string; fetchFn?: FetchFn; timeoutMs?: number }

const fail = (kind: FailKind, message: string): Failure => ({ ok: false, kind, message });
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function createLeaderboardClient(o: ClientOptions) {
  const baseUrl = (o.baseUrl ?? LEADERBOARD_API.baseUrl).replace(/\/+$/, ''), timeoutMs = o.timeoutMs ?? LEADERBOARD_API.timeoutMs;
  const fetchFn: FetchFn | null = o.fetchFn ?? (typeof fetch === 'function' ? (fetch as unknown as FetchFn) : null);
  const configured = baseUrl.length > 0 && fetchFn !== null;

  /** one request: the parsed JSON body with its status, or a Failure when the network, CORS or the timeout stopped it */
  async function request(path: string, init: { method: 'GET' | 'POST'; body?: string }): Promise<{ status: number; ok: boolean; body: unknown } | Failure> {
    if (!configured || !fetchFn) return fail('not-configured', 'LEADERBOARD NOT CONNECTED (PLAYING OFFLINE)');
    const controller = typeof AbortController === 'function' ? new AbortController() : null, timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const headers: Record<string, string> = { 'X-Client-Id': o.clientId.slice(0, 64) };
      if (init.body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetchFn(baseUrl + path, { method: init.method, headers, body: init.body, mode: 'cors', credentials: 'omit', cache: 'no-store', signal: controller?.signal });
      let body: unknown = null; try { body = await res.json(); } catch (e) { /* an answer with no JSON: the status still tells the story */ }
      return { status: res.status, ok: res.ok, body };
    } catch (e) {
      return fail('offline', 'COULD NOT REACH THE LEADERBOARD (OFFLINE OR BLOCKED)');
    } finally { if (timer !== null) clearTimeout(timer); }
  }
  const errorText = (body: unknown, fallback: string): string => (isObj(body) && typeof body.error === 'string' ? body.error.toUpperCase().slice(0, 80) : fallback);

  return {
    configured,
    /** send a run. 200: your rank in the class. 422/413/403: the server refused it (the message says why). 429: too many runs, try later. */
    async submit(payload: ScorePayload): Promise<SubmitOk | Failure> {
      const r = await request('/scores', { method: 'POST', body: JSON.stringify(payload) });
      if ('kind' in r) return r;
      if (r.status === 429) return fail('rate-limited', 'TOO MANY RUNS SENT: TRY AGAIN IN A MINUTE');
      if (r.ok && isObj(r.body) && r.body.ok === true) return { ok: true, classRank: typeof r.body.classRank === 'number' ? r.body.classRank : 0, verified: r.body.verified === true };
      if (r.status >= 400 && r.status < 500) return fail('rejected', `REJECTED: ${errorText(r.body, 'NOT ACCEPTED')}`);
      return fail('server', 'THE LEADERBOARD HAD A PROBLEM: TRY LATER');
    },
    /** the class leader to race. Always gives a record: the server's, or the bundled fallback when offline, empty or broken. `online` says which. */
    async leader(cls: ClassId, category: Category): Promise<{ record: LeaderRecord; online: boolean; note: string }> {
      const r = await request(`/leader?class=${encodeURIComponent(cls)}&category=${encodeURIComponent(category)}`, { method: 'GET' });
      const fallback = (note: string) => ({ record: fallbackLeader(cls, category), online: false, note });
      if ('kind' in r) return fallback(r.message);
      if (r.status === 404) return fallback('NO LEADER YET IN THIS CLASS: RACING THE BUNDLED TIME');
      const rec = r.ok ? parseLeader(r.body) : null;
      return rec && rec.class === cls ? { record: rec, online: true, note: '' } : fallback('LEADERBOARD ANSWERED OUT OF ORDER: RACING THE BUNDLED TIME');
    },
    /** a board: the best time per player, fastest first */
    async board(scope: 'overall' | 'class', cls: ClassId, category: Category, limit = LEADERBOARD_API.boardRows): Promise<Board | Failure> {
      const q = `scope=${scope}&category=${category}&limit=${Math.max(1, Math.min(100, Math.floor(limit)))}${scope === 'class' ? `&class=${encodeURIComponent(cls)}` : ''}`;
      const r = await request(`/leaderboard?${q}`, { method: 'GET' });
      if ('kind' in r) return r;
      if (!r.ok || !isObj(r.body) || !Array.isArray(r.body.entries)) return fail(r.status >= 500 || r.ok ? 'server' : 'rejected', `BOARD UNAVAILABLE: ${errorText(r.body, 'TRY LATER')}`);
      const entries: BoardEntry[] = [];
      for (const e of r.body.entries.slice(0, 100)) {
        if (!isObj(e) || typeof e.quarterEt !== 'number' || !Number.isFinite(e.quarterEt)) continue;
        entries.push({
          rank: typeof e.rank === 'number' ? e.rank : entries.length + 1, playerName: typeof e.playerName === 'string' ? e.playerName.replace(/[^\x20-\x7e]/g, '').slice(0, 16) : '?',
          class: isClassId(e.class) ? e.class : '', category: isCategory(e.category) ? e.category : category, quarterEt: e.quarterEt,
          trapSpeed: typeof e.trapSpeed === 'number' ? e.trapSpeed : 0, benchmarkScore: typeof e.benchmarkScore === 'number' ? e.benchmarkScore : 0, verified: e.verified === true,
        });
      }
      return { ok: true, scope, category, entries };
    },
  };
}
export type LeaderboardClient = ReturnType<typeof createLeaderboardClient>;
