import { describe, expect, it } from 'vitest';
import { handle, type Env } from '../src/index';
import { DEFAULT_TRACK, MODE_IDS, TRACKS } from '../src/classes';
import { FORMULA_PLACEHOLDER_TABLE, formulaImplausibleReason, formulaWindow } from '../src/plausible';
import { validateSubmission } from '../src/validate';
import { makeDb, makeDbWithRaw, MIGRATION_FILES } from './d1shim';

const ORIGIN = 'https://html-classic.itch.zone';
const mkEnv = (over: Partial<Env> = {}): Env => ({
  DB: makeDb(), ALLOWED_ORIGINS: ORIGIN, ALLOW_ITCH_ZONE_WILDCARD: 'true', RATE_LIMIT_PER_MINUTE: '100', ...over,
});
const drag = (o: Record<string, unknown> = {}) => ({
  playerName: 'Racer One', class: 'discrete', category: 'manual', benchmarkScore: 5000, benchmarkVersion: '1.0', gpuId: 'RTX 3060', reactionTime: 0.05,
  splits: { ft60: 0.9, ft330: 2.3, eighth: 3.6, ft1000: 4.8, quarter: 5.6 }, trapSpeed: 260, seed: 12345, tune: { gear1: 2.5 }, ...o,
});
const formula = (o: Record<string, unknown> = {}) => ({
  mode: 'formula', track: 'beach', playerName: 'Racer One', class: 'discrete', category: 'manual', benchmarkScore: 5000, benchmarkVersion: '1.0', gpuId: 'RTX 3060',
  splits: { sector1: 12, sector2: 29, lap: 41 }, topSpeed: 280, seed: 777, tune: { downforce: 0.5 }, ...o,
});
const post = (env: Env, body: unknown) => handle(new Request('https://x/scores', { method: 'POST', body: JSON.stringify(body),
  headers: { Origin: ORIGIN, 'CF-Connecting-IP': '1.1.1.1', 'Content-Type': 'application/json' } }), env, 1_000_000);
const get = async (env: Env, path: string) => handle(new Request('https://x' + path, { headers: { Origin: ORIGIN } }), env);
const getJson = async (env: Env, path: string) => (await get(env, path)).json() as Promise<any>;
const errorOf = async (res: Response) => ((await res.json()) as any).error as string;

describe('modes and tracks as data', () => {
  it('has drag and formula, each with a default track', () => {
    expect([...MODE_IDS]).toEqual(['drag', 'formula']);
    expect(DEFAULT_TRACK).toEqual({ drag: 'strip', formula: 'beach' });
    expect(TRACKS.formula).toContain('beach');
  });
  it('GET /modes lists them, GET /classes is unchanged', async () => {
    const env = mkEnv();
    expect((await getJson(env, '/modes')).modes).toEqual([
      { id: 'drag', tracks: ['strip'], defaultTrack: 'strip', metric: 'quarter_et' },
      { id: 'formula', tracks: ['beach'], defaultTrack: 'beach', metric: 'lap_time' },
    ]);
    expect(await getJson(env, '/classes')).toEqual({ classes: ['integrated', 'discrete'] });
  });
});

describe('backward compatibility: an old game build sends no mode and no track', () => {
  it('accepts a drag POST without mode and stores it as drag on the strip', async () => {
    const env = mkEnv();
    const res = await post(env, drag());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toMatchObject({ ok: true, classRank: 1, mode: 'drag', track: 'strip' });
    const v = validateSubmission(drag());
    expect(v.ok && v.value.mode === 'drag' && v.value.track === 'strip' && v.value.timeS === 5.6).toBe(true);
  });
  it('accepts explicit drag and strip too', async () => { expect((await post(mkEnv(), drag({ mode: 'drag', track: 'strip' }))).status).toBe(200); });
  it('old reads (no mode) still return the drag board in the old shape, plus new fields', async () => {
    const env = mkEnv(); await post(env, drag());
    const board = await getJson(env, '/leaderboard?scope=class&class=discrete&category=manual');
    expect(board.entries[0]).toMatchObject({ rank: 1, playerName: 'Racer One', class: 'discrete', category: 'manual', quarterEt: 5.6, trapSpeed: 260, benchmarkScore: 5000, verified: false, mode: 'drag', track: 'strip', timeS: 5.6 });
    const leader = await getJson(env, '/leader?class=discrete');
    expect(leader.splits).toEqual({ ft60: 0.9, ft330: 2.3, eighth: 3.6, ft1000: 4.8, quarter: 5.6 });
    expect(leader.quarterEt).toBe(5.6);
  });
});

describe('formula validation', () => {
  it('accepts a good lap, without a reaction time', async () => {
    const res = await post(mkEnv(), formula());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, mode: 'formula', track: 'beach', classRank: 1 });
  });
  it('defaults the track of a formula run to beach', () => {
    const { track, ...noTrack } = formula(); void track;
    const v = validateSubmission(noTrack);
    expect(v.ok && v.value.track === 'beach' && v.value.mode === 'formula').toBe(true);
  });
  it('refuses an unknown mode or a track of another mode', async () => {
    expect(await errorOf(await post(mkEnv(), formula({ mode: 'rally' })))).toMatch(/unknown mode/);
    expect(await errorOf(await post(mkEnv(), formula({ track: 'strip' })))).toMatch(/unknown track for mode formula/);
    expect(await errorOf(await post(mkEnv(), drag({ track: 'beach' })))).toMatch(/unknown track for mode drag/);
  });
  it('refuses drag splits or a trap speed in a formula run, and lap fields in a drag run', async () => {
    expect((await post(mkEnv(), formula({ splits: drag().splits }))).status).toBe(422);
    expect((await post(mkEnv(), formula({ topSpeed: undefined, trapSpeed: 177 }))).status).toBe(422);
    expect((await post(mkEnv(), drag({ splits: formula().splits }))).status).toBe(422);
  });
  it('splits must be increasing and positive', async () => {
    expect(await errorOf(await post(mkEnv(), formula({ splits: { sector1: 29, sector2: 12, lap: 41 } })))).toMatch(/strictly increasing/);
    expect(await errorOf(await post(mkEnv(), formula({ splits: { sector1: 12, sector2: 29, lap: 29 } })))).toMatch(/strictly increasing/);
    expect((await post(mkEnv(), formula({ splits: { sector1: -1, sector2: 29, lap: 41 } }))).status).toBe(422);
  });
  it('refuses a lap faster than the class outer bound, and slower than the ranking limit', async () => {
    expect(await errorOf(await post(mkEnv(), formula({ splits: { sector1: 8, sector2: 16, lap: 25 } })))).toMatch(/faster than possible/);
    expect(await errorOf(await post(mkEnv(), formula({ class: 'integrated', benchmarkScore: 100, splits: { sector1: 40, sector2: 100, lap: 250 }, topSpeed: 100 })))).toMatch(/too slow/);
  });
  it('is score aware: a weak card cannot post a strong card lap', async () => {
    const quick = { splits: { sector1: 11, sector2: 26, lap: 38 }, topSpeed: 290 };
    expect(await errorOf(await post(mkEnv(), formula({ benchmarkScore: 1000, ...quick })))).toMatch(/faster than plausible for a card of class discrete with benchmark score 1000/);
    expect((await post(mkEnv(), formula({ benchmarkScore: 10000, ...quick, splits: { sector1: 11, sector2: 26, lap: 38 } }))).status).toBe(200);
  });
  it('refuses sectors that do not share the lap, and a top speed outside the window', async () => {
    expect(await errorOf(await post(mkEnv(), formula({ splits: { sector1: 4, sector2: 29, lap: 41 } })))).toMatch(/sector 1/);
    expect(await errorOf(await post(mkEnv(), formula({ splits: { sector1: 12, sector2: 40, lap: 41 } })))).toMatch(/sector 2/);
    expect(await errorOf(await post(mkEnv(), formula({ topSpeed: 90 })))).toMatch(/top speed 90 mph is outside/);
    // The lap-average-versus-top-speed check is a backstop: with these generous placeholder windows the window checks above fire first.
  });
  it('refuses a score above the class cap and a ghost out of range; accepts a short ghost in metres', async () => {
    expect((await post(mkEnv(), formula({ class: 'integrated', benchmarkScore: 9000 }))).status).toBe(422);
    expect((await post(mkEnv(), formula({ ghost: [[0, 0], [300, 10]] }))).status).toBe(422);
    expect((await post(mkEnv(), formula({ ghost: [[0, 0], [10, 1000], [41, 4828]] }))).status).toBe(200);
  });
});

describe('boards, leaders and ranking per mode and track', () => {
  const both = async () => {
    const env = mkEnv();
    await post(env, drag({ playerName: 'Alice' })); await post(env, formula({ playerName: 'Alice' }));
    await post(env, formula({ playerName: 'Bob', splits: { sector1: 11.8, sector2: 28.6, lap: 40 } }));
    return env;
  };
  it('a player has one best row per mode: the same name holds a drag and a formula row', async () => {
    const env = await both();
    expect((await getJson(env, '/leaderboard?scope=class&class=discrete')).entries.map((e: any) => e.playerName)).toEqual(['Alice']);
    expect((await getJson(env, '/leaderboard?scope=class&class=discrete&mode=formula&track=beach')).entries.map((e: any) => [e.playerName, e.timeS])).toEqual([['Bob', 40], ['Alice', 41]]);
  });
  it('formula entries carry topSpeed and timeS, not quarterEt', async () => {
    const e = (await getJson(await both(), '/leaderboard?scope=overall&mode=formula')).entries[0];
    expect(e).toMatchObject({ mode: 'formula', track: 'beach', timeS: 40, topSpeed: 280 });
    expect(e.quarterEt).toBeUndefined();
  });
  it('the overall board is per mode', async () => {
    const env = await both();
    expect((await getJson(env, '/leaderboard?scope=overall&mode=formula')).entries).toHaveLength(2);
    expect((await getJson(env, '/leaderboard?scope=overall')).entries).toHaveLength(1);
  });
  it('/leader returns the formula leader with sectors, seed, tune and ghost', async () => {
    const env = mkEnv(); await post(env, formula({ ghost: [[0, 0], [41, 4828]] }));
    expect(await getJson(env, '/leader?class=discrete&mode=formula')).toMatchObject({
      mode: 'formula', track: 'beach', timeS: 41, topSpeed: 280, splits: { sector1: 12, sector2: 29, lap: 41 }, seed: 777, tune: { downforce: 0.5 }, ghost: [[0, 0], [41, 4828]],
    });
    expect((await get(env, '/leader?class=discrete')).status).toBe(404);
  });
  it('keeps only the better lap and ranks within the mode', async () => {
    const env = mkEnv();
    await post(env, formula({ splits: { sector1: 12, sector2: 29, lap: 41 } }));
    await post(env, formula({ splits: { sector1: 12.4, sector2: 30, lap: 43 } }));
    expect((await getJson(env, '/leader?class=discrete&mode=formula')).timeS).toBe(41);
    const better = await (await post(env, formula({ splits: { sector1: 11.5, sector2: 28, lap: 39.5 } }))).json() as any;
    expect(better.classRank).toBe(1);
    expect((await getJson(env, '/leader?class=discrete&mode=formula')).timeS).toBe(39.5);
  });
  it('answers 400 for an unknown mode or a track of another mode on reads', async () => {
    const env = mkEnv();
    expect((await get(env, '/leaderboard?mode=rally')).status).toBe(400);
    expect((await get(env, '/leaderboard?mode=formula&track=strip')).status).toBe(400);
    expect((await get(env, '/leader?class=discrete&mode=drag&track=beach')).status).toBe(400);
  });
  it('rate limiting counts a formula POST like a drag POST', async () => {
    const env = mkEnv({ RATE_LIMIT_PER_MINUTE: '2' });
    expect((await post(env, drag())).status).toBe(200);
    expect((await post(env, formula())).status).toBe(200);
    expect((await post(env, formula())).status).toBe(429);
  });
});

describe('formula plausibility (PLACEHOLDER numbers, phase 3 calibrates them)', () => {
  it('is flagged as placeholder in the one table', () => { expect(FORMULA_PLACEHOLDER_TABLE.placeholder).toBe(true); });
  it('every class has a lap curve that gets faster with the score and a window inside the outer bounds', () => {
    for (const cls of ['integrated', 'discrete'] as const) {
      const outer = FORMULA_PLACEHOLDER_TABLE.outer[cls];
      let last = Infinity;
      for (let score = 0; score <= 10000; score += 500) {
        const w = formulaWindow(cls, score);
        expect(w.minLapS).toBeGreaterThanOrEqual(outer.minLapS);
        expect(w.maxLapS).toBeLessThanOrEqual(outer.maxLapS);
        expect(w.minLapS).toBeLessThan(w.maxLapS);
        expect(w.minTopMph).toBeLessThan(w.maxTopMph);
        expect(w.minLapS).toBeLessThanOrEqual(last + 1e-9); last = w.minLapS;
      }
    }
  });
  it('a stronger card has a quicker fastest lap; scores above the cap use the cap', () => {
    expect(formulaWindow('discrete', 9000).minLapS).toBeLessThan(formulaWindow('discrete', 1000).minLapS);
    expect(formulaWindow('integrated', 99999)).toEqual(formulaWindow('integrated', 8000));
  });
  it('the sample runs the tests use are plausible, an impossible one is not', () => {
    expect(formulaImplausibleReason('discrete', 5000, 'beach', { sector1: 12, sector2: 29, lap: 41, topSpeed: 280 })).toBeNull();
    expect(formulaImplausibleReason('discrete', 5000, 'beach', { sector1: 22, sector2: 44, lap: 30, topSpeed: 280 })).toMatch(/faster than plausible/);
    expect(formulaImplausibleReason('discrete', 5000, 'beach', { sector1: 22, sector2: 44, lap: 120, topSpeed: 280 })).toMatch(/slower than plausible/);
  });
});

describe('migration 0003: modes and tracks', () => {
  const MIGRATION = '0003_modes.sql';
  const row = (player: string, cls: string, category: string, et: number) =>
    `INSERT INTO scores (player_key, player_name, class_id, category, quarter_et, trap_speed, reaction_time, split_60ft, split_330, split_eighth, split_1000, benchmark_score, benchmark_version, gpu_id, seed, tune_json, ghost_json, verified, created_at)
     VALUES ('${player}', '${player}', '${cls}', '${category}', ${et}, 200, 0.06, 1, 2, 3, 4, 5000, '1', 'gpu', 1, '{}', '[[0,0]]', 0, 7);`;
  const old = () => {
    const h = makeDbWithRaw(MIGRATION_FILES.indexOf(MIGRATION));
    h.exec([row('alice', 'discrete', 'manual', 5.4), row('alice', 'integrated', 'manual', 9.9), row('bob', 'discrete', 'autopilot', 5.9)].join('\n'));
    return h;
  };
  const rows = async (h: ReturnType<typeof makeDbWithRaw>) => (await h.d1.prepare('SELECT * FROM scores ORDER BY id').all<any>()).results;

  it('is the third migration and the earlier two are untouched', () => { expect(MIGRATION_FILES).toEqual(['0001_init.sql', '0002_two_classes.sql', MIGRATION]); });
  it('keeps every existing row, as drag on the strip, with ids and data intact', async () => {
    const h = old(); const before = await rows(h) as any[];
    h.applyMigration(MIGRATION);
    const after = await rows(h) as any[];
    expect(after.map((r) => [r.id, r.player_key, r.class_id, r.category, r.quarter_et, r.split_330, r.ghost_json, r.created_at]))
      .toEqual(before.map((r) => [r.id, r.player_key, r.class_id, r.category, r.quarter_et, r.split_330, r.ghost_json, r.created_at]));
    expect(after.every((r) => r.mode === 'drag' && r.track_id === 'strip')).toBe(true);
  });
  it('rebuilds the unique key: the same player may hold drag and formula rows, but not two of the same', async () => {
    const h = old(); h.applyMigration(MIGRATION);
    const insert = (mode: string, track: string) => h.exec(row('alice', 'discrete', 'manual', 5.4).replace("class_id, category,", "class_id, category,").replace(/INSERT INTO scores \(/, `INSERT INTO scores (mode, track_id, `).replace(/VALUES \(/, `VALUES ('${mode}', '${track}', `));
    insert('formula', 'beach');
    expect(() => insert('formula', 'beach')).toThrow(/UNIQUE/);
    expect(() => insert('drag', 'strip')).toThrow(/UNIQUE/);
    expect((await rows(h)).length).toBe(4);
  });
  it('an insert that names no mode (the old Worker) lands as drag on the strip, but its old upsert key is gone', async () => {
    const h = old(); h.applyMigration(MIGRATION);
    h.exec(row('carol', 'discrete', 'manual', 6.1));
    expect((await rows(h)).find((r: any) => r.player_key === 'carol')).toMatchObject({ mode: 'drag', track_id: 'strip' });
    await expect(h.d1.prepare('INSERT INTO scores (player_key, player_name, class_id, category, quarter_et, trap_speed, benchmark_score, benchmark_version, gpu_id, seed, tune_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(player_key, class_id, category) DO NOTHING')
      .bind('x', 'x', 'discrete', 'manual', 5, 200, 1, '1', 'g', 1, '{}', 1).run()).rejects.toThrow();
  });
  it('makes the new board indexes and drops the old ones', async () => {
    const h = old(); h.applyMigration(MIGRATION);
    const idx = (await h.d1.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='scores' AND name LIKE 'idx_%' ORDER BY name").all<any>()).results;
    expect(idx.map((i: any) => i.name)).toEqual(['idx_scores_board', 'idx_scores_overall']);
    expect(idx[0].sql).toContain('mode, track_id, class_id, category, quarter_et');
    expect(idx[1].sql).toContain('mode, track_id, category, quarter_et');
  });
  it('running it a second time stops at the marker and changes nothing', async () => {
    const h = old(); h.applyMigration(MIGRATION); const once = await rows(h);
    expect(() => h.applyMigration(MIGRATION)).toThrow(/already exists/);
    expect(await rows(h)).toEqual(once);
  });
  it('an empty database migrates, and the migrated board works through the API', async () => {
    const empty = makeDbWithRaw(2); empty.applyMigration(MIGRATION); expect(await rows(empty)).toEqual([]);
    const h = old(); h.applyMigration(MIGRATION);
    const env = mkEnv({ DB: h.d1 });
    expect((await getJson(env, '/leaderboard?scope=class&class=discrete')).entries.map((e: any) => [e.playerName, e.quarterEt])).toEqual([['alice', 5.4]]);
    expect((await post(env, drag({ playerName: 'alice', splits: { ft60: 0.8, ft330: 2, eighth: 3, ft1000: 4, quarter: 5 } }))).status).toBe(200);
    expect((await getJson(env, '/leader?class=discrete')).quarterEt).toBe(5);
    expect((await post(env, formula({ playerName: 'alice' }))).status).toBe(200);
  });
});
