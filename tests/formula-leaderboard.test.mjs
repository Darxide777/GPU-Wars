// The Formula side of the leaderboard: the ghost format conversion (sim trace <-> [seconds, metres] pairs), the payload builder (run through the backend's own validator),
// the class leader (server, fallback, offline) and the ghost built for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLeaderboardClient } from '../src/leaderboard/client.ts';
import { driveAutopilotLap, formulaSpecForBenchmark, DEFAULT_FORMULA_TUNE, trackById, ghostFromLap, ghostPose, ghostTimeAt, createFormulaRace, FORMULA_CLASS_WINDOWS } from '../src/formula/index.ts';
import { FORMULA_GHOST_WIRE, cleanPairs, ghostFromRecord, ghostToPairs, pairsAlongAt, pairsTimeAt } from '../src/leaderboard/formula-ghost.ts';
import { buildFormulaPayload, flattenFormulaTune, sectorsOf, whyFormulaNotRanked } from '../src/leaderboard/formula-payload.ts';
import { FORMULA_FALLBACK_LEADERS, allFallbackFormulaLeaders, fallbackFormulaLeader, loadFormulaLeader } from '../src/leaderboard/formula-leader.ts';
import { loadBackend } from './helpers/load-backend.mjs';

const { validate: { validateSubmission }, plausible: { FORMULA_PLACEHOLDER_TABLE, formulaWindow } } = await loadBackend();
const track = trackById('beach');
const benchmark = (cls, score) => ({ score, class: cls, benchmarkVersion: 1, gpuId: 'Test GPU', date: 0 });
const lap = (cls = 'discrete', score = 7000, tune = DEFAULT_FORMULA_TUNE) => driveAutopilotLap({ track, spec: formulaSpecForBenchmark(benchmark(cls, score)), tune, ghost: null });
const input = (race, over = {}) => ({ playerName: 'SPEEDY', category: 'autopilot', benchmark: benchmark('discrete', 7000), slip: race.timeslip(), tune: DEFAULT_FORMULA_TUNE, seed: 4242, track, trace: race.trace(), ...over });
const make = answer => { const seen = []; return { seen, client: createLeaderboardClient({ baseUrl: 'https://x.invalid', clientId: 'abcdefgh12345678', fetchFn: async url => { seen.push(url); const a = typeof answer === 'function' ? answer(url) : answer; return { ok: a.status < 400, status: a.status, json: async () => a.body }; } }) }; };

test('the wire limits of the ghost match what the backend checks', () => {
  assert.equal(FORMULA_GHOST_WIRE.maxSeconds, FORMULA_PLACEHOLDER_TABLE.ghost.maxSeconds); assert.equal(FORMULA_GHOST_WIRE.maxMetres, FORMULA_PLACEHOLDER_TABLE.ghost.maxDistanceM);
  assert.ok(FORMULA_GHOST_WIRE.targetSamples <= FORMULA_GHOST_WIRE.maxSamples);
});

test('ghost to pairs: from the start line to the finish, ordered, small, ending at the lap time and the lap length', () => {
  const race = lap(), slip = race.timeslip(), ghost = ghostFromLap(track, slip, race.trace(), 'me'), pairs = ghostToPairs(ghost);
  assert.ok(ghost && pairs); assert.ok(pairs.length <= FORMULA_GHOST_WIRE.maxSamples && pairs.length > 50);
  assert.deepEqual(pairs[0], [0, pairs[0][1]]); assert.ok(Math.abs(pairs[0][1]) < 1, `the first pair is the start line (${pairs[0][1]} m)`);
  const last = pairs[pairs.length - 1]; assert.equal(last[0], slip.lapTime); assert.ok(Math.abs(last[1] - track.length) < 14, `finish ${last[1]} vs ${track.length}`);
  for (let i = 1; i < pairs.length; i++) { assert.ok(pairs[i][0] >= pairs[i - 1][0] && pairs[i][1] >= pairs[i - 1][1]); }
  assert.equal(ghostToPairs(null), undefined);
});

test('round trip: a driven lap through pairs and back puts the ghost where the real lap was, at the splits, with the same lap time', () => {
  const race = lap(), slip = race.timeslip(), original = ghostFromLap(track, slip, race.trace(), 'me');
  const back = ghostFromRecord(track, { name: 'me', lapTime: slip.lapTime, pairs: ghostToPairs(original), topSpeed: slip.topSpeed });
  assert.ok(back); assert.equal(back.lapTime, slip.lapTime); assert.equal(back.splits.length, track.gates.length);
  for (let i = 0; i < back.splits.length; i++) assert.ok(Math.abs(back.splits[i] - slip.splits[i]) < 0.12, `split ${i}: ${back.splits[i]} vs ${slip.splits[i]}`);
  for (const t of [1, 5, 10, 20, 30, slip.lapTime - 1]) {
    const a = ghostPose(original, track, original.launchTime + t).along, b = ghostPose(back, track, back.launchTime + t).along;
    assert.ok(Math.abs(a - b) < 6, `t=${t}: ${a.toFixed(1)} vs ${b.toFixed(1)} m`);
  }
  for (let i = 1; i < back.trace.s.length; i++) assert.ok(back.trace.s[i] >= back.trace.s[i - 1], 'never goes backwards');
  assert.ok(Math.max(...back.trace.v) / 10 > 80, 'speed is re-derived from the pairs');
  // and the pairs of the rebuilt ghost are the pairs we started with (a second trip changes nothing that matters)
  const again = ghostToPairs(back);
  for (let i = 0; i < again.length; i += 20) assert.ok(Math.abs(again[i][1] - ghostToPairs(original)[i][1]) < 8);
});

test('pairs helpers: interpolation both ways, and hostile pairs are refused', () => {
  const pairs = [[0, 0], [10, 400], [20, 1400]];
  assert.equal(pairsAlongAt(pairs, 5), 200); assert.equal(pairsAlongAt(pairs, 99), 1400); assert.equal(pairsAlongAt(pairs, -1), 0);
  assert.equal(pairsTimeAt(pairs, 900), 15); assert.equal(pairsTimeAt(pairs, 5000), null);
  assert.deepEqual(cleanPairs(pairs), pairs);
  for (const bad of [null, [], [[0, 0]], [[0, 0], [0, 0]], [[1, 5], [0, 6]], [[0, 5], [1, 4]], [[0, 0], [1, 30000]], [[0, 0], [300, 5]], [[0, 0], ['a', 1]], [[0, 0], [NaN, 1]], 'x']) assert.equal(cleanPairs(bad), null, JSON.stringify(bad));
});

test('a record with no pairs, or pairs that do not fit the lap, makes a ghost from the lap time instead; an impossible lap time makes none', () => {
  const a = ghostFromRecord(track, { name: 'x', lapTime: 44 }); assert.ok(a); assert.equal(a.lapTime, 44);
  const b = ghostFromRecord(track, { name: 'x', lapTime: 44, pairs: [[0, 0], [10, 50]] }); assert.equal(JSON.stringify(b), JSON.stringify(a), 'pairs that stop short are ignored');
  assert.equal(ghostFromRecord(track, { name: 'x', lapTime: 1 }), null); assert.equal(ghostFromRecord(track, { name: 'x', lapTime: NaN }), null);
});

test('sectors: the 2nd, 5th and 7th of seven splits; broken splits give none', () => {
  assert.deepEqual(sectorsOf([6, 12, 18, 24, 30, 36, 42]), { sector1: 12, sector2: 30, lap: 42 });
  assert.equal(sectorsOf([1, 2]), null); assert.equal(sectorsOf([1, 1, 2]), null); assert.equal(sectorsOf([1, NaN, 3]), null);
});

test('the payload of an honest lap is accepted by the backend validator, in both categories and both classes, with a ghost', () => {
  for (const [cls, score] of [['integrated', 0], ['integrated', 8000], ['discrete', 0], ['discrete', 10000], ['discrete', 7000]]) {
    const race = lap(cls, score), p = buildFormulaPayload(input(race, { benchmark: benchmark(cls, score) }));
    assert.ok(p, `${cls} ${score}`); assert.equal(p.mode, 'formula'); assert.equal(p.track, 'beach'); assert.equal(p.category, 'autopilot');
    assert.ok(p.ghost && p.ghost.length <= 256); assert.ok(Object.keys(p.tune).length <= 32);
    const v = validateSubmission(JSON.parse(JSON.stringify(p))); assert.equal(v.ok, true, `${cls} ${score}: ${v.error}`);
    assert.equal(v.value.timeS, race.timeslip().lapTime);
  }
  const race = lap(), manual = buildFormulaPayload(input(race, { category: 'manual', trace: null }));
  assert.equal(manual.ghost, undefined); assert.equal(validateSubmission(manual).ok, true);
});

test('every class and score the sim can make lands inside the backend window (the placeholder table agrees with the sim)', () => {
  for (const [cls, scores] of [['integrated', [0, 2000, 4000, 6000, 8000]], ['discrete', [0, 2500, 5000, 7500, 10000]]]) for (const score of scores) {
    const slip = lap(cls, score).timeslip(), w = formulaWindow(cls, score), mph = slip.topSpeed * 0.621371;
    assert.ok(slip.lapTime >= w.minLapS && slip.lapTime <= w.maxLapS, `${cls} ${score}: ${slip.lapTime} in ${w.minLapS}-${w.maxLapS}`);
    assert.ok(mph >= w.minTopMph && mph <= w.maxTopMph, `${cls} ${score}: ${mph} mph in ${w.minTopMph}-${w.maxTopMph}`);
  }
  assert.ok(FORMULA_CLASS_WINDOWS.integrated && FORMULA_CLASS_WINDOWS.discrete);
});

test('laps that must not be sent are refused with a reason: no benchmark, jump start, unfinished, foul', () => {
  const race = lap(), good = input(race);
  assert.equal(whyFormulaNotRanked(good), null);
  assert.match(whyFormulaNotRanked({ ...good, benchmark: null }), /BENCHMARK/); assert.equal(buildFormulaPayload({ ...good, benchmark: null }), null);
  assert.match(whyFormulaNotRanked({ ...good, benchmark: { ...good.benchmark, class: 'nonsense' } }), /BENCHMARK/);
  assert.match(whyFormulaNotRanked({ ...good, slip: { ...good.slip, jumpStart: true, valid: false } }), /JUMP START/); assert.equal(buildFormulaPayload({ ...good, slip: { ...good.slip, jumpStart: true, valid: false } }), null);
  assert.match(whyFormulaNotRanked({ ...good, slip: { ...good.slip, finished: false, valid: false } }), /DID NOT FINISH/);
  assert.match(whyFormulaNotRanked({ ...good, slip: { ...good.slip, valid: false } }), /CLEAN/);
  assert.equal(buildFormulaPayload({ ...good, slip: { ...good.slip, splits: [] } }), null);
  // a real jump start from the sim: gas before the green
  const jump = createFormulaRace({ track, spec: formulaSpecForBenchmark(benchmark('discrete', 7000)), tune: DEFAULT_FORMULA_TUNE, ghost: null });
  for (let i = 0; i < 30; i++) jump.step({ throttle: 1, brake: 0, steer: 0, shiftUp: false, shiftDown: false, nitro: false });
  assert.equal(jump.timeslip().jumpStart, true); assert.ok(whyFormulaNotRanked({ ...good, slip: jump.timeslip() }));
});

test('the payload clamps what a hostile caller could stuff in it', () => {
  const race = lap(), p = buildFormulaPayload(input(race, { seed: 1e12, playerName: 'A', benchmark: { ...benchmark('discrete', 7000), score: 1e9, gpuId: 'g'.repeat(500), benchmarkVersion: '1 ./x y' } }));
  assert.equal(p.seed, 0xffffffff); assert.equal(p.benchmarkScore, 1e7); assert.equal(p.gpuId.length, 120); assert.match(p.benchmarkVersion, /^[\w.\-]+$/);
  assert.deepEqual(Object.keys(flattenFormulaTune({ ...DEFAULT_FORMULA_TUNE, gearing: 99, gearbox: 'auto' })).sort(), ['downforce', 'gearing', 'nitro', 'pressure', 'shiftLight', 'shiftManual', 'steering']);
  assert.equal(flattenFormulaTune({ ...DEFAULT_FORMULA_TUNE, gearing: 99, gearbox: 'auto' }).gearing, 1); assert.equal(flattenFormulaTune({ ...DEFAULT_FORMULA_TUNE, gearbox: 'auto' }).shiftManual, 0);
});

test('fallback leaders: both classes and categories, plausible for the backend, slower than the sim\'s best car, quicker than a typical default-tune car', () => {
  const all = allFallbackFormulaLeaders(); assert.equal(all.length, 4);
  for (const l of all) {
    assert.equal(l.track, 'beach'); assert.ok(l.sectors.sector1 < l.sectors.sector2 && l.sectors.sector2 < l.sectors.lap); assert.equal(l.timeS, l.sectors.lap);
    const out = validateSubmission({ mode: 'formula', playerName: 'Leader One', class: l.class, category: l.category, benchmarkScore: l.class === 'discrete' ? 7000 : 5600, benchmarkVersion: '1', gpuId: 'x', splits: l.sectors, topSpeed: l.topSpeed, seed: l.seed, tune: {} });
    assert.equal(out.ok, true, `${l.class} ${l.category}: ${out.error}`);
  }
  assert.equal(FORMULA_FALLBACK_LEADERS.placeholder, true);
  assert.ok(fallbackFormulaLeader('integrated').timeS > 45.5 && fallbackFormulaLeader('discrete').timeS > 38.1, 'a best-score default tune still gets close');
  assert.ok(fallbackFormulaLeader('integrated').timeS < lap('integrated', 5600).timeslip().lapTime && fallbackFormulaLeader('discrete').timeS < lap('discrete', 7000).timeslip().lapTime, 'better than a typical default tune');
  assert.ok(fallbackFormulaLeader('discrete', 'autopilot').timeS > fallbackFormulaLeader('discrete').timeS);
  assert.deepEqual(fallbackFormulaLeader('discrete'), fallbackFormulaLeader('discrete'));
});

test('loadFormulaLeader: the server\'s leader and its ghost; the bundled lap when offline, empty (404) or broken; the request names mode and track', async () => {
  const race = lap(), slip = race.timeslip(), ghost = ghostToPairs(ghostFromLap(track, slip, race.trace(), 'x'));
  const body = { playerName: 'ACE', class: 'discrete', category: 'manual', mode: 'formula', track: 'beach', timeS: slip.lapTime, topSpeed: 280, splits: { sector1: slip.splits[1], sector2: slip.splits[4], lap: slip.lapTime }, seed: 9, tune: { gearing: 0.2 }, ghost };
  const online = make({ status: 200, body }), a = await loadFormulaLeader(online.client, 'discrete', 'manual');
  assert.equal(online.seen[0], 'https://x.invalid/leader?class=discrete&category=manual&mode=formula&track=beach');
  assert.equal(a.source, 'server'); assert.equal(a.online, true); assert.equal(a.record.name, 'ACE'); assert.equal(a.ghost.lapTime, slip.lapTime); assert.ok(Math.abs(a.ghost.splits[2] - slip.splits[2]) < 0.12, 'it crosses the gates when the real lap did');
  for (const answer of [{ status: 404, body: { error: 'none' } }, { status: 500, body: {} }, { status: 200, body: { junk: 1 } }]) {
    const f = await loadFormulaLeader(make(answer).client, 'integrated', 'autopilot');
    assert.equal(f.source, 'fallback'); assert.equal(f.online, false); assert.equal(f.record.timeS, fallbackFormulaLeader('integrated', 'autopilot').timeS); assert.ok(f.ghost && f.ghost.lapTime === f.record.timeS); assert.match(f.note, /BUNDLED/);
  }
  const down = await loadFormulaLeader(createLeaderboardClient({ baseUrl: 'https://x.invalid', clientId: 'abcdefgh12345678', fetchFn: async () => { throw new TypeError('offline'); } }), 'discrete', 'manual');
  assert.equal(down.source, 'fallback'); assert.ok(down.ghost);
  const unset = await loadFormulaLeader(createLeaderboardClient({ baseUrl: '', clientId: 'abcdefgh12345678' }), 'discrete', 'manual'); assert.equal(unset.source, 'fallback');
  // a server lap the sim refuses (too quick to be a lap) falls back too
  const odd = await loadFormulaLeader(make({ status: 200, body: { ...body, timeS: 2, splits: { sector1: 0.5, sector2: 1, lap: 2 }, ghost: null } }).client, 'discrete', 'manual'); assert.equal(odd.source, 'fallback');
});

test('the made-up leader ghost crosses the gates in order and finishes at the leader lap time', () => {
  const l = fallbackFormulaLeader('discrete'), g = ghostFromRecord(track, { name: l.name, lapTime: l.timeS });
  assert.ok(Math.abs(ghostPose(g, track, g.launchTime + l.timeS).along - track.length) < 2); assert.ok(ghostTimeAt(g, track.length / 2) > g.launchTime);
});
