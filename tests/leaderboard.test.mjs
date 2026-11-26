// The leaderboard client, the class-leader ghost, the ranked class day, and the payload against the backend's own validator (read from branch feature/leaderboard-backend or backend/).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { memoryStore } from '../src/browser-store.ts';
import { DRAG, STAGE, cleanDragGhost, createDrag, predictDrag, rubberShare, timeslip } from '../src/drag/physics.ts';
import { specForBenchmark } from '../src/drag/spec-source.ts';
import { defaultTune } from '../src/drag/tune.ts';
import { DRAG_CARS } from '../src/drag/data.ts';
import { CLASS_BOUNDS, CLASS_IDS } from '../src/classes.ts';
import { createLeaderboardClient } from '../src/leaderboard/client.ts';
import { markDeltas, deltaText } from '../src/leaderboard/delta.ts';
import { LEADERBOARD_GHOST, buildLeaderGhost, completeSplits, monotoneCurve } from '../src/leaderboard/ghost.ts';
import { allFallbackLeaders, fallbackLeader, parseLeader } from '../src/leaderboard/leader.ts';
import { buildScorePayload, flattenTune, whyNotRanked } from '../src/leaderboard/payload.ts';
import { RANKED, conditionsBanner, densityAltitudeFt, rankedStart, rankedStrip } from '../src/leaderboard/ranked.ts';
import { createLetterPicker, PICKER_LETTERS, PICKER_MAX } from '../src/leaderboard/letter-picker.ts';
import { createLeaderboardUi } from '../src/leaderboard/ui.ts';
import { classScoreCap } from '../src/benchmark/score.ts';

const MARKS = ['ft60', 'ft330', 'eighth', 'ft1000', 'quarter'];
const record = (extra = {}) => ({ name: 'SPEEDY', class: 'discrete', category: 'manual', reactionTime: 0.061, splits: { quarter: 6.4 }, trapSpeed: 210, seed: 12345, source: 'fallback', ...extra });

// ---- the backend's validator, read from the backend branch (its imports have no extension, so a copy with .ts imports is made in a temp folder) ----
function loadBackendValidator() {
  const dir = mkdtempSync(join(tmpdir(), 'gpuwars-backend-'));
  const get = name => {
    const local = new URL(`../backend/src/${name}`, import.meta.url);
    if (existsSync(local)) return readFileSync(local, 'utf8');
    return execFileSync('git', ['show', `origin/feature/leaderboard-backend:backend/src/${name}`], { cwd: new URL('..', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  };
  try {
    for (const name of ['classes.ts', 'plausible.ts', 'validate.ts']) writeFileSync(join(dir, name), get(name).replace(/from '\.\/(\w+)'/g, "from './$1.ts'"));
    return import(pathToFileURL(join(dir, 'validate.ts')).href).then(async validate => ({ validate, classes: await import(pathToFileURL(join(dir, 'classes.ts')).href) }));
  } catch (e) { return Promise.resolve(null); }
}
const backend = await loadBackendValidator();
const needBackend = { skip: backend ? false : 'backend/src/validate.ts is not available (no backend folder and no origin/feature/leaderboard-backend)' };

const cleanSlip = (over = {}) => ({ name: 'YOU', reaction: 0.12, foul: false, ft60: 0.95, ft330: 2.4, eighth: 3.7, ft1000: 5.2, quarter: 6.5, trap: 340, ...over });
const benchmark = { score: 4200, class: 'discrete', benchmarkVersion: 1, gpuId: 'NVIDIA GeForce RTX 3070', date: 1 };
const tune = defaultTune(DRAG_CARS[0]);

test('the game and the backend use the SAME class list: src/classes.ts re-exports backend/src/classes.ts, there is no copy', needBackend, () => {
  const src = readFileSync(new URL('../src/classes.ts', import.meta.url), 'utf8');
  assert.match(src, /export \* from '\.\.\/backend\/src\/classes\.ts'/); assert.ok(!/ERA_BOUNDS\s*[:=]/.test(src) && !/CLASS_IDS\s*[:=]/.test(src), 'no second list of ids or bounds');
  assert.ok(!existsSync(new URL('../src/leaderboard/classes.ts', import.meta.url)), 'the old leaderboard copy is gone');
  assert.deepEqual(CLASS_IDS, backend.classes.CLASS_IDS);
  assert.deepEqual(CLASS_BOUNDS, backend.classes.CLASS_BOUNDS);
});

test('the ghost is deterministic: the same leader gives the very same ghost, a different seed wanders differently', () => {
  const a = buildLeaderGhost(record()), b = buildLeaderGhost(record()), c = buildLeaderGhost(record({ seed: 999 }));
  assert.ok(a && b && c); assert.deepEqual(a, b);
  assert.notDeepEqual(a.samples.map(s => s.y), c.samples.map(s => s.y));
  assert.deepEqual(a.samples.map(s => s.x), c.samples.map(s => s.x), 'the seed only changes the lane drift, never the times');
  assert.ok(Math.max(...a.samples.map(s => Math.abs(s.y))) <= 0.12, 'the drift is small');
  assert.deepEqual(cleanDragGhost(a), a, 'it is already clean: cleaning it again changes nothing');
});

test('the ghost crosses every mark at the leader time, never goes backwards and ends at the trap speed', () => {
  const rec = record({ splits: { ft60: 1.0, ft330: 2.5, eighth: 3.9, ft1000: 5.4, quarter: 6.4 } }), g = buildLeaderGhost(rec);
  for (const m of MARKS) assert.equal(g.marks[m], rec.splits[m]);
  const xAt = t => { const i = g.samples.findIndex(s => s.t >= t); const a = g.samples[i - 1], b = g.samples[i]; return a.x + (b.x - a.x) * (t - a.t) / (b.t - a.t); };
  for (const m of MARKS) assert.ok(Math.abs(xAt(g.reaction + rec.splits[m]) - DRAG.marks[m]) < 0.6, `${m} is crossed on time`);
  for (let i = 1; i < g.samples.length; i++) { assert.ok(g.samples[i].t > g.samples[i - 1].t); assert.ok(g.samples[i].x >= g.samples[i - 1].x - 1e-6, 'never backwards'); }
  assert.ok(Math.abs(g.trap - 210 * 1.609344) < 0.5, 'trap speed is kept (km/h)');
  assert.equal(g.total, +(0.061 + 6.4).toFixed(3));
  assert.ok(g.samples[0].x < 0 && g.samples[0].t < g.reaction, 'a staging path comes before the launch');
  assert.ok(g.samples.length <= 1200);
});

test('missing splits come from the class envelope: increasing, plausible, and a known split is never moved', () => {
  const only = completeSplits(record());
  MARKS.forEach((m, i) => { if (i) assert.ok(only[m] > only[MARKS[i - 1]] + 0.03, `${m} follows the one before`); });
  assert.equal(only.quarter, 6.4); assert.ok(only.ft60 > 0.3 && only.ft60 < 0.2 * 6.4, `60 ft ${only.ft60}`);
  const partly = completeSplits(record({ splits: { ft60: 1.1, ft1000: 5.2, quarter: 6.4 } }));
  assert.equal(partly.ft60, 1.1); assert.equal(partly.ft1000, 5.2);
  assert.ok(partly.ft330 > 1.1 && partly.eighth > partly.ft330 && partly.eighth < 5.2);
  const messy = completeSplits(record({ splits: { ft60: 5, ft330: 2, eighth: NaN, ft1000: 9, quarter: 6.4 } }));
  MARKS.forEach((m, i) => { if (i) assert.ok(messy[m] > messy[MARKS[i - 1]], `messy ${m}`); });
  for (const era of ['integrated', 'discrete']) { const s = completeSplits(fallbackLeader(era)); assert.ok(s.ft60 < s.ft330 && s.ft1000 < s.quarter); }
});

test('bad leader data is cleaned or refused, never trusted', () => {
  assert.equal(buildLeaderGhost(record({ splits: { quarter: NaN } })), null);
  assert.equal(buildLeaderGhost(record({ splits: { quarter: -3 } })), null);
  assert.equal(buildLeaderGhost(record({ splits: { quarter: 500 } })), null);
  const odd = buildLeaderGhost(record({ reactionTime: NaN, trapSpeed: -5, seed: NaN }));
  assert.ok(odd && Number.isFinite(odd.total) && odd.samples.every(s => Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.v)));
  assert.equal(parseLeader(null), null); assert.equal(parseLeader({ class: 'nope' }), null);
  assert.equal(parseLeader({ class: 'integrated', category: 'manual', splits: {} }), null);
  const parsed = parseLeader({ playerName: 'Bob\u0000é', class: 'integrated', category: 'manual', quarterEt: 8.2, reactionTime: 9, trapSpeed: 150, seed: 7, splits: { ft60: 99, ft330: 2.3, quarter: 8.2 } });
  assert.equal(parsed.splits.ft60, undefined, 'a split later than the quarter is dropped'); assert.equal(parsed.splits.ft330, 2.3); assert.equal(parsed.reactionTime, 0.5); assert.match(parsed.name, /^Bob/);
  const curve = monotoneCurve([0, 1, 2], [0, 5, 20], 0, 30); for (let t = 0; t < 2; t += 0.01) assert.ok(curve(t + 0.01).x >= curve(t).x);
});

test('the ghost works as an entrant in the real race: it launches, finishes at the leader time and beats nobody by cheating', () => {
  const spec = specForBenchmark(null), g = buildLeaderGhost(fallbackLeader('discrete'));
  const race = createDrag({ seed: RANKED.seed, conditions: RANKED.conditions, strip: rankedStrip(), quickStart: true, entrants: [{ name: 'YOU', spec, tune, ai: null, ...rankedStart() }, { name: 'LEADER', spec, tune, ghost: g }] });
  for (let i = 0; i < 240 * 14 && race.state.phase !== 'over'; i++) race.step();
  const them = timeslip(race.state.runners[1]);
  assert.equal(them.quarter, g.marks.quarter); assert.equal(them.reaction, g.reaction); assert.ok(race.state.runners[1].x > DRAG.marks.quarter - 1);
});

test('ranked runs use one fixed class day: the same seed and weather for everyone, calm wind, a fresh start', () => {
  assert.equal(RANKED.seed, 20260101); assert.equal(RANKED.conditions.headwind, 0); assert.equal(RANKED.conditions.crosswind, 0); assert.equal(RANKED.conditions.gust, 0);
  assert.deepEqual(RANKED.conditions.weather, { air: 0, track: 0, grip: 0, phase: 0 });
  const spec = specForBenchmark(null), run = () => predictDrag(spec, tune, RANKED.seed, RANKED.conditions, rankedStart().fuel, rankedStart().engineTemp, rankedStrip());
  assert.equal(run().slip.quarter, run().slip.quarter); assert.deepEqual(run().slip, run().slip);
  assert.deepEqual(rankedStart(), { clutchCondition: 1, fuel: rankedStart().fuel, engineTemp: RANKED.conditions.airC });
  assert.ok(rankedStrip().rubber.every(side => side.every(cells => cells.every(v => v === 0))), 'no rubber carried over');
  const da = densityAltitudeFt(RANKED.conditions); assert.ok(da > 0 && da < 3000, `density altitude ${da}`);
  assert.ok(densityAltitudeFt({ airC: 35, altitude: 0 }) > densityAltitudeFt({ airC: 5, altitude: 0 }), 'hotter air is thinner');
  assert.match(conditionsBanner(RANKED.conditions, true), /RANKED CLASS DAY.*DENSITY ALT \d+ FT/); assert.match(conditionsBanner(RANKED.conditions, false), /FREE PLAY/);
  const page = readFileSync(new URL('../src/drag/page.ts', import.meta.url), 'utf8');
  assert.match(page, /seed: RANKED\.seed, conditions: RANKED\.conditions, strip: rankedStrip\(\)/, 'the page races ranked runs on the class day');
});

test('a ranked payload is accepted by the backend validator', needBackend, () => {
  const ghost = buildLeaderGhost(record());
  const payload = buildScorePayload({ playerName: 'Test Pilot', category: 'manual', benchmark, slip: cleanSlip(), tune, seed: RANKED.seed, ghost });
  assert.ok(payload); const r = backend.validate.validateSubmission(JSON.parse(JSON.stringify(payload)));
  assert.ok(r.ok, r.error); assert.equal(r.value.class, 'discrete'); assert.equal(r.value.category, 'manual'); assert.equal(r.value.seed, RANKED.seed);
  assert.ok(payload.ghost && payload.ghost.length <= 256 && payload.ghost.length > 10);
  assert.ok(JSON.stringify(payload).length < backend.validate.MAX_BODY_BYTES, 'under the body limit');
  const auto = buildScorePayload({ playerName: 'Test Pilot', category: 'autopilot', benchmark, slip: cleanSlip(), tune, seed: RANKED.seed });
  assert.ok(backend.validate.validateSubmission(auto).ok); assert.equal(auto.category, 'autopilot');
  assert.ok(Object.keys(flattenTune(tune)).length <= 32);
  assert.equal(backend.validate.validateSubmission({ ...payload, playerName: 'x' }).ok, false, 'the validator does refuse bad payloads');
});

test('every bundled fallback leader fits the backend class bounds and splits rules', needBackend, () => {
  assert.equal(allFallbackLeaders().length, CLASS_IDS.length * 2);
  for (const rec of allFallbackLeaders()) {
    const s = completeSplits(rec), body = { playerName: 'Fallback', class: rec.class, category: rec.category, benchmarkScore: Math.round(classScoreCap(rec.class) * 0.7), benchmarkVersion: '1', gpuId: 'x', reactionTime: rec.reactionTime, splits: s, trapSpeed: rec.trapSpeed, seed: rec.seed, tune: {} };
    const r = backend.validate.validateSubmission(body); assert.ok(r.ok, `${rec.class} ${rec.category}: ${r.error}`);
    assert.ok(buildLeaderGhost(rec), `${rec.class} has a ghost`);
  }
  const et = c => fallbackLeader(c).splits.quarter; assert.ok(et('discrete') < et('integrated') - 3);
  assert.ok(fallbackLeader('integrated', 'autopilot').splits.quarter > et('integrated'));
});

test('only a clean ranked pass with a benchmark is sent', () => {
  assert.match(whyNotRanked({ benchmark: null, slip: cleanSlip() }), /BENCHMARK/);
  assert.match(whyNotRanked({ benchmark: { ...benchmark, class: 'bogus' }, slip: cleanSlip() }), /BENCHMARK/);
  assert.match(whyNotRanked({ benchmark, slip: cleanSlip({ foul: true }) }), /CLEAN/);
  assert.match(whyNotRanked({ benchmark, slip: cleanSlip({ crashed: true }) }), /CLEAN/);
  assert.match(whyNotRanked({ benchmark, slip: cleanSlip({ quarter: undefined }) }), /FINISH/);
  assert.equal(whyNotRanked({ benchmark, slip: cleanSlip() }), null);
  assert.equal(buildScorePayload({ playerName: 'Test Pilot', category: 'manual', benchmark: null, slip: cleanSlip(), tune, seed: 1 }), null);
});

// ---- offline and error handling ----
const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const payload = () => buildScorePayload({ playerName: 'Test Pilot', category: 'manual', benchmark, slip: cleanSlip(), tune, seed: RANKED.seed });

test('with an empty server address override the game is fully offline: nothing throws and the bundled leader is used', async () => {
  const c = createLeaderboardClient({ baseUrl: '', clientId: 'abcdefgh12345678' });
  assert.equal(c.configured, false);
  const s = await c.submit(payload()); assert.equal(s.ok, false); assert.equal(s.kind, 'not-configured'); assert.match(s.message, /OFFLINE/);
  const l = await c.leader('integrated', 'manual'); assert.equal(l.online, false); assert.equal(l.record.source, 'fallback'); assert.equal(l.record.class, 'integrated');
  const b = await c.board('class', 'integrated', 'manual'); assert.equal(b.ok, false);
});

test('network failures, blocked requests, timeouts and bad answers all fall back without throwing', async () => {
  const base = 'https://example.invalid';
  const boom = createLeaderboardClient({ baseUrl: base, clientId: 'abcdefgh12345678', fetchFn: async () => { throw new TypeError('Failed to fetch'); } });
  assert.equal((await boom.submit(payload())).kind, 'offline'); assert.equal((await boom.leader('integrated', 'manual')).online, false); assert.equal((await boom.board('overall', 'integrated', 'manual')).ok, false);
  const slow = createLeaderboardClient({ baseUrl: base, clientId: 'abcdefgh12345678', timeoutMs: 20, fetchFn: (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))) });
  assert.equal((await slow.submit(payload())).kind, 'offline');
  assert.equal((await createLeaderboardClient({ baseUrl: base, clientId: 'abcdefgh12345678', fetchFn: reply(429, { error: 'rate limited' }) }).submit(payload())).kind, 'rate-limited');
  const rejected = await createLeaderboardClient({ baseUrl: base, clientId: 'abcdefgh12345678', fetchFn: reply(422, { error: 'trapSpeed inconsistent with splits' }) }).submit(payload());
  assert.equal(rejected.kind, 'rejected'); assert.match(rejected.message, /TRAPSPEED INCONSISTENT/);
  assert.equal((await createLeaderboardClient({ baseUrl: base, clientId: 'abcdefgh12345678', fetchFn: reply(500, null) }).submit(payload())).kind, 'server');
  const none = await createLeaderboardClient({ baseUrl: base, clientId: 'abcdefgh12345678', fetchFn: reply(404, { error: 'no leader yet' }) }).leader('integrated', 'manual'); assert.equal(none.online, false); assert.match(none.note, /NO LEADER YET/);
  const wrong = await createLeaderboardClient({ baseUrl: base, clientId: 'abcdefgh12345678', fetchFn: reply(200, { nonsense: 1 }) }).leader('integrated', 'manual'); assert.equal(wrong.online, false);
});

test('the client sends X-Client-Id and the right paths, and reads the server answers', async () => {
  const seen = [];
  const fetchFn = async (url, init) => { seen.push({ url, init });
    if (url.includes('/scores')) return { ok: true, status: 200, json: async () => ({ ok: true, classRank: 3, verified: false }) };
    if (url.includes('/leader?')) return { ok: true, status: 200, json: async () => ({ playerName: 'Ace', class: 'integrated', category: 'manual', quarterEt: 8.1, trapSpeed: 140, benchmarkScore: 1, verified: false, reactionTime: 0.05, splits: { ft60: 1.6, ft330: 4.2, eighth: 6.4, ft1000: 7.4, quarter: 8.1 }, seed: 42 }) };
    return { ok: true, status: 200, json: async () => ({ scope: 'class', category: 'manual', entries: [{ rank: 1, playerName: 'Ace', class: 'integrated', category: 'manual', quarterEt: 8.1, trapSpeed: 140, benchmarkScore: 1, verified: false }, { nope: true }] }) }; };
  const c = createLeaderboardClient({ baseUrl: 'https://example.invalid/', clientId: 'abcdefgh12345678', fetchFn });
  const s = await c.submit(payload()); assert.deepEqual(s, { ok: true, classRank: 3, verified: false });
  assert.equal(seen[0].url, 'https://example.invalid/scores'); assert.equal(seen[0].init.method, 'POST'); assert.equal(seen[0].init.headers['X-Client-Id'], 'abcdefgh12345678'); assert.equal(seen[0].init.credentials, 'omit');
  const l = await c.leader('integrated', 'manual'); assert.equal(l.online, true); assert.equal(l.record.name, 'Ace'); assert.equal(l.record.splits.ft60, 1.6); assert.match(seen[1].url, /\/leader\?class=integrated&category=manual$/);
  const b = await c.board('class', 'integrated', 'manual', 10); assert.equal(b.entries.length, 1); assert.match(seen[2].url, /scope=class&category=manual&limit=10&class=integrated/);
  assert.deepEqual(seen[1].init.headers, {}, 'leader reads need no preflight'); assert.deepEqual(seen[2].init.headers, {}, 'board reads need no preflight');
  assert.equal(buildLeaderGhost(l.record).marks.ft60, 1.6, 'the server leader makes the ghost');
});

test('a brief network failure on a read is retried once, but a write is not', async () => {
  const seen = []; let blips = 1;
  const fetchFn = async (url, init) => { seen.push({ url, init });
    if (url.includes('/leaderboard') && blips-- > 0) throw new TypeError('brief blip');
    return { ok: true, status: 200, json: async () => ({ scope: 'overall', category: 'manual', entries: [] }) }; };
  const c = createLeaderboardClient({ baseUrl: 'https://example.invalid/', clientId: 'abcdefgh12345678', fetchFn });
  const b = await c.board('overall', 'integrated', 'manual');
  assert.equal(b.ok, true); assert.equal(seen.length, 2, 'one retry');
  assert.deepEqual(seen[0].init.headers, {}); assert.deepEqual(seen[1].init.headers, {});
  const posts = [];
  await createLeaderboardClient({ baseUrl: 'https://example.invalid/', clientId: 'abcdefgh12345678', fetchFn: async (url, init) => { posts.push(init); throw new TypeError('down'); } }).submit(payload());
  assert.equal(posts.length, 1, 'writes are not retried');
});

test('the ui keeps an unsent run when offline, sends it later, and keeps the name and client id', async () => {
  const store = memoryStore(); let online = false, sent = 0;
  const fetchFn = async url => { if (!online) throw new TypeError('offline'); if (url.includes('/scores')) { sent++; return { ok: true, status: 200, json: async () => ({ ok: true, classRank: 1, verified: false }) }; } return { ok: false, status: 404, json: async () => ({ error: 'no leader yet' }) }; };
  const ui = createLeaderboardUi({ store, benchmark: () => benchmark, onChange: () => {}, fetchFn, baseUrl: 'https://example.invalid' });
  const text = await ui.submitRun(cleanSlip(), tune, RANKED.seed, null);
  assert.match(text, /OFFLINE|COULD NOT REACH/); assert.match(text, /SAVED, WILL SEND NEXT TIME/); assert.ok(ui.profile.pending);
  const again = createLeaderboardUi({ store, benchmark: () => benchmark, onChange: () => {}, fetchFn, baseUrl: 'https://example.invalid' });
  assert.equal(again.profile.clientId, ui.profile.clientId, 'the client id is remembered'); assert.ok(again.profile.pending, 'and so is the waiting run');
  online = true; await again.sendPending(); assert.equal(sent, 1); assert.equal(again.profile.pending, null);
  assert.match(await again.submitRun(cleanSlip({ foul: true }), tune, RANKED.seed, null), /CLEAN/); assert.equal(sent, 1);
  again.startNameEdit(); const pk = again.picker; for (let i = 0; i < 16; i++) pk.remove();
  const pick = ch => { while (pk.letter !== ch) pk.cycle(1); pk.add(); }; for (const ch of 'ACE') pick(ch);
  assert.equal(again.finishNameEdit(), true); assert.equal(again.profile.playerName, 'ACE'); assert.equal(again.picker, null);
  assert.equal(createLeaderboardUi({ store, benchmark: () => benchmark, onChange: () => {} }).profile.playerName, 'ACE', 'the name is remembered');
  const noBench = createLeaderboardUi({ store: memoryStore(), benchmark: () => null, onChange: () => {} }); assert.equal(noBench.playerClass(), 'integrated'); assert.ok(noBench.ghost(), 'a ghost exists before any data');
});

test('the ghost delta is your time minus the leader at each mark', () => {
  const d = markDeltas({ ft60: 1.0, quarter: 6.5 }, { ft60: 1.1, ft330: 2.4, quarter: 6.4 }, 0.12, 0.06);
  assert.deepEqual(d.map(x => x.label), ['R/T', '60 FT', '1/4 MILE']); assert.equal(deltaText(d[1].seconds), '-0.100'); assert.equal(deltaText(d[2].seconds), '+0.100');
});

test('leaderboard code takes no randomness from Math.random and no secrets or real URLs are committed', () => {
  const dir = new URL('../src/leaderboard/', import.meta.url);
  for (const f of readdirSync(dir)) { const src = readFileSync(new URL(f, dir), 'utf8').replace(/\/\/.*$/gm, ''); assert.ok(!/Math\.random/.test(src), `${f} uses no Math.random`); assert.ok(!/https?:\/\//.test(src), `${f} has no URL`); }
  assert.equal(statSync(new URL('../src/leaderboard/config.ts', import.meta.url)).isFile(), true);
});

test('the letter picker: cycle wraps, add and delete edit the name, short names are refused, cancel keeps the old one', () => {
  const p = createLetterPicker('bob'); assert.equal(p.name, 'BOB'); assert.equal(p.letter, 'A');
  p.cycle(-1); assert.equal(p.letter, ' '); p.cycle(-1); assert.equal(p.letter, PICKER_LETTERS.at(-1)); p.cycle(1); p.cycle(1); assert.equal(p.letter, 'A');
  assert.equal(p.add(), true); assert.equal(p.name, 'BOBA'); p.remove(); p.remove(); p.remove(); assert.equal(p.name, 'B'); assert.equal(p.result(), null, 'too short');
  p.cycle(1); p.add(); p.add(); assert.equal(p.name, 'BBB'); assert.equal(p.result(), 'BBB');
  const full = createLetterPicker('X'.repeat(30)); assert.equal(full.name.length, PICKER_MAX); assert.equal(full.add(), false);
  const ui = createLeaderboardUi({ store: memoryStore(), benchmark: () => null, onChange: () => {} }), before = ui.profile.playerName;
  ui.startNameEdit(); ui.picker.remove(); ui.cancelNameEdit(); assert.equal(ui.profile.playerName, before); assert.equal(ui.picker, null);
  ui.startNameEdit(); for (let i = 0; i < 16; i++) ui.picker.remove(); assert.equal(ui.finishNameEdit(), false, 'an empty name is not kept'); assert.ok(ui.picker);
});

test('rubber from your own burnout raises grip: a run on a strip with burnout rubber beats the same run on a fresh strip', () => {
  const spec = specForBenchmark({ score: 10000, class: 'discrete', benchmarkVersion: 2, gpuId: 'x', date: 1 }), fresh = rankedStrip(), burnt = rankedStrip();
  const d = createDrag({ seed: RANKED.seed, conditions: RANKED.conditions, strip: burnt, entrants: [{ name: 'YOU', spec, tune, ai: null, ...rankedStart() }] });
  const r = d.state.runners[0];      // roll to the water box, then burn out down the strip: the rubber is laid past the line (x > 0)
  for (let i = 0; i < 240 * 14 && r.x < 9; i++) { const burn = r.x >= STAGE.waterBoxStart; d.setInput(0, { throttle: burn ? 1 : 0.6, launch: false, shiftUp: false, nitro: false, burnout: burn, brake: false, backUp: false, chute: false, deepStage: false, steer: 0 }); d.step(); }
  assert.ok(rubberShare(burnt, 0) > 0 && rubberShare(fresh, 0) === 0, 'the burnout laid rubber');
  const spinny = { ...tune, launchRpm: 7000, pressure: 12, launchAggression: 10 };      // (the stock tune hooks up without spin, where rubber changes nothing: a soft, high-revving, most aggressive launch on the strongest card does spin)
  const run = strip => predictDrag(spec, spinny, RANKED.seed, RANKED.conditions, rankedStart().fuel, rankedStart().engineTemp, strip).slip;
  const a = run(fresh), b = run(burnt);
  assert.ok(b.ft60 < a.ft60 && b.quarter <= a.quarter, `60 ft ${b.ft60} vs ${a.ft60}, quarter ${b.quarter} vs ${a.quarter}`);
});
