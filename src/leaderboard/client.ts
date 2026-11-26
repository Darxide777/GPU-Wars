// The leaderboard client: talks to the Cloudflare Worker (backend/src/index.ts). It NEVER throws and never blocks play: no URL, no network, a blocked request (CORS), a slow
// server or an error answer all come back as `{ ok: false, kind, message }` with a message for the screen. The fetch function and the clock are passed in, so tests need no network.
import { LEADERBOARD_API } from './config.ts';
import { DEFAULT_TRACK, isCategory, isClassId, isModeId, type Category, type ClassId, type ModeId } from '../classes.ts';
import { fallbackLeader, parseLeader, type LeaderRecord } from './leader.ts';
import type { ScorePayload } from './payload.ts';

export type FailKind = 'not-configured' | 'offline' | 'rate-limited' | 'rejected' | 'server';
export interface Failure { ok: false; kind: FailKind; message: string }
export interface SubmitOk { ok: true; classRank: number; verified: boolean }
/** Which board: the mode ('drag' or 'formula') and its track. Leave both out for drag on the strip, which is what every call did before modes existed. */
export interface ModeOptions { mode?: ModeId; track?: string }
/** What a formula lap sends (POST /scores). Same fields as a drag run except: a mode and track, three sector splits (elapsed seconds at the end of sector 1, sector 2 and the lap), a top speed in mph, and no reaction time. The drag `ScorePayload` (payload.ts) is unchanged and needs no mode. */
export interface FormulaScorePayload {
  mode: 'formula'; track?: string; playerName: string; class: ClassId; category: Category; benchmarkScore: number; benchmarkVersion: string; gpuId: string;
  splits: { sector1: number; sector2: number; lap: number }; topSpeed: number; seed: number; tune: Record<string, number>;
  /** optional compact ghost: [elapsed seconds, distance along the lap in metres] pairs */ ghost?: Array<[number, number]>;
}
/** One board row. `timeS` is the ranking time in every mode (quarter-mile ET in drag, lap time in formula); `quarterEt` is the same number, kept under its old name so the existing board screen keeps working. */
export interface BoardEntry { rank: number; playerName: string; class: string; category: string; mode: ModeId; track: string; timeS: number; quarterEt: number; trapSpeed: number; benchmarkScore: number; verified: boolean }
export interface Board { ok: true; scope: 'overall' | 'class'; category: Category; mode: ModeId; track: string; entries: BoardEntry[] }
/** The formula class leader, for the ghost. No bundled fallback exists yet (there is no track data to build one from), so `record` is null when the server is offline or has no leader. */
export interface FormulaLeaderRecord {
  name: string; class: ClassId; category: Category; track: string; timeS: number; topSpeed: number;
  sectors: { sector1: number; sector2: number; lap: number }; seed: number; tune: Record<string, number>; ghost: Array<[number, number]> | null;
}
export interface FormulaLeaderResult { record: FormulaLeaderRecord | null; online: boolean; note: string }

type FetchFn = (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
export interface ClientOptions { baseUrl?: string; clientId: string; fetchFn?: FetchFn; timeoutMs?: number }

const fail = (kind: FailKind, message: string): Failure => ({ ok: false, kind, message });
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function createLeaderboardClient(o: ClientOptions) {
  const baseUrl = (o.baseUrl ?? LEADERBOARD_API.baseUrl).replace(/\/+$/, ''), timeoutMs = o.timeoutMs ?? LEADERBOARD_API.timeoutMs;
  const fetchFn: FetchFn | null = o.fetchFn ?? (typeof fetch === 'function' ? (fetch as unknown as FetchFn) : null);
  const configured = baseUrl.length > 0 && fetchFn !== null;

  /** one request: the parsed JSON body with its status, or a Failure when the network, CORS or the timeout stopped it. GETs get one retry inside the same budget because the first request on itch.io can be slow. */
  async function request(path: string, init: { method: 'GET' | 'POST'; body?: string }): Promise<{ status: number; ok: boolean; body: unknown } | Failure> {
    if (!configured || !fetchFn) return fail('not-configured', 'LEADERBOARD NOT CONNECTED (PLAYING OFFLINE)');
    // Only POST needs the client id. Keeping GETs header-free avoids a CORS preflight before a board load.
    const headers: Record<string, string> = {};
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['X-Client-Id'] = o.clientId.slice(0, 64);
    }
    const deadline = Date.now() + timeoutMs, attempts = init.method === 'GET' ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const controller = typeof AbortController === 'function' ? new AbortController() : null, timer = controller ? setTimeout(() => controller.abort(), remaining) : null;
      try {
        const res = await fetchFn(baseUrl + path, { method: init.method, headers, body: init.body, mode: 'cors', credentials: 'omit', cache: 'no-store', signal: controller?.signal });
        let body: unknown = null; try { body = await res.json(); } catch (e) { /* an answer with no JSON: the status still tells the story */ }
        return { status: res.status, ok: res.ok, body };
      } catch (e) {
        if (attempt === attempts - 1 || deadline - Date.now() <= 0) break;
      } finally { if (timer !== null) clearTimeout(timer); }
    }
    return fail('offline', 'COULD NOT REACH THE LEADERBOARD (OFFLINE OR BLOCKED)');
  }
  /** the query text of a mode and track: nothing for drag on the strip (the URL an old build sends), so old and new clients ask the server the same thing */
  const modeQuery = (o?: ModeOptions): string => {
    const mode: ModeId = isModeId(o?.mode) ? o.mode : 'drag', track = typeof o?.track === 'string' && o.track ? o.track : DEFAULT_TRACK[mode];
    return mode === 'drag' && track === DEFAULT_TRACK.drag ? '' : `&mode=${encodeURIComponent(mode)}&track=${encodeURIComponent(track)}`;
  };
  const errorText = (body: unknown, fallback: string): string => (isObj(body) && typeof body.error === 'string' ? body.error.toUpperCase().slice(0, 80) : fallback);

  /** a plain-English message for a formula leader that is not available */
  const noFormulaLeader = (note: string): FormulaLeaderResult => ({ record: null, online: false, note });
  /** the formula leader's record from the server's JSON, or null when anything the ghost needs is missing */
  function parseFormulaLeader(raw: unknown, cls: ClassId, category: Category): FormulaLeaderRecord | null {
    if (!isObj(raw) || raw.class !== cls || !isObj(raw.splits)) return null;
    const sp = raw.splits, num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
    if (!num(sp.sector1) || !num(sp.sector2) || !num(sp.lap) || !(sp.sector1 < sp.sector2 && sp.sector2 < sp.lap)) return null;
    const ghost = Array.isArray(raw.ghost) && raw.ghost.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && Number.isFinite(p[0]) && typeof p[1] === 'number' && Number.isFinite(p[1])) ? (raw.ghost as Array<[number, number]>) : null;
    const tune: Record<string, number> = {};
    if (isObj(raw.tune)) for (const [k, v] of Object.entries(raw.tune)) if (typeof v === 'number' && Number.isFinite(v)) tune[k] = v;
    return {
      name: typeof raw.playerName === 'string' ? raw.playerName.replace(/[^\x20-\x7e]/g, '').slice(0, 16) || 'LEADER' : 'LEADER', class: cls, category: isCategory(raw.category) ? raw.category : category,
      track: typeof raw.track === 'string' ? raw.track : DEFAULT_TRACK.formula, timeS: sp.lap, topSpeed: typeof raw.topSpeed === 'number' ? raw.topSpeed : 0,
      sectors: { sector1: sp.sector1, sector2: sp.sector2, lap: sp.lap }, seed: typeof raw.seed === 'number' && Number.isInteger(raw.seed) ? raw.seed : 1, tune, ghost,
    };
  }

  /** The class leader to race. Drag (the default, what every old call does): always gives a record, the server's or the bundled fallback when offline, empty or broken; `online` says which.
   *  Formula (`{ mode: 'formula' }`): the server's record, or `record: null` with a note when there is none. */
  function leader(cls: ClassId, category: Category, modeOptions?: { mode?: 'drag'; track?: string }): Promise<{ record: LeaderRecord; online: boolean; note: string }>;
  function leader(cls: ClassId, category: Category, modeOptions: { mode: 'formula'; track?: string }): Promise<FormulaLeaderResult>;
  async function leader(cls: ClassId, category: Category, modeOptions: ModeOptions = {}): Promise<{ record: LeaderRecord; online: boolean; note: string } | FormulaLeaderResult> {
    const r = await request(`/leader?class=${encodeURIComponent(cls)}&category=${encodeURIComponent(category)}${modeQuery(modeOptions)}`, { method: 'GET' });
    if (modeOptions.mode === 'formula') {
      if ('kind' in r) return noFormulaLeader(r.message);
      if (r.status === 404) return noFormulaLeader('NO LEADER YET ON THIS TRACK');
      const rec = r.ok ? parseFormulaLeader(r.body, cls, category) : null;
      return rec ? { record: rec, online: true, note: '' } : noFormulaLeader('LEADERBOARD ANSWERED OUT OF ORDER');
    }
    const fallback = (note: string) => ({ record: fallbackLeader(cls, category), online: false, note });
    if ('kind' in r) return fallback(r.message);
    if (r.status === 404) return fallback('NO LEADER YET IN THIS CLASS: RACING THE BUNDLED TIME');
    const rec = r.ok ? parseLeader(r.body) : null;
    return rec && rec.class === cls ? { record: rec, online: true, note: '' } : fallback('LEADERBOARD ANSWERED OUT OF ORDER: RACING THE BUNDLED TIME');
  }

  return {
    configured,
    /** send a run. 200: your rank in the class. 422/413/403: the server refused it (the message says why). 429: too many runs, try later. */
    async submit(payload: ScorePayload | FormulaScorePayload): Promise<SubmitOk | Failure> {
      const r = await request('/scores', { method: 'POST', body: JSON.stringify(payload) });
      if ('kind' in r) return r;
      if (r.status === 429) return fail('rate-limited', 'TOO MANY RUNS SENT: TRY AGAIN IN A MINUTE');
      if (r.ok && isObj(r.body) && r.body.ok === true) return { ok: true, classRank: typeof r.body.classRank === 'number' ? r.body.classRank : 0, verified: r.body.verified === true };
      if (r.status >= 400 && r.status < 500) return fail('rejected', `REJECTED: ${errorText(r.body, 'NOT ACCEPTED')}`);
      return fail('server', 'THE LEADERBOARD HAD A PROBLEM: TRY LATER');
    },
    leader,
    /** a board: the best time per player, fastest first */
    async board(scope: 'overall' | 'class', cls: ClassId, category: Category, limit: number = LEADERBOARD_API.boardRows, modeOptions?: ModeOptions): Promise<Board | Failure> {
      const q = `scope=${scope}&category=${category}&limit=${Math.max(1, Math.min(100, Math.floor(limit)))}${scope === 'class' ? `&class=${encodeURIComponent(cls)}` : ''}${modeQuery(modeOptions)}`;
      const r = await request(`/leaderboard?${q}`, { method: 'GET' });
      if ('kind' in r) return r;
      if (r.status === 429) return fail('rate-limited', 'TOO MANY REQUESTS: TRY AGAIN IN A MINUTE');
      if (!r.ok || !isObj(r.body) || !Array.isArray(r.body.entries)) return fail(r.status >= 500 || r.ok ? 'server' : 'rejected', `BOARD UNAVAILABLE: ${errorText(r.body, 'TRY LATER')}`);
      const entries: BoardEntry[] = [];
      const mode: ModeId = isModeId(r.body.mode) ? r.body.mode : (modeOptions?.mode ?? 'drag'), track = typeof r.body.track === 'string' ? r.body.track : DEFAULT_TRACK[mode];
      for (const e of r.body.entries.slice(0, 100)) {
        // the ranking time is `timeS` (both modes); an older server only sends `quarterEt`
        const timeS = isObj(e) ? (typeof e.timeS === 'number' ? e.timeS : e.quarterEt) : undefined;
        if (!isObj(e) || typeof timeS !== 'number' || !Number.isFinite(timeS)) continue;
        const speed = typeof e.trapSpeed === 'number' ? e.trapSpeed : e.topSpeed;
        entries.push({
          rank: typeof e.rank === 'number' ? e.rank : entries.length + 1, playerName: typeof e.playerName === 'string' ? e.playerName.replace(/[^\x20-\x7e]/g, '').slice(0, 16) : '?',
          class: isClassId(e.class) ? e.class : '', category: isCategory(e.category) ? e.category : category, mode, track, timeS, quarterEt: timeS,
          trapSpeed: typeof speed === 'number' ? speed : 0, benchmarkScore: typeof e.benchmarkScore === 'number' ? e.benchmarkScore : 0, verified: e.verified === true,
        });
      }
      return { ok: true, scope, category, mode, track, entries };
    },
  };
}
export type LeaderboardClient = ReturnType<typeof createLeaderboardClient>;
