// The shape of the standalone game: one itch.io-friendly index.html, a title menu with the GPU Wars rows, and nothing left over from Chromium Halo: Neon's hub, shop, 3D view or other games.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createBrowserStore, memoryStore } from '../src/browser-store.ts';
import { DEFAULT_BINDS, BIND_ROWS, assignKey, sanitizeOptions } from '../src/options/model.ts';
import { tuneHint, TUNE_HINTS } from '../src/drag/tune-help.ts';
import { SONG } from '../src/sound.ts';
import { PALETTE } from '../src/benchmark/workload.ts';
import { NO_BEAT } from '../src/beat/clock.ts';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const walk = dir => readdirSync(new URL('../' + dir, import.meta.url)).flatMap(f => { const p = dir + '/' + f; return statSync(new URL('../' + p, import.meta.url)).isDirectory() ? walk(p) : [p]; });

test('index.html is the one itch.io page: relative paths, no external requests, one bundle', () => {
  const html = read('index.html');
  assert.ok(!/https?:\/\//.test(html), 'no external requests at load');
  assert.ok(!/(src|href)="\//.test(html), 'no absolute paths');
  assert.deepEqual([...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]), ['dist/gpuwars.js'], 'one script, by a relative path');
  assert.match(html, /<title>GPU Wars<\/title>/); assert.match(html, /touch-action: none/, 'the canvas is ready for touch');
  assert.ok(/<p class="hint" id="hint"><\/p>/.test(html), 'the card has a hint line');
  assert.ok(existsSync(new URL('../dist/gpuwars.js', import.meta.url)), 'npm test builds first');
});

test('the menu card is compact and redraws keep their scroll position instead of snapping', () => {
  const html = read('index.html'), page = read('src/drag/page.ts');
  assert.match(html, /\.card \{[^}]*padding: 16px 20px/, 'the card has a small frame');
  assert.match(html, /\.opt \{[^}]*padding: 4px 10px[^}]*margin: 2px 0[^}]*scroll-margin: 8px 0/, 'rows are short and leave room when scrolled to');
  assert.match(html, /\.dyno \{[^}]*max-width: 420px/, 'the dyno does not stretch the stats tab');
  assert.match(page, /function render\(keepVisible = false\): void/, 'redraws do not scroll by default');
  assert.match(page, /card\.scrollTop = 0/, 'a new screen starts at the top');
  assert.match(page, /if \(menu && menu\.key\(k\)\) render\(true\)/, 'only key or pad moves reveal the selected row');
  assert.doesNotMatch(page, /rows\.appendChild\(e\); if \(i === m\.sel\) e\.scrollIntoView/, 'the list is complete before it scrolls');
});

test('the title menu is BENCHMARK, CLASS, TUNE, RACE CLASS LEADER, DRIVER, RECORDS, OPTIONS, and every row is a real row', () => {
  const page = read('src/drag/page.ts'), start = page.indexOf("title('GPU WARS')"), block = page.slice(start, page.indexOf('], sel.title', start));
  const order = ['benchmarkItem(', 'classItem(', "id: 'tune'", 'raceItem()', "id: 'records'", "'options'"].map(k => block.indexOf(k));
  assert.ok(order.every(i => i >= 0) && order.every((i, n) => n === 0 || i > order[n - 1]), 'the rows are there, in order');
  assert.ok(page.includes("label: 'RACE CLASS LEADER'") && block.includes("label: 'RECORDS'") && block.includes("'OPTIONS'"));
  assert.ok(block.includes('benchmarkItem(') && block.includes('classItem('), 'the BENCHMARK and CLASS rows are real rows now');
  assert.ok(block.includes("id: 'options'") && block.includes('driverItem()'), 'OPTIONS and DRIVER are built');
});

test('the tune screen keeps its TUNING and STATS tabs and every number row has a description', () => {
  const page = read('src/drag/page.ts');
  assert.ok(page.includes("data-tab=\"tuning\"") && page.includes("data-tab=\"stats\""));
  const start = page.indexOf('function tuneItems()'), tune = page.slice(start, page.indexOf('\n}', start));
  for (const [, id] of tune.matchAll(/\bnum\('([^']+)'/g)) assert.ok(tuneHint(id).length > 30, `${id} has a description`);
  for (const id of Object.keys(TUNE_HINTS)) assert.ok(tuneHint(id).length > 20, id);
  assert.doesNotMatch(Object.values(TUNE_HINTS).join(' '), /CLUTCH action|points|shop/i, 'no hint talks about a clutch key, points or a shop');
});

test('the game plays only music, and has no 3D, hub, shop, rivals, points or profile left in it', () => {
  const banned = /from 'three'|view3d|hub-return|CITY_URL|buyPart|loadProfile|sim\/profile|rivals\//;
  for (const f of walk('src').filter(f => f.endsWith('.ts'))) assert.doesNotMatch(read(f), banned, `${f} has nothing from the removed parts`);
  for (const f of ['physics', 'tune', 'model', 'types', 'data']) assert.doesNotMatch(read(`src/drag/${f}.ts`), /Math\.random/, `src/drag/${f}.ts: no Math.random in the simulation`);
  assert.doesNotMatch(read('src/sound.ts'), /assets\/audio|play\(name/, 'no sound effect files');
  assert.ok(!existsSync(new URL('../src/drag/view3d.ts', import.meta.url)) && !existsSync(new URL('../assets/audio', import.meta.url)));
});

test('the only song is Simulation Theory by Chromium Halo (not the remix), used by the benchmark only, with no equalizer', () => {
  const files = readdirSync(new URL('../assets/music/', import.meta.url)).sort();
  assert.deepEqual(files, ['analysis.json', 'simulation-theory.ogg']);
  const analysis = JSON.parse(read('assets/music/analysis.json')); assert.deepEqual(Object.keys(analysis.tracks), ['simulation-theory']); assert.equal(analysis.tracks['simulation-theory'].eq, undefined, 'no equalizer data');
  assert.ok(SONG.id in analysis.tracks && SONG.file === 'simulation-theory.ogg' && SONG.title === 'Simulation Theory' && SONG.artist === 'Chromium Halo');
  const page = read('src/drag/page.ts');
  assert.equal(page.split('startMusic()').length - 1, 1, 'music starts in one place: the benchmark'); assert.doesNotMatch(page, /onFirstGesture\([^)]*startMusic/, 'the first key press or tap does not start music (only sound effects unlock)');
  assert.ok(!existsSync(new URL('../src/beat/eq.ts', import.meta.url)) && !existsSync(new URL('../src/neon/building-eq.ts', import.meta.url)));
  for (const f of walk('src').filter(f => f.endsWith('.ts'))) assert.doesNotMatch(read(f), /building-eq|eqNow|library\.json|vipers/i, f);
});

test('the benchmark screen shows the song and band top-left and draws in the game palette with no equalizer', () => {
  const screen = read('src/benchmark/screen.ts'), workload = read('src/benchmark/workload.ts');
  assert.match(screen, /#bm-song\{position:absolute;top:calc\(22px/); assert.match(screen, /#bm-title\{[^}]*#21e6ff[^}]*font-size:clamp\(28px/); assert.match(screen, /#bm-band\{[^}]*#ff2bd6/); assert.match(screen, /SONG\.title/); assert.match(screen, /SONG\.artist/);
  assert.deepEqual(PALETTE.magenta.map(v => Math.round(v * 255)), [255, 43, 214]); assert.deepEqual(PALETTE.cyan.map(v => Math.round(v * 255)), [33, 230, 255]); assert.deepEqual(PALETTE.background.map(v => Math.round(v * 255)), [5, 1, 15]);
  assert.doesNotMatch(workload, /uBars|uPeaks|EQ_BANDS/);
  assert.equal(NO_BEAT.eq, undefined);
});

test('the save store never throws: with no localStorage it keeps things in memory for the visit', () => {
  const s = createBrowserStore(); assert.equal(s.get('x'), null); s.set('x', '1'); assert.equal(s.get('x'), '1'); s.remove('x'); assert.equal(s.get('x'), null);
  const m = memoryStore(); m.set('a', 'b'); assert.equal(m.get('a'), 'b');
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  globalThis.localStorage = broken; try { const t = createBrowserStore(); t.set('k', 'v'); assert.equal(t.get('k'), 'v', 'the memory copy answers when storage is blocked'); t.remove('k'); assert.equal(t.get('k'), null); } finally { delete globalThis.localStorage; }
});

test('the controls: every action in the spec is rebindable, no two actions share a default key, and a key does one thing', () => {
  for (const id of ['gas', 'brake', 'steerLeft', 'steerRight', 'chute', 'shiftUp', 'shiftDown', 'burnout', 'nitro']) assert.ok(id in DEFAULT_BINDS, id);
  assert.ok(!('clutch' in DEFAULT_BINDS) && !Object.keys(DEFAULT_BINDS).some(k => /clutch/i.test(k)), 'there is no clutch button');
  const seen = new Map(); for (const [id, keys] of Object.entries(DEFAULT_BINDS)) for (const k of keys.filter(Boolean)) { assert.ok(!seen.has(k.toLowerCase()), `${k} is used by ${seen.get(k.toLowerCase())} and ${id}`); seen.set(k.toLowerCase(), id); }
  assert.deepEqual(BIND_ROWS.map(r => r[0]).sort(), Object.keys(DEFAULT_BINDS).sort(), 'every action has a row on the options screen');
  const moved = assignKey(DEFAULT_BINDS, 'burnout', 'x'); assert.ok(moved.ok); assert.equal(moved.binds.burnout[0], 'x'); assert.equal(DEFAULT_BINDS.burnout[0], 'j', 'the defaults are left alone');
  assert.equal(assignKey(DEFAULT_BINDS, 'nitro', 'Escape').ok, false);
  assert.deepEqual(sanitizeOptions('junk').binds, DEFAULT_BINDS);
});

test('the screens show density altitude and the hot tire pressure, window.__drag has the stage, and no race against your own pass is left', () => {
  const page = read('src/drag/page.ts'), bench = read('src/benchmark/screen.ts');
  assert.match(page, /\['DENSITY ALT'/, 'the STATS tab shows density altitude'); assert.match(page, /\['TIRES HOT'/, 'the STATS tab shows the hot pressure');
  assert.match(page, /DENSITY ALT \$\{R\.da\} FT/, 'the timeslip shows density altitude'); assert.match(page, /line\('HOT PSI'/, 'the timeslip shows Timeslip.hotPsi');
  assert.match(page, /stage: \(s\.runners\[0\] as Runner\)\.stage/, 'window.__drag reports the staging phase');
  assert.match(bench, /CANNOT SEE AN OVERCLOCK[\s\S]*RUN THE BENCHMARK AGAIN/, 'the benchmark screen says to re-run it by hand after an overclock or a GPU change');
  assert.ok(!/NEW BEST PASS|improved/.test(page), 'no race against your own best pass');
  assert.doesNotMatch(page, /save\.ghost|BEST PASS/);
});

test('the tune screen has a free REPLACE TIRES row beside REPLACE CLUTCH, with help, and the slot rows are at the bottom', () => {
  const page = read('src/drag/page.ts'), tune = page.slice(page.indexOf('function tuneItems()'), page.indexOf('/** the panel above the rows'));
  const at = k => tune.indexOf(k);
  assert.ok(at("id: 'replaceTires'") > at("id: 'replaceClutch'") && at("id: 'replaceTires'") < at("id: 'cool'"), 'REPLACE TIRES follows REPLACE CLUTCH');
  assert.match(tune, /id: 'replaceTires'[^\n]*enter: \(\) => \{ tireWear = \[0, 0\]/, 'it resets both slicks');
  assert.ok(TUNE_HINTS.replaceTires && /free/i.test(TUNE_HINTS.replaceTires), 'with a help text that says it is free');
  assert.match(page, /tireWear = tireWearAfterRun\(me\)/, 'wear carries after a run');
  assert.ok(at('...slotRows(') > at("id: 'reset'") && at('...slotRows(') > at("id: 'nitroGear'") && at('...slotRows(') < at('testItem(),\n    { id: \'back\''), 'the slot controls sit at the bottom, above TEST RUN and BACK');
});

test('every menu is locked to the size it has with its longest description showing', () => {
  const page = read('src/drag/page.ts'), render = page.slice(page.indexOf('function render('), page.indexOf('// ---- the race ----'));
  assert.match(render, /reserveHintSpace\(m\)/, 'render reserves the hint space for every menu');
  assert.match(render, /for \(const it of m\.items\)[^\n]*it\.hint\?\.\(\)[^\n]*offsetHeight/, 'it measures every row\'s description');
  assert.match(render, /el\.style\.minHeight = tallest/, 'and holds the hint line at the tallest');
});

test('EXIT FULLSCREEN is on the title menu only while fullscreen, and the decision is written down', () => {
  const page = read('src/drag/page.ts'), itch = read('docs/ITCH.md');
  assert.match(page, /isFullscreen\(\) \? \[\{ id: 'exit', label: 'EXIT FULLSCREEN'/, 'the row exists only in fullscreen');
  assert.doesNotMatch(page, /window\.close|location\.href\s*=/, 'no attempt to close the page or navigate away');
  assert.match(itch, /Exiting the game/); assert.match(itch, /window\.close/);
});
