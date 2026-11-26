// The leaderboard client with a mode and a track (drag and formula), against a fake fetch: old calls keep the exact old URLs and bodies, new calls add mode and track.
// Also checks that a formula payload the client would send is accepted by the backend's own validator (copied to a temp folder, as in leaderboard.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLeaderboardClient } from '../src/leaderboard/client.ts';

const base = 'https://example.workers.dev';
const make = (answer) => {
  const seen = [];
  const fetchFn = async (url, init) => { seen.push({ url, init }); const a = typeof answer === 'function' ? answer(url) : answer; return { ok: a.status < 400, status: a.status, json: async () => a.body }; };
  return { seen, client: createLeaderboardClient({ baseUrl: base, clientId: 'abcdefgh12345678', fetchFn }) };
};
const dragPayload = { playerName: 'SPEEDY', class: 'discrete', category: 'manual', benchmarkScore: 5000, benchmarkVersion: '1.0', gpuId: 'RTX 3060', reactionTime: 0.06, splits: { ft60: 0.9, ft330: 2.3, eighth: 3.6, ft1000: 4.8, quarter: 5.6 }, trapSpeed: 260, seed: 1, tune: { a: 1 } };
const formulaPayload = { mode: 'formula', track: 'beach', playerName: 'SPEEDY', class: 'discrete', category: 'manual', benchmarkScore: 5000, benchmarkVersion: '1.0', gpuId: 'RTX 3060', splits: { sector1: 12, sector2: 29, lap: 41 }, topSpeed: 280, seed: 2, tune: { downforce: 0.5 } };

test('submit: a drag payload without a mode is sent unchanged; a formula payload carries its mode and track', async () => {
  const a = make({ status: 200, body: { ok: true, classRank: 3, verified: false } });
  assert.deepEqual(await a.client.submit(dragPayload), { ok: true, classRank: 3, verified: false });
  assert.equal(a.seen[0].url, `${base}/scores`); assert.deepEqual(JSON.parse(a.seen[0].init.body), dragPayload);
  const b = make({ status: 200, body: { ok: true, classRank: 1, verified: false } });
  assert.equal((await b.client.submit(formulaPayload)).ok, true);
  const sent = JSON.parse(b.seen[0].init.body); assert.equal(sent.mode, 'formula'); assert.equal(sent.track, 'beach'); assert.deepEqual(sent.splits, formulaPayload.splits);
});

test('board: with no options the request is exactly the old one; with a mode and track they are added', async () => {
  const old = make({ status: 200, body: { scope: 'class', category: 'manual', entries: [{ rank: 1, playerName: 'A', class: 'discrete', category: 'manual', quarterEt: 5.5, trapSpeed: 250, benchmarkScore: 4000, verified: false }] } });
  const b = await old.client.board('class', 'discrete', 'manual', 25);
  assert.equal(old.seen[0].url, `${base}/leaderboard?scope=class&category=manual&limit=25&class=discrete`);
  assert.equal(b.mode, 'drag'); assert.equal(b.track, 'strip'); assert.equal(b.entries[0].timeS, 5.5); assert.equal(b.entries[0].quarterEt, 5.5);
  const explicit = make({ status: 200, body: { entries: [] } }); await explicit.client.board('overall', 'discrete', 'manual', 10, { mode: 'drag', track: 'strip' });
  assert.equal(explicit.seen[0].url, `${base}/leaderboard?scope=overall&category=manual&limit=10`);
  const f = make({ status: 200, body: { scope: 'class', mode: 'formula', track: 'beach', category: 'autopilot', entries: [{ rank: 1, playerName: 'B', class: 'discrete', category: 'autopilot', mode: 'formula', track: 'beach', timeS: 61.2, topSpeed: 190, benchmarkScore: 9000, verified: false }, { nonsense: true }] } });
  const fb = await f.client.board('class', 'discrete', 'autopilot', 10, { mode: 'formula' });
  assert.equal(f.seen[0].url, `${base}/leaderboard?scope=class&category=autopilot&limit=10&class=discrete&mode=formula&track=beach`);
  assert.equal(fb.mode, 'formula'); assert.equal(fb.entries.length, 1); assert.deepEqual([fb.entries[0].timeS, fb.entries[0].quarterEt, fb.entries[0].trapSpeed], [61.2, 61.2, 190]);
});

test('leader: drag keeps its old URL and fallback; formula asks for its mode and track and has no fallback', async () => {
  const d = make({ status: 404, body: { error: 'no leader yet' } });
  const none = await d.client.leader('integrated', 'manual');
  assert.equal(d.seen[0].url, `${base}/leader?class=integrated&category=manual`); assert.equal(none.online, false); assert.equal(none.record.source, 'fallback');
  const ok = make({ status: 200, body: { mode: 'formula', track: 'beach', playerName: 'ACE', class: 'discrete', category: 'manual', timeS: 60, topSpeed: 200, splits: { sector1: 20, sector2: 40, lap: 60 }, seed: 9, tune: { downforce: 0.4, bad: 'x' }, ghost: [[0, 0], [60, 2400]] } });
  const r = await ok.client.leader('discrete', 'manual', { mode: 'formula', track: 'beach' });
  assert.equal(ok.seen[0].url, `${base}/leader?class=discrete&category=manual&mode=formula&track=beach`);
  assert.equal(r.online, true); assert.deepEqual(r.record.sectors, { sector1: 20, sector2: 40, lap: 60 }); assert.deepEqual(r.record.tune, { downforce: 0.4 }); assert.equal(r.record.timeS, 60); assert.deepEqual(r.record.ghost, [[0, 0], [60, 2400]]);
  const missing = await make({ status: 404, body: { error: 'no leader yet' } }).client.leader('discrete', 'manual', { mode: 'formula' });
  assert.equal(missing.record, null); assert.equal(missing.online, false); assert.match(missing.note, /NO LEADER/);
  const broken = await make({ status: 200, body: { nonsense: 1 } }).client.leader('discrete', 'manual', { mode: 'formula' }); assert.equal(broken.record, null);
  const offline = await createLeaderboardClient({ baseUrl: base, clientId: 'abcdefgh12345678', fetchFn: async () => { throw new TypeError('Failed to fetch'); } }).leader('discrete', 'manual', { mode: 'formula' });
  assert.equal(offline.record, null);
});

test('the client never throws and stays offline-safe without a URL, in both modes', async () => {
  const c = createLeaderboardClient({ baseUrl: '', clientId: 'abcdefgh12345678' });
  assert.equal((await c.submit(formulaPayload)).kind, 'not-configured');
  assert.equal((await c.board('class', 'discrete', 'manual', 5, { mode: 'formula' })).kind, 'not-configured');
  assert.equal((await c.leader('discrete', 'manual', { mode: 'formula' })).record, null);
});

test('a formula payload shaped like the client type is accepted by the backend validator, and a drag payload without a mode still is', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gpuwars-modes-'));
  for (const name of ['classes.ts', 'plausible.ts', 'validate.ts']) writeFileSync(join(dir, name), readFileSync(new URL(`../backend/src/${name}`, import.meta.url), 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.ts'"));
  const { validateSubmission } = await import(pathToFileURL(join(dir, 'validate.ts')).href);
  const f = validateSubmission(formulaPayload); assert.equal(f.ok, true, f.error); assert.equal(f.value.timeS, 41);
  const d = validateSubmission(dragPayload); assert.equal(d.ok, true, d.error); assert.equal(d.value.mode, 'drag'); assert.equal(d.value.track, 'strip');
});
