// The Formula ghost: a compact lap trace, a lap made up from the leader's lap time and splits, and its replay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormulaRace, driveAutopilotLap, createFormulaAutopilot, ghostFromLeader, ghostFromLap, cleanGhost, ghostPose, ghostTimeAt, FORMULA_TRACKS, TRACE, FORMULA_DT } from '../src/formula/index.ts';
import { alongOf } from '../src/formula/road.ts';

const track = FORMULA_TRACKS[0];
const leader = { name: 'class leader', lapTime: 41.25, splits: [6.7, 12.3, 17.9, 23.5, 29.2, 35.2, 41.25], reaction: 0.18 };

test('a ghost made from the leader\'s lap time and splits crosses the start line, every gate and the finish at the leader\'s times', () => {
  const g = ghostFromLeader(track, leader); assert.ok(g); assert.equal(g.lapTime, 41.25); assert.deepEqual(g.splits, leader.splits);
  const at = t => ghostPose(g, track, t);
  assert.ok(Math.abs(at(g.launchTime).along) < 0.6, `at the start line ${at(g.launchTime).along}`);
  track.gates.slice(1).forEach((gate, i) => { const want = alongOf(track.road, gate.i, 0), p = at(g.launchTime + leader.splits[i]); assert.ok(Math.abs(p.along - want) < 1.5, `gate ${i + 1}: ${p.along.toFixed(1)} vs ${want.toFixed(1)}`); });
  assert.ok(Math.abs(at(g.launchTime + 41.25).along - track.length) < 1.5, 'the finish'); assert.ok(at(g.launchTime + 41.3).finished && !at(g.launchTime + 41).finished);
  assert.ok(at(0).along < -3 && at(0).along > -8, 'it starts on the grid, behind the line'); assert.equal(at(0.1).speed, 0, 'and stands still until its reaction');
  for (let i = 1; i < g.trace.s.length; i++) assert.ok(g.trace.s[i] >= g.trace.s[i - 1], 'it never goes backwards');
  const top = Math.max(...g.trace.v) / 10; assert.ok(top > 100 && top < 140, `top speed ${top}`);
});

test('the same record always gives the same ghost, a different one a different ghost, and a record with no splits gets made-up ones that still add up', () => {
  const a = ghostFromLeader(track, leader), b = ghostFromLeader(track, leader); assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.notEqual(JSON.stringify(ghostFromLeader(track, { ...leader, name: 'other' })), JSON.stringify(a));
  const bare = ghostFromLeader(track, { name: 'x', lapTime: 44 }); assert.equal(bare.splits.length, track.gates.length); assert.equal(bare.splits[bare.splits.length - 1], 44);
  for (let i = 1; i < bare.splits.length; i++) assert.ok(bare.splits[i] > bare.splits[i - 1]);
  const first = bare.splits[0], mean = 44 / 7; assert.ok(first > mean * 0.9 && first < mean * 1.3, `the first sector (${first}) is a little longer than average (${mean.toFixed(2)})`);
  assert.equal(ghostFromLeader(track, { name: 'x', lapTime: 1 }), null, 'an impossible lap time makes no ghost'); assert.equal(ghostFromLeader(track, { name: 'x', lapTime: NaN }), null);
  assert.equal(ghostFromLeader(track, { name: 'x', lapTime: 44, splits: [9, 3, 1, 2, 3, 4, 5] }).splits[0] > 0, true, 'splits that go backwards are replaced');
});

test('the trace is compact: whole numbers, a sample every 0.1 s, and a lap is only a few kilobytes of JSON', () => {
  const g = ghostFromLeader(track, leader); assert.equal(g.trace.step, TRACE.step);
  for (const k of ['s', 'o', 'v']) { assert.equal(g.trace[k].length, g.trace.s.length); assert.ok(g.trace[k].every(Number.isInteger), `${k} is whole numbers`); }
  const bytes = JSON.stringify(g).length; assert.ok(bytes < 8000, `${bytes} bytes`); assert.ok(g.trace.s.length < 600);
  assert.ok(Math.max(...g.trace.o.slice(80).map(Math.abs)) <= 10, 'once on the line it stays within a metre of it (decimetres)'); assert.ok(Math.abs(g.trace.o[0]) > 30, 'and it leaves from the grid place, to the side');
});

test('a lap you drove makes a ghost whose replay follows your lap, and racing against it shows a gap near zero', () => {
  const drive = ghost => { const r = createFormulaRace({ ghost }), ap = createFormulaAutopilot(r.track, r.state.car.stats); let worst = 0; while (!r.over) { r.step(ap.decide(r.view())); const v = r.view(); if (v.ghostDelta !== null) worst = Math.max(worst, Math.abs(v.ghostDelta)); } return { r, worst }; };
  const first = drive(null).r, slip = first.timeslip(), ghost = ghostFromLap(track, slip, first.trace(), 'me');
  assert.ok(ghost); assert.equal(ghost.lapTime, slip.lapTime); assert.deepEqual(ghost.splits, slip.splits); assert.equal(ghost.name, 'ME');
  const pose = ghostPose(ghost, track, 20), car = first.state; assert.ok(Number.isFinite(pose.x) && Number.isFinite(pose.y));
  const { r, worst } = drive(ghost); assert.ok(worst < 0.15, `the gap to its own lap stays under 0.15 s (worst ${worst})`); assert.equal(r.timeslip().lapTime, slip.lapTime, 'and racing a ghost does not change the lap');
  assert.ok(Math.abs(ghostTimeAt(ghost, 1000) - ghostTimeAt(ghost, 999)) < 0.2); void car;
  assert.equal(ghostFromLap(track, { ...slip, valid: false }, first.trace(), 'x'), null, 'a jump start or unfinished lap makes no ghost');
});

test('the ghost is placed on the track and ahead or behind is a time: a slower lap shows a positive gap', () => {
  const slow = ghostFromLeader(track, { name: 's', lapTime: 60 }), fast = ghostFromLeader(track, { name: 'f', lapTime: 32 });
  const gap = ghost => { const r = createFormulaRace({ ghost }), ap = createFormulaAutopilot(r.track, r.state.car.stats); let last = null; for (let i = 0; i < 1500; i++) { r.step(ap.decide(r.view())); const d = r.view().ghostDelta; if (d !== null) last = d; } return last; };
  assert.ok(gap(slow) < -3, `ahead of a 60 s ghost: ${gap(slow)}`); assert.ok(gap(fast) > 1.5, `behind a 32 s ghost: ${gap(fast)}`);
  const view = createFormulaRace({ ghost: slow }).view(); assert.ok(view.ghost && Math.abs(view.ghost.x - track.grid.x) < 2 && Math.abs(view.ghost.y - track.grid.y) < 2, 'it starts on the grid');
  assert.equal(createFormulaRace({ ghost: { ...slow, trackId: 'elsewhere' } }).view().ghost, null, 'a ghost of another track is ignored');
});

test('a ghost from the outside is made safe or refused', () => {
  const good = ghostFromLeader(track, leader);
  assert.equal(cleanGhost(null), null); assert.equal(cleanGhost('x'), null); assert.equal(cleanGhost({}), null);
  assert.equal(cleanGhost({ ...good, lapTime: -5 }), null); assert.equal(cleanGhost({ ...good, lapTime: 1e9 }), null); assert.equal(cleanGhost({ ...good, trace: { ...good.trace, step: 0 } }), null);
  assert.equal(cleanGhost({ ...good, trace: { ...good.trace, o: [1, 2] } }), null, 'arrays of different lengths');
  assert.equal(cleanGhost({ ...good, trace: { ...good.trace, s: good.trace.s.map(() => 'x') } }), null);
  assert.equal(cleanGhost({ ...good, trace: { ...good.trace, s: new Array(100000).fill(0), o: new Array(100000).fill(0), v: new Array(100000).fill(0) } }), null, 'too long');
  const rough = cleanGhost({ ...good, name: 'a<script>\u0001 name that is much too long', trace: { ...good.trace, v: good.trace.v.map(() => 1e12), s: good.trace.s.map((s, i) => (i === 5 ? -999 : s)) } });
  assert.ok(rough.name.length <= 20 && /^[ -~]+$/.test(rough.name)); assert.ok(rough.trace.v.every(v => v <= 20000)); assert.ok(rough.trace.s.every((s, i) => i === 0 || s >= rough.trace.s[i - 1]), 'the along distance never falls');
  assert.deepEqual(cleanGhost(JSON.parse(JSON.stringify(good))), good, 'a good ghost survives saving and loading unchanged');
});
void driveAutopilotLap; void FORMULA_DT;
