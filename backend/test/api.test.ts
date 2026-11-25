import { describe, expect, it } from 'vitest';
import { handle, type Env } from '../src/index';
import { CLASS_IDS } from '../src/classes';
import { makeDb } from './d1shim';

const ORIGIN = 'https://html-classic.itch.zone';
const mkEnv = (over: Partial<Env> = {}): Env => ({
  DB: makeDb(), ALLOWED_ORIGINS: 'https://html-classic.itch.zone', ALLOW_ITCH_ZONE_WILDCARD: 'true',
  RATE_LIMIT_PER_MINUTE: '3', BLOCKED_WORDS: 'badword', ...over,
});
const sub = (o: Record<string, unknown> = {}) => ({
  playerName: 'Racer One', class: 'discrete-nvidia-modern', category: 'manual', benchmarkScore: 5000,
  benchmarkVersion: '1.0', gpuId: 'RTX 3060', reactionTime: 0.05,
  splits: { ft60: 0.9, ft330: 2.3, eighth: 3.6, ft1000: 4.8, quarter: 5.6 },
  trapSpeed: 260, seed: 12345, tune: { gear1: 2.5 }, ...o,
});
const post = (env: Env, body: unknown, ip = '1.1.1.1', origin = ORIGIN) =>
  handle(new Request('https://x/scores', { method: 'POST', body: JSON.stringify(body),
    headers: { Origin: origin, 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' } }), env, 1_000_000);
const get = (env: Env, path: string) => handle(new Request('https://x' + path, { headers: { Origin: ORIGIN } }), env);

describe('classes', () => {
  it('has 17 classes', () => { expect(CLASS_IDS.length).toBe(17); expect(CLASS_IDS).toContain('integrated'); });
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
    const lb = await (await get(env, '/leaderboard?scope=class&class=discrete-nvidia-modern')).json() as any;
    expect(lb.entries[0].playerName).toBe('Fastb Guy');
  });
});

describe('bounds', () => {
  it('rejects impossible ET for class but allows it for a faster class', async () => {
    const fast = { splits: { ft60: 0.6, ft330: 1.4, eighth: 2.2, ft1000: 3.0, quarter: 3.7 }, trapSpeed: 330 };
    expect((await post(mkEnv(), sub({ ...fast, class: 'integrated' }))).status).toBe(422);
    expect((await post(mkEnv(), sub({ ...fast, class: 'discrete-amd-current' }))).status).toBe(200);
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
    const lb = await (await get(env, '/leaderboard?scope=class&class=discrete-nvidia-modern')).json() as any;
    expect(lb.entries.map((e: any) => [e.playerName, e.quarterEt])).toEqual([['Other Guy', 5.6], ['Racer One', 5.9]]);
  });
  it('separates manual and autopilot', async () => {
    const env = mkEnv({ RATE_LIMIT_PER_MINUTE: '100' });
    await post(env, sub());
    await post(env, sub({ category: 'autopilot', playerName: 'Bot Driver' }));
    const m = await (await get(env, '/leaderboard?scope=class&class=discrete-nvidia-modern&category=manual')).json() as any;
    const a = await (await get(env, '/leaderboard?scope=class&class=discrete-nvidia-modern&category=autopilot')).json() as any;
    expect(m.entries.length).toBe(1); expect(a.entries[0].playerName).toBe('Bot Driver');
  });
  it('overall board has one entry per player across classes', async () => {
    const env = mkEnv({ RATE_LIMIT_PER_MINUTE: '100' });
    await post(env, sub());
    await post(env, sub({ class: 'discrete-amd-modern', splits: { ft60: 0.9, ft330: 2.2, eighth: 3.5, ft1000: 4.6, quarter: 5.4 } }));
    const o = await (await get(env, '/leaderboard?scope=overall')).json() as any;
    expect(o.entries.length).toBe(1); expect(o.entries[0].quarterEt).toBe(5.4);
  });
  it('/leader returns full record, 404 when empty', async () => {
    const env = mkEnv();
    expect((await get(env, '/leader?class=integrated')).status).toBe(404);
    await post(env, sub({ ghost: [[0, 0], [1, 10]] }));
    const l = await (await get(env, '/leader?class=discrete-nvidia-modern&category=manual')).json() as any;
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
  it('blocks POST from other origins and omits CORS header on GET', async () => {
    const env = mkEnv();
    expect((await post(env, sub(), '1.1.1.1', 'https://evil.example')).status).toBe(403);
    const g = await handle(new Request('https://x/leaderboard', { headers: { Origin: 'https://evil.example' } }), env);
    expect(g.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
  it('allow list is configurable', async () => {
    const env = mkEnv({ ALLOWED_ORIGINS: 'https://custom.example', ALLOW_ITCH_ZONE_WILDCARD: 'false' });
    expect((await post(env, sub(), '1.1.1.1', 'https://custom.example')).status).toBe(200);
    expect((await post(env, sub(), '1.1.1.1', ORIGIN)).status).toBe(403);
  });
});
