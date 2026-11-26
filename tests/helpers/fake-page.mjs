// Runs the BUILT page (dist/gpuwars.js) against a fake DOM and drives its menus with keys, then prints what happened as one JSON line. It cannot judge looks or feel (that needs a browser), but it proves the bundle loads, the
// title menu switches modes, the Formula tune screen, a test lap, the timeslip, records and the leaderboard screen open, a ranked lap runs, and Drag still starts a race. Used by tests/page-smoke.test.mjs (its own process, so the fake globals never leak).
import { readFileSync } from 'node:fs';
const listeners = {}, els = {}, log = {}, errors = [];
const ctx = new Proxy({}, { get: (t, k) => { if (k === 'measureText') return s => ({ width: String(s).length * 7 }); if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} }); if (k in t) return t[k]; return () => {}; }, set: (t, k, v) => { t[k] = v; return true; } });
const mk = () => new Proxy(function () {}, {
  get(t, k) {
    if (k in t && k !== 'name' && k !== 'length') return t[k];
    if (k === 'style') return t.style ??= {}; if (k === 'dataset') return t.dataset ??= {};
    if (k === 'classList') return { toggle() {}, contains() { return false; }, add() {}, remove() {} };
    if (k === 'querySelector') return () => null; if (k === 'querySelectorAll') return () => [];
    if (k === 'appendChild' || k === 'addEventListener' || k === 'scrollIntoView' || k === 'removeEventListener' || k === 'setPointerCapture') return () => {};
    if (k === 'getBoundingClientRect') return () => ({ left: 0, top: 0, width: 800, height: 450 }); if (k === 'getContext') return () => ctx;
    if (k === 'clientWidth' || k === 'offsetHeight' || k === 'scrollTop') return 100; if (k === Symbol.toPrimitive) return () => ''; return t[k];
  }, set(t, k, v) { t[k] = v; return true; }, apply() { return undefined; },
});
globalThis.document = { getElementById: id => (els[id] ??= mk()), querySelector: () => (els.card ??= mk()), createElement: () => mk(), addEventListener() {}, fullscreenElement: null, body: mk() };
globalThis.window = globalThis; globalThis.addEventListener = (t, f) => { (listeners[t] ??= []).push(f); }; globalThis.innerWidth = 1280; globalThis.innerHeight = 720; globalThis.devicePixelRatio = 1;
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [], userAgent: 'node', maxTouchPoints: 0 }, configurable: true });
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} }); globalThis.Audio = class { play() { return Promise.resolve(); } pause() {} addEventListener() {} };
globalThis.fetch = async () => { throw new Error('offline'); }; let raf = null; globalThis.requestAnimationFrame = f => { raf = f; }; globalThis.localStorage = undefined; globalThis.screen = {};
process.on('uncaughtException', e => errors.push(String(e.stack ?? e).slice(0, 500))); process.on('unhandledRejection', e => errors.push(String(e).slice(0, 500)));
(0, eval)(readFileSync(new URL('../../dist/gpuwars.js', import.meta.url), 'utf8'));
const key = k => { for (const f of listeners.keydown ?? []) f({ key: k, timeStamp: performance.now(), preventDefault() {}, repeat: false }); };
let t = 1000; const frames = n => { for (let i = 0; i < n; i++) { t += 16.7; const f = raf; raf = null; f?.(t); } };
const snap = () => globalThis.window.__drag(), cur = () => snap().menu?.sel;
const goto = id => { for (let n = 0; n < 40 && cur() !== id; n++) key('arrowdown'); return cur() === id; };
const untilOver = max => { let n = 0; while (snap().screen === 'race' && n++ < max) frames(1); return snap().screen; };
frames(3); log.title = { screen: snap().screen, mode: snap().mode, items: snap().menu.items };
goto('mode'); key('arrowright'); frames(2); log.formulaMode = snap().mode;
goto('driver'); key('arrowright'); log.driver = snap().driver;
goto('tune'); key('Enter'); frames(2); log.tune = { screen: snap().screen, items: snap().menu.items, title: String(els.title.textContent) };
key('Enter'); frames(2); log.stats = { tab: snap().tuneTab, html: String(els.extra.innerHTML) }; key('Enter'); frames(2);
goto('gearing'); key('arrowright'); frames(1);
goto('test'); key('Enter'); frames(2); log.raceScreen = snap().screen; log.testLap = { end: untilOver(20000), result: snap().formula, slip: String(els.extra.innerHTML), title: String(els.title.textContent) };
key('Escape'); frames(2); key('Escape'); frames(2);
goto('records'); key('Enter'); frames(2); log.records = { screen: snap().screen, html: String(els.extra.innerHTML) };
key('Escape'); frames(1); goto('leaderboard'); key('Enter'); frames(3); log.board = { screen: snap().screen, head: String(els.lbhead.textContent), cols: String(els.lbscroll.innerHTML), items: snap().menu.items }; key('m'); frames(2); log.boardDrag = { head: String(els.lbhead.textContent), cols: String(els.lbscroll.innerHTML) }; key('m'); frames(2);
key('Escape'); frames(1); goto('race'); key('Enter'); frames(2); log.ranked = { end: untilOver(20000), result: snap().formula };
key('Escape'); frames(1); key('Escape'); frames(2);
goto('mode'); key('arrowleft'); frames(1); log.dragMode = snap().mode;
goto('driver'); key('arrowright'); goto('race'); key('Enter'); frames(2); log.dragRace = { screen: snap().screen, mode: snap().mode, stillRacing: untilOver(600) === 'race' };
log.errors = errors; console.log('RESULT ' + JSON.stringify(log)); process.exit(0);
