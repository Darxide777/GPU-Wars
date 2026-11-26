import { describe, expect, it } from 'vitest';
import { handle, type Env } from '../src/index';
import { CLASS_BOUNDS, CLASS_IDS, CLASS_SCORE_CAP } from '../src/classes';
import { plausibleWindow } from '../src/plausible';
import { makeDb, makeDbWithRaw, MIGRATION_FILES } from './d1shim';

const ORIGIN = 'https://html-classic.itch.zone';
const mkEnv = (over: Partial<Env> = {}): Env => ({
  DB: makeDb(), ALLOWED_ORIGINS: 'https://html-classic.itch.zone', ALLOW_ITCH_ZONE_WILDCARD: 'true',
  RATE_LIMIT_PER_MINUTE: '3', BLOCKED_WORDS: 'badword', ...over,
});
const sub = (o: Record<string, unknown> = {}) => ({
  playerName: 'Racer One', class: 'discrete', category: 'manual', benchmarkScore: 5000,
  benchmarkVersion: '1.0', gpuId: 'RTX 3060', reactionTime: 0.05,
  splits: { ft60: 0.9, ft330: 2.3, eighth: 3.6, ft1000: 4.8, quarter: 5.6 },
  trapSpeed: 260, seed: 12345, tune: { gear1: 2.5 }, ...o,
});
const post = (env: Env, body: unknown, ip = '1.1.1.1', origin = ORIGIN) =>
  handle(new Request('https://x/scores', { method: 'POST', body: JSON.stringify(body),
    headers: { Origin: origin, 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' } }), env, 1_000_000);
const get = (env: Env, path: string) => handle(new Request('https://x' + path, { headers: { Origin: ORIGIN } }), env);

describe('classes', () => {
  it('has two classes', () => { expect([...CLASS_IDS]).toEqual(['integrated', 'discrete']); });
  it('lists them on GET /classes', async () => { expect(await (await get(mkEnv(), '/classes')).json()).toEqual({ classes: ['integrated', 'discrete'] }); });
  it('no longer knows the old vendor and generation ids', async () => { expect((await post(mkEnv(), sub({ class: 'discrete-nvidia-modern' }))).status).toBe(422); });
});

describe('class bounds catch impossible runs and accept what the simulation really gives', () => {
  // [class, benchmark score, a real run's ET and trap (mph) from the simulation at that score (docs/CALIBRATION.md), an ET below the class-wide bound]
  const cases: [string, number, number, number, number][] = [
    ['integrated', 8000, 9.5, 139, 7.9], ['integrated', 0, 12.3, 106, 7.9], ['discrete', 0, 6.9, 184, 3.2], ['discrete', 5000, 5.0, 260, 3.2], ['discrete', 10000, 4.03, 338, 3.2],
  ];
  const run = (cls: string, score: number, et: number, mph: number) => sub({ class: cls, benchmarkScore: score, splits: { ft60: +(et * 0.2).toFixed(3), ft330: +(et * 0.44).toFixed(3), eighth: +(et * 0.65).toFixed(3), ft1000: +(et * 0.84).toFixed(3), quarter: et }, trapSpeed: mph });
  it.each(cases)('%s score %f: a real %f s run at %f mph is accepted', async (cls, score, et, mph) => { expect((await post(mkEnv(), run(cls, score, et, mph))).status).toBe(200); });
  it.each(cases)('%s score %f: an impossible time is refused', async (cls, score, _et, mph, impossible) => { expect((await post(mkEnv(), run(cls, score, impossible, mph))).status).toBe(422); });
  it('refuses a trap speed beyond the class', async () => {
    expect((await post(mkEnv(), run('integrated', 8000, 9.6, 250))).status).toBe(422);
    expect((await post(mkEnv(), run('discrete', 10000, 4.0, 420))).status).toBe(422);
  });
});

describe('score-aware plausibility: a weak card cannot post a high-end card time', () => {
  const run = (cls: string, score: number, et: number, mph: number, extra: Record<string, unknown> = {}) =>
    sub({ class: cls, benchmarkScore: score, splits: { ft60: +(et * 0.2).toFixed(3), ft330: +(et * 0.44).toFixed(3), eighth: +(et * 0.65).toFixed(3), ft1000: +(et * 0.84).toFixed(3), quarter: et }, trapSpeed: mph, ...extra });
  const reason = async (o: unknown) => { const r = await post(mkEnv(), o); return { status: r.status, error: ((await r.json()) as any).error as string }; };
  it('refuses 3.7 s at score 1000 with a clear reason', async () => {
    const r = await reason(run('discrete', 1000, 3.7, 330));
    expect(r.status).toBe(422);
    expect(r.error).toMatch(/faster than plausible.*class discrete with benchmark score 1000.*fastest 5\.\d\d s/);
  });
  it('accepts 4.1 s at score 10000', async () => { expect((await post(mkEnv(), run('discrete', 10000, 4.1, 330))).status).toBe(200); });
  it('refuses 9 s at integrated score 0, accepts the weakest card slow', async () => {
    expect((await post(mkEnv(), run('integrated', 0, 9, 140))).status).toBe(422);
    expect((await post(mkEnv(), run('integrated', 0, 12.9, 102))).status).toBe(200);
    expect((await post(mkEnv(), run('discrete', 0, 7.5, 180))).status).toBe(200);
  });
  it('accepts a good tune (0.5 s under the default) and an autopilot-slow run', async () => {
    expect((await post(mkEnv(), run('discrete', 4000, 4.91, 260))).status).toBe(200);
    expect((await post(mkEnv(), run('integrated', 4000, 10.7, 124, { category: 'autopilot' }))).status).toBe(200);
  });
  it('refuses a score above the class cap', async () => {
    const r = await reason(run('integrated', 8001, 9.6, 139));
    expect(r.status).toBe(422);
    expect(r.error).toMatch(/class cap of 8000/);
    expect((await post(mkEnv(), run('discrete', 10001, 4.1, 330))).status).toBe(422);
  });
  it('refuses a trap speed or 60 ft that does not fit the score', async () => {
    expect((await reason(run('discrete', 1000, 6.2, 340))).error).toMatch(/trap speed/);
    expect((await reason(run('discrete', 1000, 6.2, 205, { splits: { ft60: 0.5, ft330: 2.6, eighth: 3.94, ft1000: 5.15, quarter: 6.2 } }))).error).toMatch(/60 ft/);
  });
  it('the window grows slower with a lower score and never leaves the class bounds', () => {
    for (const cls of CLASS_IDS) {
      let lastMin = Infinity;
      for (let score = 0; score <= CLASS_SCORE_CAP[cls]; score += 250) {
        const w = plausibleWindow(cls, score);
        expect(w.minEt).toBeLessThanOrEqual(lastMin + 1e-9);
        expect(w.minEt).toBeGreaterThanOrEqual(CLASS_BOUNDS[cls].minQuarterEt);
        expect(w.maxEt).toBeLessThanOrEqual(CLASS_BOUNDS[cls].maxQuarterEt);
        expect(w.minEt).toBeLessThan(w.maxEt);
        lastMin = w.minEt;
      }
    }
  });
});

describe('validation', () => {
  it('accepts a good run', async () => {
    const r = await post(mkEnv(), sub());
    expect(r.status).toBe(200);
    expect((await r.json() as any).classRank).toBe(1);
  });
  it.each([
    ['bad class', { class: 'nope' }],
    ['bad category', { category: 'x' }],
    ['short name', { playerName: 'ab' }],
    ['blocked name', { playerName: 'my-BadWord' }],
    ['non increasing splits', { splits: { ft60: 0.9, ft330: 0.8, eighth: 3.6, ft1000: 4.8, quarter: 5.6 } }],
    ['negative seed', { seed: -1 }],
    ['bad tune', { tune: { a: 'x' } }],
    ['bad ghost', { ghost: [[1, 5], [0.5, 4]] }],
    ['too many ghost', { ghost: Array.from({ length: 300 }, (_, i) => [i / 100, i]) }],
  ])('rejects %s', async (_n, o) => { expect((await post(mkEnv(), sub(o))).status).toBe(422); });
  it('rejects non-JSON and oversize', async () => {
    const env = mkEnv();
    const bad = await handle(new Request('https://x/scores', { method: 'POST', body: '{nope', headers: { Origin: ORIGIN } }), env);
    expect(bad.status).toBe(400);
    expect((await post(env, sub({ pad: 'x'.repeat(20000) }))).status).toBe(413);
  });
  it('sanitizes the name', async () => {
    const env = mkEnv();
    await post(env, sub({ playerName: '  Fast<b>  Guy ' }));
    const lb = await (await get(env, '/leaderboard?scope=class&class=discrete')).json() as any;
    expect(lb.entries[0].playerName).toBe('Fastb Guy');
  });
});

describe('bounds', () => {
  it('rejects impossible ET for class but allows it for a faster class', async () => {
    const fast = { splits: { ft60: 0.65, ft330: 1.4, eighth: 2.4, ft1000: 3.0, quarter: 3.7 }, trapSpeed: 330 };
    expect((await post(mkEnv(), sub({ ...fast, class: 'integrated' }))).status).toBe(422);
    expect((await post(mkEnv(), sub({ ...fast, class: 'discrete', benchmarkScore: 10000 }))).status).toBe(200);
  });
  it('rejects trap speed inconsistent with splits', async () => {
    expect((await post(mkEnv(), sub({ trapSpeed: 120 }))).status).toBe(422);
  });
});

describe('ranking and categories', () => {
  it('keeps best ET per player, ranks fastest first', async () => {
    const env = mkEnv({ RATE_LIMIT_PER_MINUTE: '100' });
    const q = (et: number) => ({ splits: { ft60: 0.9, ft330: 2.3, eighth: 3.6, ft1000: et - 0.8, quarter: et } });
    await post(env, sub(q(6.0)));
    await post(env, sub({ ...q(5.6), playerName: 'Other Guy' }));
    await post(env, sub(q(5.9))); // improves Racer One
    await post(env, sub(q(6.5))); // worse, ignored
    const lb = await (await get(env, '/leaderboard?scope=class&class=discrete')).json() as any;
    expect(lb.entries.map((e: any) => [e.playerName, e.quarterEt])).toEqual([['Other Guy', 5.6], ['Racer One', 5.9]]);
  });
  it('separates manual and autopilot', async () => {
    const env = mkEnv({ RATE_LIMIT_PER_MINUTE: '100' });
    await post(env, sub());
    await post(env, sub({ category: 'autopilot', playerName: 'Bot Driver' }));
    const m = await (await get(env, '/leaderboard?scope=class&class=discrete&category=manual')).json() as any;
    const a = await (await get(env, '/leaderboard?scope=class&class=discrete&category=autopilot')).json() as any;
    expect(m.entries.length).toBe(1); expect(a.entries[0].playerName).toBe('Bot Driver');
  });
  it('overall board has one entry per player across classes', async () => {
    const env = mkEnv({ RATE_LIMIT_PER_MINUTE: '100' });
    await post(env, sub());
    await post(env, sub({ class: 'integrated', benchmarkScore: 8000, trapSpeed: 139, splits: { ft60: 1.7, ft330: 4.1, eighth: 6.2, ft1000: 8.1, quarter: 9.6 } }));
    const o = await (await get(env, '/leaderboard?scope=overall')).json() as any;
    expect(o.entries.length).toBe(1); expect(o.entries[0].quarterEt).toBe(5.6);
    const i = await (await get(env, '/leaderboard?scope=class&class=integrated')).json() as any;
    expect(i.entries.length).toBe(1); expect(i.entries[0].quarterEt).toBe(9.6);
  });
  it('/leader returns full record, 404 when empty', async () => {
    const env = mkEnv();
    expect((await get(env, '/leader?class=integrated')).status).toBe(404);
    await post(env, sub({ ghost: [[0, 0], [1, 10]] }));
    const l = await (await get(env, '/leader?class=discrete&category=manual')).json() as any;
    expect(l.seed).toBe(12345); expect(l.splits.quarter).toBe(5.6); expect(l.ghost.length).toBe(2);
  });
});

describe('rate limit', () => {
  it('blocks after the limit per IP, not other IPs', async () => {
    const env = mkEnv();
    for (let i = 0; i < 3; i++) expect((await post(env, sub())).status).toBe(200);
    expect((await post(env, sub())).status).toBe(429);
    expect((await post(env, sub(), '2.2.2.2')).status).toBe(200);
  });
});

describe('cors', () => {
  it('answers preflight for allowed origins only', async () => {
    const env = mkEnv();
    const ok = await handle(new Request('https://x/scores', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env);
    expect(ok.status).toBe(204); expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const wild = await handle(new Request('https://x/scores', { method: 'OPTIONS', headers: { Origin: 'https://abc123.itch.zone' } }), env);
    expect(wild.status).toBe(204);
    const no = await handle(new Request('https://x/scores', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), env);
    expect(no.status).toBe(403);
  });
  it('blocks POST from other origins, but public reads work from any origin (itch.io hosts vary)', async () => {
    const env = mkEnv();
    expect((await post(env, sub(), '1.1.1.1', 'https://evil.example')).status).toBe(403);
    for (const origin of ['https://evil.example', 'https://v6p9d9t4.ssl.hwcdn.net', 'null', ORIGIN]) {
      for (const path of ['/leaderboard', '/leader?class=integrated', '/classes', '/nope']) {
        const g = await handle(new Request('https://x' + path, { headers: { Origin: origin } }), env);
        expect(g.headers.get('Access-Control-Allow-Origin')).toBe('*');
      }
    }
  });
  it('answers the preflight of a GET with X-Client-Id for any origin, and a POST preflight only for allowed ones', async () => {
    const env = mkEnv();
    const pre = (origin: string, method: string) => handle(new Request('https://x/leaderboard', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': 'x-client-id' } }), env);
    const get1 = await pre('https://v6p9d9t4.ssl.hwcdn.net', 'GET');
    expect(get1.status).toBe(204); expect(get1.headers.get('Access-Control-Allow-Origin')).toBe('*'); expect(get1.headers.get('Access-Control-Allow-Headers')).toMatch(/X-Client-Id/);
    expect((await pre('https://v6p9d9t4.ssl.hwcdn.net', 'POST')).status).toBe(403);
    expect((await pre(ORIGIN, 'POST')).headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });
  it('lets a browser cache reads for a few seconds, and never a write', async () => {
    const env = mkEnv();
    expect((await get(env, '/leaderboard')).headers.get('Cache-Control')).toBe('public, max-age=10');
    expect((await get(env, '/classes')).headers.get('Cache-Control')).toMatch(/max-age=3600/);
    expect((await post(env, sub())).headers.get('Cache-Control')).toBe('no-store');
  });
  it('allow list is configurable', async () => {
    const env = mkEnv({ ALLOWED_ORIGINS: 'https://custom.example', ALLOW_ITCH_ZONE_WILDCARD: 'false' });
    expect((await post(env, sub(), '1.1.1.1', 'https://custom.example')).status).toBe(200);
    expect((await post(env, sub(), '1.1.1.1', ORIGIN)).status).toBe(403);
  });
});

describe('migration 0002: two classes', () => {
  const MIGRATION = '0002_two_classes.sql';
  const row = (player: string, cls: string, category: string, et: number, created = 1) =>
    `INSERT INTO scores (player_key, player_name, class_id, category, quarter_et, trap_speed, reaction_time, split_60ft, split_330, split_eighth, split_1000, benchmark_score, benchmark_version, gpu_id, seed, tune_json, verified, created_at)
     VALUES ('${player}', '${player}', '${cls}', '${category}', ${et}, 200, 0.06, 1, 2, 3, 4, 5000, '1', 'gpu', 1, '{}', 0, ${created});`;
  const old = () => {
    const h = makeDbWithRaw(MIGRATION_FILES.indexOf(MIGRATION));
    h.exec([
      row('alice', 'discrete-nvidia-modern', 'manual', 5.4), row('alice', 'discrete-amd-retro', 'manual', 6.1), row('alice', 'discrete-nvidia-current', 'manual', 4.5, 5),
      row('alice', 'discrete-intel-current', 'manual', 4.5, 9),            // ties with the run above: the older run stays
      row('alice', 'discrete-nvidia-current', 'autopilot', 4.9),           // another category is its own row
      row('alice', 'integrated', 'manual', 9.9),
      row('bob', 'discrete-other-classic', 'manual', 5.7),                  // a single old row is only renamed
      row('carol', 'discrete', 'manual', 6.0), row('carol', 'discrete-amd-modern', 'manual', 5.2),  // already-new id next to an old one
      row('dave', 'integrated', 'manual', 10.4),
    ].join('\n'));
    return h;
  };
  const all = async (h: ReturnType<typeof makeDbWithRaw>) => (await h.d1.prepare('SELECT player_key, class_id, category, quarter_et, created_at FROM scores ORDER BY player_key, category, class_id').all<any>()).results;

  it('is the migration after 0001, and 0001 is untouched', () => { expect(MIGRATION_FILES).toEqual(['0001_init.sql', MIGRATION]); });
  it('maps every discrete-* id to discrete and keeps the best ET per player, category and class', async () => {
    const h = old(); h.applyMigration(MIGRATION);
    expect(await all(h)).toEqual([
      { player_key: 'alice', class_id: 'discrete', category: 'autopilot', quarter_et: 4.9, created_at: 1 },
      { player_key: 'alice', class_id: 'discrete', category: 'manual', quarter_et: 4.5, created_at: 5 },
      { player_key: 'alice', class_id: 'integrated', category: 'manual', quarter_et: 9.9, created_at: 1 },
      { player_key: 'bob', class_id: 'discrete', category: 'manual', quarter_et: 5.7, created_at: 1 },
      { player_key: 'carol', class_id: 'discrete', category: 'manual', quarter_et: 5.2, created_at: 1 },
      { player_key: 'dave', class_id: 'integrated', category: 'manual', quarter_et: 10.4, created_at: 1 },
    ]);
    const left = (await h.d1.prepare("SELECT COUNT(*) AS n FROM scores WHERE class_id LIKE 'discrete-%'").first<{ n: number }>())!;
    expect(left.n).toBe(0);
  });
  it('is safe to run twice, and an empty database is fine', async () => {
    const h = old(); h.applyMigration(MIGRATION); const once = await all(h); h.applyMigration(MIGRATION); expect(await all(h)).toEqual(once);
    const empty = makeDbWithRaw(1); empty.applyMigration(MIGRATION); expect(await all(empty)).toEqual([]);
  });
  it('the migrated board works through the API and a new submission still improves the kept row', async () => {
    const h = old(); h.applyMigration(MIGRATION);
    const env = mkEnv({ DB: h.d1, RATE_LIMIT_PER_MINUTE: '100' });
    const lb = await (await get(env, '/leaderboard?scope=class&class=discrete')).json() as any;
    expect(lb.entries.map((e: any) => [e.playerName, e.quarterEt])).toEqual([['alice', 4.5], ['carol', 5.2], ['bob', 5.7]]);
    const better = { splits: { ft60: 0.8, ft330: 2, eighth: 3, ft1000: 3.6, quarter: 4.4 }, trapSpeed: 300 };
    expect((await post(env, sub({ playerName: 'alice', ...better }))).status).toBe(200);
    const again = await (await get(env, '/leaderboard?scope=class&class=discrete')).json() as any;
    expect(again.entries[0].quarterEt).toBe(4.4);
    const leader = await (await get(env, '/leader?class=discrete')).json() as any; expect(leader.class).toBe('discrete');
  });
});
