// The LEADERBOARD screen: board list, row text, own-row highlight, scrolling, failure texts, the cache, and the client path with a fake fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLASS_IDS } from '../src/classes.ts';
import { createLeaderboardClient } from '../src/leaderboard/client.ts';
import { BOARD_CACHE_MS, boardChoices, createBoardScreen, escapeHtml, failureText, formatRow, isOwnRow, nextCategory, ownRowIndex, scrollKeyRows, scrollTarget, stepIndex } from '../src/leaderboard/board-screen.ts';

const entry = (rank, name, extra = {}) => ({ rank, playerName: name, class: 'discrete', category: 'manual', quarterEt: 5 + rank / 100, trapSpeed: 250.4, benchmarkScore: 9000, verified: false, ...extra });
const wait = () => new Promise(r => setTimeout(r, 0));

test('the board list is OVERALL then every class of the one class list', () => {
  const list = boardChoices();
  assert.deepEqual(list.map(b => b.id), ['overall', ...CLASS_IDS]);
  assert.equal(list[0].scope, 'overall'); assert.ok(list.slice(1).every(b => b.scope === 'class' && b.cls === b.id));
  assert.deepEqual(list.map(b => b.label).slice(0, 3), ['OVERALL', 'INTEGRATED', 'DISCRETE']);
  assert.equal(stepIndex(0, -1, 3), 2); assert.equal(stepIndex(2, 1, 3), 0); assert.equal(stepIndex(0, 1, 0), 0);
  assert.equal(nextCategory('manual'), 'autopilot'); assert.equal(nextCategory('autopilot'), 'manual');
});

test('rows read as rank, name, ET, trap speed and (overall only) class', () => {
  const row = formatRow(entry(3, 'SPEEDY'), true);
  assert.deepEqual(row, { rank: '3', name: 'SPEEDY', et: '5.030 S', trap: '250 MPH', cls: 'DISCRETE' });
  assert.equal(formatRow(entry(3, 'SPEEDY'), false).cls, '');
  assert.equal(formatRow(entry(1, 'X', { class: '' }), true).cls, '');
  assert.equal(escapeHtml('<b>"A"&\'</b>'), '&lt;b&gt;&quot;A&quot;&amp;&#39;&lt;/b&gt;');
});

test('your own row is found by name, ignoring case and spaces at the ends', () => {
  const rows = [entry(1, 'Ann'), entry(2, 'Pilot One'), entry(3, 'Bob')];
  assert.equal(isOwnRow(rows[1], ' pilot one '), true); assert.equal(isOwnRow(rows[0], 'Pilot One'), false);
  assert.equal(ownRowIndex(rows, 'PILOT ONE'), 1); assert.equal(ownRowIndex(rows, 'nobody'), -1);
});

test('scroll keys move by rows and stay inside the list', () => {
  assert.equal(scrollTarget(0, -1, 100, 10), 0, 'not above the top');
  assert.equal(scrollTarget(85, 20, 100, 10), 90, 'the last row can sit at the bottom, no further');
  assert.equal(scrollTarget(0, 5, 3, 10), 0, 'a short list does not scroll');
  assert.equal(scrollKeyRows('arrowdown', 10, 100), 1); assert.equal(scrollKeyRows('arrowup', 10, 100), -1);
  assert.equal(scrollKeyRows('pagedown', 10, 100), 9); assert.equal(scrollKeyRows('pageup', 10, 100), -9);
  assert.equal(scrollKeyRows('home', 10, 100), -100); assert.equal(scrollKeyRows('end', 10, 100), 100); assert.equal(scrollKeyRows('x', 10, 100), 0);
  assert.equal(scrollTarget(0, scrollKeyRows('end', 10, 100), 100, 10), 90);
});

test('each failure kind reads clearly', () => {
  for (const kind of ['not-configured', 'offline', 'rate-limited', 'rejected', 'server']) { const t = failureText({ ok: false, kind, message: 'M' }); assert.ok(t.title.length > 0 && t.detail.length > 0, kind); }
  assert.match(failureText({ ok: false, kind: 'rate-limited', message: '' }).detail, /RETRY/);
  assert.match(failureText({ ok: false, kind: 'offline', message: '' }).title, /OFFLINE/);
});

test('the client path: 100 rows are asked for, parsed, and a 429 is a rate-limit', async () => {
  const urls = [];
  const fetchFn = async url => { urls.push(url); return { ok: true, status: 200, json: async () => ({ entries: [entry(1, 'Ann'), { junk: true }, entry(2, 'Bob')] }) }; };
  const client = createLeaderboardClient({ baseUrl: 'https://x.invalid', clientId: 'abcdefgh12345678', fetchFn });
  const ok = await client.board('class', 'discrete', 'autopilot', 100);
  assert.equal(ok.ok, true); assert.deepEqual(ok.entries.map(e => e.playerName), ['Ann', 'Bob']);
  assert.match(urls[0], /\/leaderboard\?scope=class&category=autopilot&limit=100&class=discrete$/);
  const limited = await createLeaderboardClient({ baseUrl: 'https://x.invalid', clientId: 'abcdefgh12345678', fetchFn: async () => ({ ok: false, status: 429, json: async () => ({}) }) }).board('overall', 'integrated', 'manual', 100);
  assert.equal(limited.kind, 'rate-limited');
});

test('the screen caches boards, flips instantly, marks your row and keeps failures retryable', async () => {
  const calls = []; let clock = 1000, down = false;
  const client = createLeaderboardClient({ baseUrl: 'https://x.invalid', clientId: 'abcdefgh12345678', fetchFn: async url => {
    calls.push(url); if (down) throw new TypeError('offline');
    return { ok: true, status: 200, json: async () => ({ entries: [entry(1, 'Ann'), entry(2, 'Pilot One')] }) };
  } });
  let changes = 0;
  const screen = createBoardScreen({ client, playerName: () => 'pilot one', onChange: () => { changes++; }, now: () => clock });
  assert.equal(screen.view().state, 'loading', 'nothing fetched before the screen asks');
  await screen.load(); await wait();
  let v = screen.view(); assert.equal(v.state, 'ready'); assert.equal(v.ownIndex, 1); assert.equal(v.ownRank, 2);
  assert.equal(calls.length, 1); assert.match(calls[0], /scope=overall&category=manual&limit=100$/);
  screen.step(1); await wait(); assert.equal(calls.length, 2); assert.match(calls[1], /scope=class&category=manual&limit=100&class=integrated/);
  screen.step(-1); await wait(); assert.equal(calls.length, 2, 'back to a cached board: no request'); assert.equal(screen.view().state, 'ready');
  screen.toggleCategory(); await wait(); assert.equal(calls.length, 3); assert.equal(screen.category, 'autopilot');
  clock += BOARD_CACHE_MS + 1; screen.toggleCategory(); await wait(); assert.equal(calls.length, 4, 'a stale board is fetched again');
  screen.refresh(); await wait(); assert.equal(calls.length, 5, 'REFRESH skips the cache');
  down = true; screen.step(1); screen.step(1); await wait();
  v = screen.view(); assert.equal(v.state, 'failed'); assert.equal(v.failure.kind, 'offline'); assert.equal(v.retryable, true);
  down = false; screen.refresh(); await wait(); assert.equal(screen.view().state, 'ready', 'retry works');
  assert.ok(changes > 0);
});

test('without a server address the screen says not connected and offers no retry', async () => {
  const screen = createBoardScreen({ client: createLeaderboardClient({ baseUrl: '', clientId: 'abcdefgh12345678' }), playerName: () => 'x', onChange: () => {} });
  await screen.load(); const v = screen.view();
  assert.equal(v.state, 'failed'); assert.equal(v.failure.kind, 'not-configured'); assert.equal(v.retryable, false);
});

test('the page has the LEADERBOARD row next to RECORDS and a size-locked list', () => {
  const page = readFileSync(new URL('../src/drag/page.ts', import.meta.url), 'utf8'), html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(page, /id: 'records'[^\n]*\n\s*\{ id: 'leaderboard', label: 'LEADERBOARD'/);
  assert.match(page, /WIDE: Screen\[\] = \[[^\]]*'leaderboard'/);
  assert.match(html, /\.lbscroll \{[^}]*height: min\(44vh, 400px\)[^}]*overflow-y: auto/, 'the list scrolls in a box of fixed height');
});
