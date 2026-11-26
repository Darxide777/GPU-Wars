import { CLASS_IDS, DEFAULT_TRACK, MODE_IDS, MODE_METRIC, TRACKS, isCategory, isClassId } from './classes';
import { parseModeAndTrack, validateSubmission, verifyBySimulation, MAX_BODY_BYTES } from './validate';

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
  ALLOW_ITCH_ZONE_WILDCARD?: string;
  RATE_LIMIT_PER_MINUTE?: string;
  HASH_SALT?: string;
  BLOCKED_WORDS?: string;
}

export function originAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  const list = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes(origin)) return true;
  if (env.ALLOW_ITCH_ZONE_WILDCARD === 'true') return /^https:\/\/[a-z0-9.-]+\.itch\.zone$/i.test(origin);
  return false;
}

const CORS_METHODS = 'GET, POST, OPTIONS';
const CORS_HEADERS = 'Content-Type, X-Client-Id';

/** Reads are public: the boards, the leader and the class list hold no secrets and no cookies are involved, so ANY origin may read them (an itch.io game can run from
 * html-classic.itch.zone, an older hwcdn.net host, the itch desktop app or a mirror, and a missing header there looks to the player like "the leaderboard never loads").
 * Writes (POST /scores) stay limited to the allowed origins. A preflight for a GET is answered for any origin; a preflight for anything else only for the allowed ones. */
function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin');
  const wanted = request.method === 'OPTIONS' ? (request.headers.get('Access-Control-Request-Method') ?? '').toUpperCase() : request.method;
  const readOnly = wanted === 'GET' || wanted === 'HEAD';
  const h: Record<string, string> = { Vary: 'Origin' };
  if (readOnly) {
    h['Access-Control-Allow-Origin'] = '*';
    h['Access-Control-Allow-Methods'] = CORS_METHODS;
    h['Access-Control-Allow-Headers'] = CORS_HEADERS;
    h['Access-Control-Max-Age'] = '86400';
  } else if (origin && originAllowed(origin, env)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = CORS_METHODS;
    h['Access-Control-Allow-Headers'] = CORS_HEADERS;
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

/** how long a browser may reuse a read: the class list almost never changes; a board may be a few seconds old */
const CACHE = { never: 'no-store', classes: 'public, max-age=3600', board: 'public, max-age=10' } as const;

function json(data: unknown, status: number, extra: Record<string, string>, cache: string = CACHE.never): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cache, ...extra },
  });
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/** Fixed one-minute window counter in D1. Returns true when the request is allowed. */
export async function checkRateLimit(env: Env, request: Request, now: number): Promise<boolean> {
  const limit = Number(env.RATE_LIMIT_PER_MINUTE ?? '6') || 6;
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const clientId = (request.headers.get('X-Client-Id') ?? '').slice(0, 64);
  const window = Math.floor(now / 60000);
  const keys = [await sha256Hex(`${env.HASH_SALT ?? ''}|ip|${ip}`)];
  if (clientId) keys.push(await sha256Hex(`${env.HASH_SALT ?? ''}|id|${clientId}`));
  let allowed = true;
  for (const key of keys) {
    const row = await env.DB.prepare(
      'INSERT INTO rate_limits (key, window, count) VALUES (?, ?, 1) ON CONFLICT(key, window) DO UPDATE SET count = count + 1 RETURNING count',
    ).bind(key, window).first<{ count: number }>();
    if (!row || row.count > limit) allowed = false;
  }
  // Cheap housekeeping: drop old windows now and then.
  if (window % 10 === 0) await env.DB.prepare('DELETE FROM rate_limits WHERE window < ?').bind(window - 5).run();
  return allowed;
}

async function postScore(request: Request, env: Env, cors: Record<string, string>, now: number): Promise<Response> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: 'payload too large' }, 413, cors);
  let body: unknown;
  try { body = JSON.parse(text); } catch { return json({ error: 'invalid JSON' }, 400, cors); }
  const blocked = (env.BLOCKED_WORDS ?? '').split(',');
  const result = validateSubmission(body, blocked);
  if (!result.ok) return json({ error: result.error }, 422, cors);
  // Rate limit after cheap validation so malformed spam does not burn D1 writes.
  if (!(await checkRateLimit(env, request, now))) return json({ error: 'rate limited' }, 429, { ...cors, 'Retry-After': '60' });
  const s = result.value;
  const sim = await verifyBySimulation(s);
  const key = s.playerName.toLowerCase();
  // One ranking column in both modes (quarter_et holds the quarter-mile ET in drag and the lap time in formula). Drag keeps its five splits; formula keeps its three sectors as JSON.
  const dragSplits = s.mode === 'drag' ? s.splits : null;
  const sectorsJson = s.mode === 'formula' ? JSON.stringify(s.splits) : null;
  const topOrTrapSpeed = s.mode === 'drag' ? s.trapSpeed : s.topSpeed;
  await env.DB.prepare(
    `INSERT INTO scores (player_key, player_name, mode, track_id, class_id, category, quarter_et, trap_speed, reaction_time,
       split_60ft, split_330, split_eighth, split_1000, sectors_json, benchmark_score, benchmark_version, gpu_id, seed,
       tune_json, ghost_json, verified, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(player_key, mode, track_id, class_id, category) DO UPDATE SET
       player_name=excluded.player_name, quarter_et=excluded.quarter_et, trap_speed=excluded.trap_speed,
       reaction_time=excluded.reaction_time, split_60ft=excluded.split_60ft, split_330=excluded.split_330,
       split_eighth=excluded.split_eighth, split_1000=excluded.split_1000, sectors_json=excluded.sectors_json,
       benchmark_score=excluded.benchmark_score,
       benchmark_version=excluded.benchmark_version, gpu_id=excluded.gpu_id, seed=excluded.seed,
       tune_json=excluded.tune_json, ghost_json=excluded.ghost_json, verified=excluded.verified,
       created_at=excluded.created_at
     WHERE excluded.quarter_et < scores.quarter_et`,
  ).bind(
    key, s.playerName, s.mode, s.track, s.class, s.category, s.timeS, topOrTrapSpeed, s.reactionTime,
    dragSplits?.ft60 ?? null, dragSplits?.ft330 ?? null, dragSplits?.eighth ?? null, dragSplits?.ft1000 ?? null, sectorsJson,
    s.benchmarkScore, s.benchmarkVersion,
    s.gpuId, s.seed, JSON.stringify(s.tune), s.ghost ? JSON.stringify(s.ghost) : null, sim.verified ? 1 : 0, now,
  ).run();
  const better = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM scores WHERE mode=? AND track_id=? AND class_id=? AND category=? AND quarter_et <
       (SELECT quarter_et FROM scores WHERE player_key=? AND mode=? AND track_id=? AND class_id=? AND category=?)`,
  ).bind(s.mode, s.track, s.class, s.category, key, s.mode, s.track, s.class, s.category).first<{ n: number }>();
  return json({ ok: true, mode: s.mode, track: s.track, classRank: (better?.n ?? 0) + 1, verified: sim.verified }, 200, cors);
}

interface Row {
  player_name: string; mode: string; track_id: string; class_id: string; category: string; quarter_et: number; trap_speed: number;
  reaction_time: number; split_60ft: number | null; split_330: number | null; split_eighth: number | null; split_1000: number | null; sectors_json: string | null;
  benchmark_score: number; benchmark_version: string; gpu_id: string; seed: number; tune_json: string;
  ghost_json: string | null; verified: number; created_at: number;
}

/** A row for the API. Drag rows look exactly as before (quarterEt, trapSpeed, splits) plus mode, track and timeS; formula rows carry timeS, topSpeed and three sector splits. */
function publicRow(r: Row, full: boolean) {
  const isDrag = r.mode !== 'formula';
  const base = {
    playerName: r.player_name, mode: r.mode, track: r.track_id, class: r.class_id, category: r.category, timeS: r.quarter_et,
    ...(isDrag ? { quarterEt: r.quarter_et, trapSpeed: r.trap_speed } : { topSpeed: r.trap_speed }),
    benchmarkScore: r.benchmark_score, verified: r.verified === 1,
  };
  if (!full) return base;
  const splits = isDrag
    ? { ft60: r.split_60ft, ft330: r.split_330, eighth: r.split_eighth, ft1000: r.split_1000, quarter: r.quarter_et }
    : (r.sectors_json ? JSON.parse(r.sectors_json) : null);
  return {
    ...base,
    reactionTime: r.reaction_time,
    splits,
    benchmarkVersion: r.benchmark_version, gpuId: r.gpu_id, seed: r.seed,
    tune: JSON.parse(r.tune_json), ghost: r.ghost_json ? JSON.parse(r.ghost_json) : null, date: r.created_at,
  };
}

/** the mode and track of a read; both are optional and default to drag on the strip */
function readModeAndTrack(url: URL) {
  return parseModeAndTrack(url.searchParams.get('mode') ?? undefined, url.searchParams.get('track') ?? undefined);
}

async function getLeaderboard(url: URL, env: Env, cors: Record<string, string>): Promise<Response> {
  const scope = url.searchParams.get('scope') ?? 'overall';
  const category = url.searchParams.get('category') ?? 'manual';
  if (scope !== 'overall' && scope !== 'class') return json({ error: 'scope must be overall or class' }, 400, cors);
  if (!isCategory(category)) return json({ error: 'bad category' }, 400, cors);
  const mt = readModeAndTrack(url);
  if (!mt.ok) return json({ error: mt.error }, 400, cors);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '25', 10) || 25));
  let rows: Row[];
  if (scope === 'class') {
    const cls = url.searchParams.get('class');
    if (!isClassId(cls)) return json({ error: 'unknown class' }, 400, cors);
    rows = (await env.DB.prepare('SELECT * FROM scores WHERE mode=? AND track_id=? AND class_id=? AND category=? ORDER BY quarter_et ASC, created_at ASC LIMIT ?')
      .bind(mt.mode, mt.track, cls, category, limit).all<Row>()).results;
  } else {
    // Best run per player across all classes of this mode and track.
    rows = (await env.DB.prepare(
      `SELECT * FROM (SELECT s.*, ROW_NUMBER() OVER (PARTITION BY player_key ORDER BY quarter_et ASC, created_at ASC) AS rn
         FROM scores s WHERE mode=? AND track_id=? AND category=?) WHERE rn=1 ORDER BY quarter_et ASC, created_at ASC LIMIT ?`,
    ).bind(mt.mode, mt.track, category, limit).all<Row>()).results;
  }
  return json({ scope, mode: mt.mode, track: mt.track, category, entries: rows.map((r, i) => ({ rank: i + 1, ...publicRow(r, false) })) }, 200, cors, CACHE.board);
}

async function getLeader(url: URL, env: Env, cors: Record<string, string>): Promise<Response> {
  const cls = url.searchParams.get('class');
  const category = url.searchParams.get('category') ?? 'manual';
  if (!isClassId(cls)) return json({ error: 'unknown class' }, 400, cors);
  if (!isCategory(category)) return json({ error: 'bad category' }, 400, cors);
  const mt = readModeAndTrack(url);
  if (!mt.ok) return json({ error: mt.error }, 400, cors);
  const row = await env.DB.prepare('SELECT * FROM scores WHERE mode=? AND track_id=? AND class_id=? AND category=? ORDER BY quarter_et ASC, created_at ASC LIMIT 1')
    .bind(mt.mode, mt.track, cls, category).first<Row>();
  if (!row) return json({ error: 'no leader yet' }, 404, cors);
  return json(publicRow(row, true), 200, cors, CACHE.board);
}

export async function handle(request: Request, env: Env, now = Date.now()): Promise<Response> {
  const cors = corsHeaders(request, env);
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') {
    return cors['Access-Control-Allow-Origin']
      ? new Response(null, { status: 204, headers: cors })
      : new Response(null, { status: 403 });
  }
  // Browsers always send Origin on cross-origin POST; reject disallowed origins for writes.
  if (request.method === 'POST' && request.headers.get('Origin') && !cors['Access-Control-Allow-Origin'])
    return json({ error: 'origin not allowed' }, 403, cors);
  try {
    if (url.pathname === '/scores' && request.method === 'POST') return await postScore(request, env, cors, now);
    if (url.pathname === '/leaderboard' && request.method === 'GET') return await getLeaderboard(url, env, cors);
    if (url.pathname === '/leader' && request.method === 'GET') return await getLeader(url, env, cors);
    if (url.pathname === '/classes' && request.method === 'GET') return json({ classes: CLASS_IDS }, 200, cors, CACHE.classes);
    // The modes, their tracks and the default track (what to pass as ?mode= and ?track=).
    if (url.pathname === '/modes' && request.method === 'GET')
      return json({ modes: MODE_IDS.map((id) => ({ id, tracks: TRACKS[id], defaultTrack: DEFAULT_TRACK[id], metric: MODE_METRIC[id] })) }, 200, cors, CACHE.classes);
    return json({ error: 'not found' }, 404, cors);
  } catch {
    return json({ error: 'internal error' }, 500, cors);
  }
}

export default { fetch: (request: Request, env: Env) => handle(request, env) };
