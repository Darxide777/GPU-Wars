// A smoke run of the BUILT page in a fake DOM (tests/helpers/fake-page.mjs): both modes start, the Formula screens open and a whole Formula lap runs to its timeslip. Not a replacement for looking at it in a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('the built page loads, switches to FORMULA, tunes, runs a test lap and a ranked lap to the timeslip, and Drag still starts a race', () => {
  const out = execFileSync(process.execPath, ['tests/helpers/fake-page.mjs'], { cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 120000 }), log = JSON.parse(out.split('\n').find(l => l.startsWith('RESULT ')).slice(7));
  assert.deepEqual(log.errors, [], 'no uncaught error'); assert.equal(log.title.screen, 'title'); assert.equal(log.title.mode, 'drag', 'a fresh save starts in DRAG'); assert.equal(log.title.items[0], 'mode', 'MODE is the first row');
  assert.equal(log.formulaMode, 'formula'); assert.equal(log.driver, 'autopilot');
  assert.equal(log.tune.title, 'FORMULA TUNE'); for (const id of ['predicted', 'gearing', 'downforce', 'steering', 'pressure', 'nitro', 'gearbox', 'slotSave', 'test']) assert.ok(log.tune.items.includes(id), id);
  assert.ok(log.tune.items.every(i => i !== 'replaceTires')); assert.match(log.stats.html, /PREDICTED/); assert.equal(log.raceScreen, 'race');
  assert.equal(log.testLap.end, 'slip'); assert.equal(log.testLap.result.valid, true); assert.ok(log.testLap.result.lapTime > 30 && log.testLap.result.lapTime < 70); assert.match(log.testLap.slip, /SECTOR 1/); assert.match(log.testLap.slip, /LAP TIME/);
  assert.equal(log.records.screen, 'records'); assert.match(log.records.html, /YOUR BESTS: FORMULA/); assert.equal(log.board.screen, 'leaderboard'); assert.match(log.board.head, /^FORMULA/);
  assert.equal(log.ranked.end, 'slip'); assert.equal(log.ranked.result.kind, 'ranked');
  assert.equal(log.dragMode, 'drag'); assert.equal(log.dragRace.screen, 'race'); assert.equal(log.dragRace.mode, 'drag'); assert.equal(log.dragRace.stillRacing, true);
});
