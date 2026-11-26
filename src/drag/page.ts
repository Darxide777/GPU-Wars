// The GPU Wars page: the title menu (BENCHMARK, CLASS, TUNE, RACE CLASS LEADER, RECORDS, OPTIONS), the tune screen with a predicted timeslip, the top-down race, and the timeslip after it.
// The rules are in model.ts and physics.ts; this file shows them and reads the keys. There is no hub, shop, points, 3D view or other game: only the top-down strip.
// Rows that are not built yet say COMING SOON and say which phase brings them. Everything is drawn on one canvas with the neon menu card over it.
import { loadSave, writeSave, type Save } from '../save.ts';
import { browserStore } from '../browser-store.ts';
import { createSfx } from '../sfx.ts';
import { createMusic } from '../sound.ts';
import { keyLabel, loadOptions, saveOptions } from '../options/model.ts';
import { createRebinder, optionsItems, type Device } from '../options/screen.ts';
import { createInput } from '../input/index.ts';
import { createHaptics } from '../input/haptics.ts';
import { createAutopilot, viewOf, AUTOPILOT_CATEGORY, type Autopilot, type RunCategory } from './autopilot.ts';
import { fullscreenAvailable, isFullscreen, leaveFullscreen, onFirstGesture, toggleFullscreen, watchViewport } from '../platform.ts';
import { createMenu, type Menu, type MenuItem } from '../arena/view/menu.ts';
import { createPadMenu } from '../gamepad.ts';
import { firstPad } from '../arena/view/pad.ts';
import { newSlotState, slotRows } from '../tune-slots-menu.ts';
import { STOCK_CAR } from './spec-source.ts';
import { calibrationLine } from '../benchmark/score.ts';
import { clearSaveSlot, loadFromSlot, readyCar, recordRace, saveToSlot, saveTune, tuneSlots } from './model.ts';
import { DRAG, FUEL, boostLimitOf, clutchAfterRun, tireWearAfterRun, conditionsForSeed, forecastText, createDrag, createDragStrip, clearDragStrip, fuelKg, fuelShareOf, ghostFromRunner, predictDrag, rubberShare, timeslip, type Drag, type Entrant } from './physics.ts';
import { BOOST, defaultTune } from './tune.ts';
import { tuneHint } from './tune-help.ts';
import { drawProgress } from './hud.ts';
import { createDragTopDown } from './topdown.ts';
import { PENDING_GPU, MASKED_NOTE, gpuLine, readGpuIdentity, type GpuIdentity } from '../benchmark/gpu.ts';
import { openBenchmarkScreen, type BenchmarkScreen } from '../benchmark/screen.ts';
import { benchmarkItem, benchmarkLine, classItem, type BenchmarkContext } from '../benchmark/menu.ts';
import { repairBenchmark, resultFromRun } from '../benchmark/rules.ts';
import { dynoPeaks, dynoSvg } from '../benchmark/dyno.ts';
import { createLeaderboardUi } from '../leaderboard/ui.ts';
import { RANKED, densityAltitudeFt, rankedStart, rankedStrip } from '../leaderboard/ranked.ts';
import { deltaRowsHtml, markDeltas } from '../leaderboard/delta.ts';
import { classLabel } from '../classes.ts';
import type { DragGhost, DragRaceKind, DragSpec, Runner, Timeslip, Tune } from './types.ts';

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const cv = $('cv') as HTMLCanvasElement, ctx = cv.getContext('2d') as CanvasRenderingContext2D, card = document.querySelector('.card') as HTMLElement;
const options = loadOptions(browserStore);      // (changed in place by the OPTIONS screen: always read `options.binds`, never keep a copy)
const music = createMusic({ music: options.music });
const sfx = createSfx(options);

// ---- the save (kept in the browser when it can be; in memory when the page is in a blocked iframe) ----
let save: Save = loadSave(browserStore);
const commit = (next: Save): void => { save = next; writeSave(browserStore, save); };

// ---- what lasts for this visit only: clutch and tire wear, the fuel load and the engine heat carry between races until you reset them ----
let clutchCondition = 1, tireWear: [number, number] = [0, 0], fuelLoad: number = FUEL.capacity, engineTemp: number | null = null;
const fuelOf = (): number => (Number.isFinite(fuelLoad) ? Math.max(FUEL.reserve, Math.min(FUEL.capacity, fuelLoad)) : FUEL.capacity);
const engineOf = (): number => engineTemp ?? conditionsForSeed(raceSeed).airC;

// ---- numbers ----
const freshSeed = (): number => Math.floor(Math.random() * 1e9);      // (a seed for the weather and the tree: the simulation itself never calls Math.random)
let raceSeed = freshSeed();
const strip = createDragStrip(2);
const sec = (v: number | undefined | null): string => (v === undefined || v === null ? '-' : v.toFixed(3));
const kmh = (v: number | undefined): string => (v === undefined ? '-' : `${Math.round(v)} KM/H`);
const spinCell = (s: Timeslip): string => (s.spin === undefined ? '-' : `${s.spin.toFixed(2)} S`);
const brakeCell = (s: Timeslip): string => (s.brakeTemp === undefined || s.brakeFade === undefined ? '-' : `${Math.round(s.brakeTemp)}C ${Math.round(s.brakeFade * 100)}%`);
const chuteCell = (s: Timeslip): string => (s.chuteOpen === undefined ? '-' : `${Math.round(s.chuteOpen * 100)}%`);
const rearCell = (s: Timeslip): string => (s.rearShare === undefined ? '-' : `${Math.round(s.rearShare * 100)}%`);
const fuelCell = (s: Timeslip): string => (s.fuelLeft === undefined ? '-' : `${Math.round(s.fuelLeft)} KG LEFT  ${(Math.round((s.fuelUsed ?? 0) * 10) / 10).toFixed(1)} USED`);
/** the top speed in each gear at the limiter, km/h */
const gearTops = (spec: DragSpec, tune: Tune): number[] => tune.ratios.map(r => spec.redline / (r * tune.final * 60 / (2 * Math.PI)) * spec.tire * 3.6);
interface Prediction { slip: Timeslip; spin: number; withoutNitro?: Timeslip; nitroDelta?: number }
const predictions = new Map<string, Prediction>();
/** the run a perfect driver makes with this car and tune (the launch a hair after green, every shift on the tune's shift point) */
function predict(spec: DragSpec, tune: Tune, seed = raceSeed, kg = fuelOf(), temp = engineOf()): Prediction {
  const key = JSON.stringify([spec, tune, seed, kg, temp, strip.version]), hit = predictions.get(key); if (hit) return hit;
  const p = predictDrag(spec, tune, seed, undefined, kg, temp, strip), out = { slip: p.slip, spin: p.spin, withoutNitro: p.withoutNitro, nitroDelta: p.nitroDelta }; if (predictions.size > 200) predictions.clear(); predictions.set(key, out); return out;
}
// ---- the leaderboard: your class, the class leader's ghost, ranked runs and the boards (all in src/leaderboard/; offline it uses a bundled leader time) ----
const lb = createLeaderboardUi({ store: browserStore, benchmark: () => save.benchmark, onChange: () => {
  if (screen === 'race') return;
  const status = document.getElementById('lbstatus'), boardBox = document.getElementById('lbboard'); if (status) status.textContent = lb.status; if (boardBox) boardBox.innerHTML = lb.boardHtml();
  if (isBackdrop) backdrop(); if (menu && screen !== 'name') render();
} });
/** the leader is fetched after your first key or tap (never at load: itch.io pages make no request on start), and again each time the title menu opens */
let touchedPage = false;
const askLeader = (): void => { touchedPage = true; void lb.refreshLeader(); };
addEventListener('keydown', askLeader, { once: true }); addEventListener('pointerdown', askLeader, { once: true });
/** THE GHOST YOU RACE: a simulated ghost of your class leader (built from their ET, splits, trap speed and seed; checked with cleanDragGhost), never your own pass */
const ghostToRace = (): DragGhost | null => lb.ghost();
const ghostEntrant = (g: DragGhost): Entrant => {
  const { spec, tune } = readyCar(save, clutchCondition);
  return { name: g.name || 'CLASS LEADER', spec: { ...spec, col: '#bdf7ff', trim: '#ffffff' }, tune, ghost: g };
};
const fuelItem = (): MenuItem => {
  const at = (): number => { const share = fuelShareOf(fuelOf()), i = FUEL.loads.findIndex(v => Math.abs(v - share) < 0.01); return i < 0 ? FUEL.loads.length - 1 : i; };
  const set = (d: number): void => { fuelLoad = fuelKg(FUEL.loads[Math.max(0, Math.min(FUEL.loads.length - 1, at() + d))] as number); };
  return { id: 'fuel', label: 'FUEL LOAD', value: () => `${Math.round(fuelOf())} KG ${Math.round(fuelShareOf(fuelOf()) * 100)}%`, hint: () => tuneHint('fuel'), left: () => set(-1), right: () => set(1) };
};
/** you, on the line: the stock car with the benchmark's numbers, your tune, and the clutch, tires, fuel and engine heat you carry from the last race */
const myEntrant = (): Entrant => { const { spec, tune } = readyCar(save, clutchCondition); return { name: 'YOU', spec, tune, ai: null, clutchCondition, tireWear, fuel: fuelOf(), engineTemp: engineOf() }; };
/** you for a ranked run: the same start for everyone (new clutch, full tank, cool engine) whatever you did earlier in the visit */
const rankedEntrant = (): Entrant => { const start = rankedStart(), { spec, tune } = readyCar(save, start.clutchCondition); return { name: 'YOU', spec, tune, ai: null, ...start }; };

// ---- the graphics card and the benchmark (rules: src/benchmark/rules.ts) ----
let gpu: GpuIdentity = PENDING_GPU;
let benchScreen: BenchmarkScreen | null = null;
const benchContext: BenchmarkContext = {
  save: () => save, gpu: () => gpu, say: text => { msg = text; }, refresh: () => { if (screen === 'title') render(); },
  start: (cls, masked) => { show('bench'); music.stopMusic(); music.startMusic(); benchScreen = openBenchmarkScreen({ cls, masked, playing: () => music.nowPlaying(), onFinish: r => finishBenchmark(r) }); },
};
function finishBenchmark(r: Parameters<Parameters<typeof openBenchmarkScreen>[0]['onFinish']>[0]): void {
  benchScreen?.close(); benchScreen = null; music.stopMusic();
  if (r.status === 'done') {
    commit({ ...save, benchmark: resultFromRun({ score: r.outcome.score, sustain: r.outcome.sustain, cls: r.outcome.cls, gpuId: gpu.gpuId, now: Date.now(), classFromSpeed: r.outcome.classFromSpeed }) });
    const spec = readyCar(save).spec, peaks = dynoPeaks(spec), cls = r.outcome.cls, line = calibrationLine(r.outcome, cls);
    console.log(`[GPU Wars benchmark] ${line} | ${gpuLine(gpu, cls)}`);
    soon = { title: 'BENCHMARK DONE', help: `SCORE ${r.outcome.score} (RAW ${r.outcome.rawScore})${r.outcome.capped ? ' (CAPPED FOR YOUR CLASS)' : ''}`, text: `${gpuLine(gpu, cls)}.${gpu.masked ? ' ' + MASKED_NOTE + '.' : ''} ${line}. Your car now makes ${Math.round(peaks.hp)} hp at ${peaks.hpRpm} rpm and ${Math.round(peaks.torqueNm)} Nm of torque. ${r.outcome.discarded.length ? `${r.outcome.discarded.length} unsteady pass(es) were thrown away. ` : ''}Drawn with ${r.outcome.backend}. The game cannot see an overclock: run the benchmark again yourself after overclocking or changing your GPU.` };
    show('soon');
  } else if (r.status === 'failed') { soon = { title: 'BENCHMARK FAILED', help: 'NOT SCORED', text: `${r.reason}. Nothing was saved. Run it again from the BENCHMARK row.` }; show('soon'); }
  else show('title');
}
void readGpuIdentity().then(g => {
  gpu = g; console.log(`[GPU Wars] ${gpuLine(g)}`);
  // a result from an older build (a hand-picked class) or from another class is thrown away: the car is stock until the benchmark is run again in the detected class
  const repaired = repairBenchmark(save, g); if (repaired) { commit(repaired); msg = `YOUR SAVED BENCHMARK WAS FOR ANOTHER CLASS. YOUR CLASS IS ${classLabel(g.gpuClass)}: RUN THE BENCHMARK AGAIN`; }
  if (screen === 'title') show('title');
});

// ---- the screens ----
type Screen = 'title' | 'soon' | 'bench' | 'records' | 'name' | 'tune' | 'options' | 'race' | 'slip';
type TuneTab = 'tuning' | 'stats';
let screenBefore: Screen = 'title', screen: Screen = 'title', menu: Menu | null = null, msg = '', raceKind: DragRaceKind = 'solo', sel: Record<string, number> = {}, tuneTab: TuneTab = 'tuning';
let soon: { title: string; text: string; help?: string } = { title: '', text: '' };
let race: Drag = createDrag({ seed: raceSeed, strip, entrants: [myEntrant(), ...ghostList()] }), banked = true, overT = 0, acc = 0;
let result: { category: RunCategory; won: boolean; crashed: boolean; records: string[]; slips: Timeslip[]; reason: string; winner: number; kind: DragRaceKind; hp: number[]; da: number } | null = null;
function ghostList(): Entrant[] { const g = ghostToRace(); return g ? [ghostEntrant(g)] : []; }
const WIDE: Screen[] = ['tune', 'slip', 'records', 'options'];
const setTuneTab = (tab: TuneTab): void => { if (tuneTab === tab) return; tuneTab = tab; show('tune'); };

function statsTable(spec: DragSpec, tune: Tune, seed = raceSeed, kg = fuelOf()): string {
  const temp = engineOf(), p = predict(spec, tune, seed, kg, temp), s = p.slip, tops = gearTops(spec, tune).map(v => Math.round(v)).join(' / ');
  const rows: [string, string][] = [['WEIGHT', `${Math.round(spec.mass)} KG`], ['FUEL LOAD', `${Math.round(kg)} KG ${Math.round(fuelShareOf(kg) * 100)}%`], ['ENGINE START', `${Math.round(temp)}C`], ['DENSITY ALT', `${densityAltitudeFt(conditionsForSeed(seed))} FT  (THIN AIR COSTS POWER)`], ['TIRES HOT', `${(s.hotPsi ?? tune.pressure).toFixed(1)} PSI HOT FROM ${Math.round(tune.pressure)} COLD`], ['TORQUE', `${Math.round(spec.torque)} NM @ ${spec.peakRpm}`], ['POWER', `${Math.round(dynoPeaks(spec).hp)} HP @ ${dynoPeaks(spec).hpRpm}`], ['LIMITER', `${spec.redline} RPM`], ['GEARS', `${tune.ratios.length}  (SHIFT ${spec.shiftTime.toFixed(2)} S)`], ['BOOST', spec.boostCap > 0 ? `${Math.round(boostLimitOf(tune) * 100)}% OF +${Math.round(spec.boostCap * 100)}%` : 'NONE'], ['CLUTCH BITE', `${tune.launchAggression}/10`], ['CLUTCH CONDITION', `${Math.round(spec.clutchCondition * 100)}%`], ['GRIP', spec.grip.toFixed(2)], ['CONDITIONS', forecastText(conditionsForSeed(seed))], ['NITRO', spec.nitroSecs > 0 ? `${spec.nitroSecs} S, UP TO ${Math.round(spec.nitroMax * 100)}%` : 'NONE'], ['TOP OF EACH GEAR', tops]];
  const pred: [string, string][] = [['60 FT', sec(s.ft60)], ['330 FT', sec(s.ft330)], ['1/8 MILE', sec(s.eighth)], ['1000 FT', sec(s.ft1000)], ['1/4 MILE', sec(s.quarter)], ['TRAP', kmh(s.trap)], ['BOOST PEAK', s.boostPeak !== undefined ? `${Math.round(s.boostPeak * 100)}%` : '-'], ['ENGINE PEAK', s.enginePeakTemp !== undefined ? `${Math.round(s.enginePeakTemp)}C  -${Math.round((s.peakRetard ?? 0) * 100)}% TIMING` : '-'], ['SPIN', spinCell(s)], ['TIRE WEAR', s.tireWearL !== undefined && s.tireWearR !== undefined ? `L${Math.round(s.tireWearL * 100)}% R${Math.round(s.tireWearR * 100)}%` : '-'], ['NITRO SHOT', s.nitroUsed ? `${s.nitroUsed.toFixed(2)} S  +${Math.round((s.nitroPeakGain ?? 0) * 100)}% PEAK` : '-'], ['NITRO DELTA', spec.nitroSecs > 0 && p.nitroDelta !== undefined ? `${p.nitroDelta >= 0 ? '+' : ''}${p.nitroDelta.toFixed(3)} S WITH BOTTLE` : '-'], ['FUEL LEFT', fuelCell(s)], ['REAR WEIGHT', rearCell(s)], ['BRAKE', brakeCell(s)], ['CHUTE', chuteCell(s)]];
  const t = (title: string, r: [string, string][]): string => `<table><tr><th>${title}</th><th></th></tr>${r.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`;
  return `${dynoSvg(spec, tune.shiftRpm)}<div class="slips">${t(spec.name, rows)}${t('PREDICTED: PERFECT R/T, AUTO SHIFTS, WARM TIRES, NO BURNOUT, START ENGINE HEAT, AUTO RUN-OUT, SESSION RUBBER', pred)}</div>`;
}
let backFrom: Partial<Record<Screen, Screen>> = {}, isBackdrop = true, backdropKey = '';
/** behind the menus: your car and the ghost on the line */
function backdrop(): void {
  const g = ghostToRace(), key = `${g?.total ?? 0}|${g?.marks.quarter ?? 0}|${raceSeed}|${clutchCondition}|${tireWear.join(',')}|${fuelOf()}|${engineOf()}|${JSON.stringify(save.tune)}|${save.benchmark?.score ?? 0}`; if (isBackdrop && key === backdropKey) return;
  race = createDrag({ seed: raceSeed, strip, entrants: [myEntrant(), ...ghostList()] }); isBackdrop = true; backdropKey = key;
}
const raceItem = (): MenuItem => ({ id: 'race', label: 'RACE CLASS LEADER', value: () => `${sec(lb.leader().splits.quarter)} S TO BEAT`, hint: () => `Ranked run in ${lb.className()} against ${lb.leader().name}${lb.leader().source === 'fallback' ? ' (a bundled time: no leader online yet)' : ''}. Everyone races the same class day: ${RANKED.rubberPolicy}. ${lb.leaderNote()}`, enter: () => { startRace(ghostToRace() ? 'ghost' : 'solo'); } });
/** DRIVER: MANUAL / AUTOPILOT (also in OPTIONS). Autopilot runs are their own leaderboard category. */
const driverItem = (): MenuItem => { const flip = (): void => { options.driver = options.driver === 'manual' ? 'autopilot' : 'manual'; saveOptions(browserStore, options); show('title'); }; return { id: 'driver', label: 'DRIVER', value: () => (options.driver === 'autopilot' ? 'AUTOPILOT' : 'MANUAL'), hint: () => 'MANUAL: you drive. AUTOPILOT: the car drives itself with the same controls. Autopilot runs count in their own leaderboard category and do not touch your manual records.', left: flip, right: flip, enter: flip }; };
const optionsDevice = { v: 'keyboard' as Device, get(): Device { return this.v; }, set(d: Device): void { this.v = d; } };
const optionsHost = { options, save: () => saveOptions(browserStore, options), apply: (what: string): void => { if (what === 'music') music.volumesChanged(); else if (what === 'sfx') sfx.volumesChanged(); }, say: (text: string): void => { msg = text; }, refresh: (): void => { render(); }, fullscreen: toggleFullscreen, back: (): void => show('title') };
const rebinder = createRebinder(optionsHost);
/** A web page cannot close itself, so the only exit that means anything is leaving fullscreen: the row exists only while the page is fullscreen (docs/ITCH.md, "Exiting the game"). */
const exitRows = (): MenuItem[] => (isFullscreen() ? [{ id: 'exit', label: 'EXIT FULLSCREEN', hint: () => 'Leave fullscreen and stay on this menu. A web page cannot close itself: to quit, close the browser tab.', enter: () => { leaveFullscreen(); msg = 'LEFT FULLSCREEN. TO QUIT, CLOSE THIS TAB'; render(); } }] : []);
document.addEventListener('fullscreenchange', () => { if (screen === 'title') show('title'); });
document.addEventListener('webkitfullscreenchange', () => { if (screen === 'title') show('title'); });
function show(next: Screen): void {
  const prev = screen; screen = next; menu = null; const scr = $('screen'); if (prev !== next) msg = '';
  if (next === 'tune' && prev !== next && prev !== 'race') backFrom[next] = prev;
  if (next !== 'race' && next !== 'slip') backdrop();
  if (next === 'race' || next === 'bench') { scr.style.display = 'none'; return; }
  scr.style.display = 'flex'; card.classList.toggle('wide', WIDE.includes(next)); $('rows').className = next === 'tune' || next === 'options' ? 'rows-grid' : ''; $('extra').innerHTML = ''; card.scrollTop = 0;
  const title = (t: string, col = '#ff2bd6'): void => { $('title').textContent = t; $('title').style.color = col; };
  if (next === 'title') {
    title('GPU WARS'); syncCategory(); if (touchedPage) void lb.refreshLeader();
    menu = createMenu([
      benchmarkItem(benchContext),
      classItem(benchContext),
      { id: 'tune', label: 'TUNE', hint: () => 'Set up the car: gearing, launch, boost, nitro and more. Your tune is kept on this computer.', enter: () => show('tune') },
      raceItem(), driverItem(),
      { id: 'records', label: 'RECORDS', hint: () => 'Your own best times on this computer.', enter: () => show('records') },
      { id: 'options', label: 'OPTIONS', hint: () => 'Rebind every control (keyboard and gamepad), volume, touch controls, input delay and fullscreen.', enter: () => show('options') },
      ...exitRows(),
    ], sel.title ?? 3);
  } else if (next === 'options') {
    title('OPTIONS'); rebinder.cancel(); menu = createMenu(optionsItems(optionsHost, rebinder, optionsDevice), sel.options ?? 0);
  } else if (next === 'soon') {
    title(soon.title); $('extra').innerHTML = `<p class="help">${soon.help ?? 'COMING SOON'}</p><p>${soon.text}</p>`;
    menu = createMenu([{ id: 'back', label: 'BACK', enter: () => show('title') }]);
  } else if (next === 'records') {
    title('RECORDS'); const r = save.records, row = (a: string, b: string): string => `<tr><td>${a}</td><td>${b}</td></tr>`;
    $('extra').innerHTML = `<table><tr><th>YOUR BESTS</th><th></th></tr>${row('BEST 1/4 MILE', r.bestEt ? sec(r.bestEt) + ' S' : '-')}${row('BEST 60 FT', r.best60 ? sec(r.best60) + ' S' : '-')}${row('BEST TRAP SPEED', r.bestTrap ? kmh(r.bestTrap) : '-')}${row('BEST REACTION', r.bestReaction ? sec(r.bestReaction) + ' S' : '-')}${row('RACES / WINS', `${r.races} / ${r.wins}`)}${row('RED LIGHTS / CRASHES', `${r.fouls} / ${r.crashes}`)}</table>`
      + `<table><tr><th>LAST RUNS</th><th></th></tr>${r.history.length ? [...r.history].reverse().map(h => row(h.against, h.crashed ? 'CRASHED' : h.foul || h.crossed ? 'DQ' : `${sec(h.et)} S  ${h.won ? 'WIN' : ''}`)).join('') : row('NONE YET', '')}</table><div id="lbboard">${lb.boardHtml()}</div>`;
    const board = (): void => { void lb.loadBoard(); };
    menu = createMenu([
      { id: 'scope', label: 'BOARD', value: () => (lb.boardScope === 'class' ? `MY CLASS: ${lb.className()}` : 'OVERALL'), hint: () => 'Class board: players in your class. Overall: the best time of every player across all classes.', left: () => lb.setBoardScope(lb.boardScope === 'class' ? 'overall' : 'class'), right: () => lb.setBoardScope(lb.boardScope === 'class' ? 'overall' : 'class') },
      { id: 'category', label: 'CATEGORY', value: () => lb.boardCategory.toUpperCase(), hint: () => 'Manual: you drive. Autopilot: the driver AI races for you. They are separate boards.', left: () => lb.setBoardCategory(lb.boardCategory === 'manual' ? 'autopilot' : 'manual'), right: () => lb.setBoardCategory(lb.boardCategory === 'manual' ? 'autopilot' : 'manual') },
      { id: 'refresh', label: 'REFRESH', hint: () => 'Ask the leaderboard again. The game works offline: ranked runs wait until it is reachable.', enter: board },
      { id: 'name', label: 'YOUR NAME', value: () => lb.profile.playerName, hint: () => 'The name shown on the boards. Press Enter to change it.', enter: () => { lb.startNameEdit(); show('name'); } },
      { id: 'back', label: 'BACK', enter: () => show('title') },
    ]);
    void lb.sendPending(); board();
  } else if (next === 'name') {
    const pk = lb.picker; if (!pk) { show('records'); return; }
    title('YOUR NAME');
    const again = (): void => { sel.name = menu?.sel ?? 0; show('name'); };
    menu = createMenu([
      { id: 'letter', label: 'LETTER', value: () => (pk.letter === ' ' ? 'SPACE' : pk.letter), hint: () => 'Up and down (or tap the arrows) change the letter. Choose ADD LETTER to put it on the end of your name.', left: () => { pk.cycle(-1); render(); }, right: () => { pk.cycle(1); render(); } },
      { id: 'add', label: 'ADD LETTER', value: () => pk.name || '(EMPTY)', hint: () => 'Adds the shown letter to your name (up to 16).', enter: () => { pk.add(); again(); } },
      { id: 'delete', label: 'DELETE', hint: () => 'Removes the last letter.', enter: () => { pk.remove(); again(); } },
      { id: 'done', label: 'DONE', hint: () => 'Keeps the name (3 to 16 letters or digits).', enter: () => { if (lb.finishNameEdit()) show('records'); else { msg = 'A NAME NEEDS 3 TO 16 LETTERS OR DIGITS'; render(); } } },
      { id: 'cancel', label: 'CANCEL', enter: () => { lb.cancelNameEdit(); show('records'); } },
    ], sel.name ?? 1);
  } else if (next === 'tune') {
    title('TUNE'); menu = createMenu(tuneItems(), sel[tuneTab] ?? 0);
  } else if (next === 'slip' && result) {
    const R = result, me = R.slips[0] as Timeslip, them = R.slips[1];
    const head = R.crashed ? 'You crashed' : me.aborted ? 'START ABORTED' : me.crossed ? 'CROSSED THE LINE' : me.foul ? 'RED LIGHT' : R.kind === 'test' ? 'TIMESLIP' : R.slips.length === 1 ? (R.won ? 'CLEAN PASS' : 'NO PASS') : R.won ? 'YOU WIN' : 'LEADER WINS';
    title(head, R.crashed || me.foul || me.crossed || (!!them && !R.won) ? '#ff3355' : '#34ff7a');
    if (R.crashed) $('sub').dataset.note = 'YOU DID NOT STOP BEFORE THE END OF THE STRIP'; else delete $('sub').dataset.note;
    const line = (k: string, f: (s: Timeslip) => string): string => `<tr><td>${k}</td>${R.slips.map(s => `<td>${f(s)}</td>`).join('')}</tr>`;
    const tireCell = (s: Timeslip): string => s.tireWearL === undefined || s.tireWearR === undefined ? '-' : `L${Math.round(s.tireTempL ?? 0)}C ${Math.round(s.tireWearL * 100)}%  R${Math.round(s.tireTempR ?? 0)}C ${Math.round(s.tireWearR * 100)}%`;
    const nitroCell = (s: Timeslip): string => !s.nitroUsed ? '-' : `${s.nitroUsed.toFixed(2)} S  +${Math.round((s.nitroPeakGain ?? 0) * 100)}% PEAK`;
    const bottleCell = (s: Timeslip): string => !s.nitroUsed ? '-' : `${Math.round(s.nitroTemp ?? 0)}C ${Math.round((s.nitroPressure ?? 0) * 100)}%`;
    $('extra').innerHTML = `<p class="help">DENSITY ALT ${R.da} FT  ${forecastText(race.state.conditions)}</p><table><tr><th></th>${R.slips.map((s, i) => `<th${i === R.winner ? ' style="color:#34ff7a"' : ''}>${s.name}</th>`).join('')}</tr>`
      + line('R/T', s => (s.aborted ? '<span style="color:#ff3355">ABORT</span>' : s.foul ? '<span style="color:#ff3355">RED LIGHT</span>' : sec(s.reaction))) + line('60 FT', s => sec(s.ft60)) + line('330 FT', s => sec(s.ft330)) + line('1/8 MILE', s => sec(s.eighth)) + line('1000 FT', s => sec(s.ft1000)) + line('1/4 MILE', s => sec(s.quarter)) + line('TRAP', s => kmh(s.trap)) + line('SPIN', spinCell) + `<tr><td>POWER</td>${R.hp.map(h => `<td>${h} HP</td>`).join('')}</tr>` + line('TOTAL', s => (s.crossed || s.foul || s.crashed ? '<span style="color:#ff3355">DQ</span>' : sec(s.total))) + line('BOOST', s => (s.boostPeak !== undefined ? Math.round(s.boostPeak * 100) + '%' : '-')) + line('ENGINE', s => (s.enginePeakTemp !== undefined ? `${Math.round(s.enginePeakTemp)}C  -${Math.round((s.peakRetard ?? 0) * 100)}% TIMING` : '-')) + line('CLUTCH', s => `${s.clutchTemp !== undefined ? Math.round(s.clutchTemp) + 'C ' : ''}${s.clutchCondition !== undefined ? Math.round(s.clutchCondition * 100) + '%' : ''}`) + line('HOT PSI', s => (s.hotPsi !== undefined ? s.hotPsi.toFixed(1) + ' PSI' : '-')) + line('TIRES', tireCell) + line('FUEL', fuelCell) + line('REAR WEIGHT', rearCell) + line('BRAKE', brakeCell) + line('CHUTE', chuteCell) + line('NITRO', nitroCell) + line('BOTTLE', bottleCell)
      + `</table><div class="pts">${R.records.length ? 'NEW: ' + R.records.join(', ') : ''}</div>`
      + (R.kind === 'ghost' && them ? `<table><tr><th>VS ${them.name} (${classLabel(lb.playerClass())})</th><th>DELTA</th></tr>${deltaRowsHtml(markDeltas(me, them, me.reaction, them.reaction))}</table><p class="help" id="lbstatus">${lb.status}</p>` : '');
    const items: MenuItem[] = [{ id: 'again', label: 'RUN AGAIN', enter: () => { raceSeed = freshSeed(); startRace(R.kind); } }];
    if (R.kind !== 'test' && R.kind !== 'ghost') items.push({ ...raceItem(), label: 'NEXT RACE' });
    items.push({ id: 'tune', label: 'TUNE', enter: () => show('tune') }, { id: 'title', label: 'MAIN MENU', enter: () => show('title') });
    menu = createMenu(items);
  } else { show('title'); return; }
  render();
}
/** the tuning rows: each change is kept at once (made safe for the car first) */
const slotState = newSlotState();
function tuneItems(): MenuItem[] {
  const back = (): void => show(backFrom.tune ?? 'title');
  const testItem = (): MenuItem => ({ id: 'test', label: 'TEST RUN', hint: () => tuneHint('test'), enter: () => { raceSeed = freshSeed(); startRace('test'); } });
  const tabItem = (): MenuItem => tuneTab === 'tuning' ? { id: 'statsTab', label: 'STATS TAB', hint: () => tuneHint('statsTab'), enter: () => setTuneTab('stats') } : { id: 'tuningTab', label: 'TUNING TAB', hint: () => tuneHint('tuningTab'), enter: () => setTuneTab('tuning') };
  if (tuneTab === 'stats') return [tabItem(), testItem(), { id: 'back', label: 'BACK', hint: () => tuneHint('back'), enter: back }];
  const get = (): { spec: DragSpec; tune: Tune } => { const r = readyCar(save, clutchCondition); return { spec: r.spec, tune: r.tune }; };
  const set = (f: (t: Tune, spec: DragSpec) => void): void => { const g = get(), t = { ...g.tune, ratios: [...g.tune.ratios] }; f(t, g.spec); commit(saveTune(save, t)); };
  const num = (id: string, label: string, v: (t: Tune) => string, ch: (t: Tune, d: number, spec: DragSpec) => void, off?: () => boolean): MenuItem => ({ id, label, value: () => v(get().tune), hint: () => tuneHint(id), disabled: off, left: () => set((t, s) => ch(t, -1, s)), right: () => set((t, s) => ch(t, 1, s)) });
  const r2 = (v: number): number => Math.round(v * 100) / 100, { tune } = get(), noNitro = (): boolean => get().spec.nitroSecs <= 0, noBoost = (): boolean => get().spec.boostCap <= 0;
  return [
    tabItem(),
    num('shift', 'SHIFTING', t => (t.shift === 'manual' ? 'MANUAL' : 'AUTO'), t => { t.shift = t.shift === 'manual' ? 'auto' : 'manual'; }),
    num('shiftRpm', 'SHIFT AT', t => `${t.shiftRpm} RPM`, (t, d) => { t.shiftRpm += d * 100; }),
    num('launchRpm', 'LAUNCH AT', t => `${t.launchRpm} RPM`, (t, d) => { t.launchRpm += d * 100; }),
    num('launchAggression', 'LAUNCH AGGRESSION', t => `${t.launchAggression}/10`, (t, d) => { t.launchAggression += d; }),
    num('boostLimit', 'BOOST LIMIT', t => (noBoost() ? '-' : `${Math.round(boostLimitOf(t) * 100)}%${boostLimitOf(t) > BOOST.safeLimit ? ' RISK' : ''}`), (t, d) => { t.boostLimit = r2(boostLimitOf(t) + d * BOOST.step); }, noBoost),
    ...tune.ratios.map((_, i) => num(`gear${i + 1}`, `GEAR ${i + 1}`, t => (t.ratios[i] ?? 0).toFixed(2), (t, d) => { t.ratios[i] = r2((t.ratios[i] ?? 1) + d * 0.05); })),
    num('final', 'FINAL DRIVE', t => t.final.toFixed(2), (t, d) => { t.final = r2(t.final + d * 0.05); }),
    num('pressure', 'TIRE PRESSURE', t => `${t.pressure} PSI`, (t, d) => { t.pressure += d; }),
    num('ballast', 'BALLAST', t => `${t.ballast} KG`, (t, d) => { t.ballast += d * 5; }),
    fuelItem(),
    num('stiffness', 'SUSPENSION', t => `${t.stiffness}/10`, (t, d) => { t.stiffness += d; }),
    num('wheelieBar', 'WHEELIE BAR', t => `${t.wheelieBar}/10`, (t, d) => { t.wheelieBar += d; }),
    num('nitroShot', 'NITRO SHOT', t => (noNitro() ? '-' : `${Math.round(t.nitroShot * 100)}%`), (t, d) => { t.nitroShot = r2(t.nitroShot + d * 0.05); }, noNitro),
    num('nitroGear', 'NITRO FIRES', t => (noNitro() ? '-' : t.nitroGear === 0 ? 'BY HAND' : `IN GEAR ${t.nitroGear}`), (t, d) => { t.nitroGear = Math.max(0, Math.min(t.ratios.length, t.nitroGear + d)); }, noNitro),
    // The clutch is a wear item (it is driven automatically; there is no clutch key). Replacing it is free: it only resets the wear, so it is a choice about when, not about money.
    { id: 'replaceClutch', label: 'REPLACE CLUTCH', hint: () => 'The clutch engages by itself, and slipping it on launches and shifts builds heat and wears the plates, so bites get softer over a session. Replacing it is free and puts it back to new.', value: () => (clutchCondition >= 1 ? 'NEW' : `${Math.round(clutchCondition * 100)}%`), enter: () => { clutchCondition = 1; show('tune'); } },
    // Tires are a wear item the same way: the slicks' wear carries between races in a visit, and replacing them is free (it only resets the wear).
    { id: 'replaceTires', label: 'REPLACE TIRES', hint: () => tuneHint('replaceTires'), value: () => { const worst = Math.max(tireWear[0], tireWear[1]); return worst <= 0 ? 'NEW' : `${Math.round((1 - worst) * 100)}%`; }, enter: () => { tireWear = [0, 0]; show('tune'); } },
    { id: 'cool', label: 'COOL ENGINE', hint: () => 'Engine heat carries between races in this visit: burnouts and long boosted pulls retard the timing until you let it cool. This resets it to the day\'s air.', value: () => `${Math.round(engineOf())}C`, enter: () => { engineTemp = null; show('tune'); } },
    { id: 'strip', label: 'CLEAR STRIP', hint: () => 'Burnouts and wheelspin leave rubber on the strip for the rest of this visit, adding grip where it lies. Clear it for a clean run.', value: () => `${Math.round(rubberShare(strip, 0) * 100)}% RUBBER`, enter: () => { clearDragStrip(strip); show('tune'); } },
    { id: 'reset', label: 'RESET TUNE', hint: () => tuneHint('reset'), enter: () => { commit(saveTune(save, defaultTune(readyCar(save).car))); show('tune'); } },
    // the six tune slots (which one, its name, SAVE, LOAD, CLEAR) sit at the bottom, just above TEST RUN and BACK
    ...slotRows({
      slots: () => tuneSlots(save), places: () => ['', STOCK_CAR.name], place: () => STOCK_CAR.name,
      save: (i, name) => { commit(saveToSlot(save, i, name, get().tune)); }, load: i => { commit(loadFromSlot(save, i)); }, clear: i => { commit(clearSaveSlot(save, i)); },
      refresh: (id, m) => { if (m) msg = m; sel[tuneTab] = Math.max(0, tuneItems().findIndex(it => it.id === id)); show('tune'); },
    }, slotState),
    testItem(),
    { id: 'back', label: 'BACK', hint: () => tuneHint('back'), enter: back },
  ];
}
/** the panel above the rows for screens whose numbers follow the selection or the tune */
function info(): void {
  if (screen === 'tune' && tuneTab === 'stats') { const r = readyCar(save, clutchCondition); $('extra').innerHTML = statsTable(r.spec, r.tune, raceSeed, fuelOf()); }
  $('sub').textContent = msg || (screen === 'slip' && $('sub').dataset.note) || (screen === 'title' ? benchmarkLine(benchContext) : '');
}
function render(keepVisible = false): void {
  if (!menu) return; const m = menu, rows = $('rows'), top = card.scrollTop; rows.innerHTML = ''; info();
  const tabs = $('tabs'); tabs.innerHTML = screen === 'tune' ? `<button class="${tuneTab === 'tuning' ? 'on' : ''}" data-tab="tuning">TUNING</button><button class="${tuneTab === 'stats' ? 'on' : ''}" data-tab="stats">STATS</button>` : '';
  for (const b of tabs.querySelectorAll('button')) b.onclick = () => setTuneTab(b.dataset.tab as TuneTab);
  if (screen === 'title') sel.title = m.sel; else if (screen === 'tune') sel[tuneTab] = m.sel; else if (screen === 'options') sel.options = m.sel;
  const visible: { row?: HTMLElement } = {};
  m.items.forEach((it, i) => {
    const e = document.createElement('div'), off = !!it.disabled?.(); e.className = 'opt' + (i === m.sel ? ' sel' : '') + (off ? ' off' : '');
    e.innerHTML = `<span>${it.label}</span>${it.value ? `<em>${it.left || it.right ? '<b class="dn">‹</b> ' : ''}${it.value()}${it.left || it.right ? ' <b class="up">›</b>' : ''}</em>` : ''}`;
    e.onmousemove = () => { if (!off && m.sel !== i) { m.sel = i; render(); } };
    e.onclick = ev => { if (off) return; m.sel = i; const d = (ev.target as HTMLElement).classList; if (d.contains('dn') && it.left) it.left(); else if (d.contains('up') && it.right) it.right(); else if (it.enter) it.enter(); else if (it.right) it.right(); if (menu === m) render(); };
    rows.appendChild(e); if (i === m.sel) visible.row = e;
  });
  if (keepVisible && visible.row) visible.row.scrollIntoView({ block: 'nearest' }); else card.scrollTop = top;
  reserveHintSpace(m); const cur = m.items[m.sel]; $('hint').textContent = cur?.hint?.() ?? '';
}
/** Lock the menu to the size it has with its longest description showing: the hint line is given the height of the tallest hint of this menu, so hovering rows never resizes or bounces the card.
 * The height is worked out once for each menu and card width (a resize measures again). */
const hintHeights = new WeakMap<Menu, { width: number; height: number }>();
function reserveHintSpace(m: Menu): void {
  const el = $('hint'), width = card.clientWidth, known = hintHeights.get(m);
  if (known && known.width === width) { el.style.minHeight = known.height + 'px'; return; }
  el.style.minHeight = '';
  let tallest = 0; for (const it of m.items) { el.textContent = it.hint?.() ?? ''; tallest = Math.max(tallest, el.offsetHeight); }
  el.style.minHeight = tallest + 'px'; hintHeights.set(m, { width, height: tallest });
}

// ---- the race ----
/** autopilot runs go to their own leaderboard category (and race that category's class leader) */
const syncCategory = (): void => { const c = options.driver === 'autopilot' ? AUTOPILOT_CATEGORY : 'manual'; if (lb.category !== c) { lb.setCategory(c); void lb.refreshLeader(); } };
function startRace(kind: DragRaceKind): void {
  syncCategory(); raceKind = kind; screenBefore = screen; msg = ''; const ranked = kind === 'ghost', entrants = [ranked ? rankedEntrant() : myEntrant()], g = ranked ? ghostToRace() : null; if (g) entrants.push(ghostEntrant(g));
  if (ranked) { raceSeed = RANKED.seed; lb.clearStatus(); }      // (a ranked run is the fixed class day: the same seed, weather and fresh strip for everyone)
  race = createDrag(ranked ? { seed: RANKED.seed, conditions: RANKED.conditions, strip: rankedStrip(), entrants } : { seed: raceSeed, strip, entrants }); isBackdrop = false; banked = false; overT = 0; acc = 0; result = null; input.reset(performance.now()); autopilot = createAutopilot(); show('race');
}
function finishRace(): void {
  if (banked) return; banked = true; const s = race.state, me = s.runners[0] as Runner, slip = timeslip(me), crashed = !!slip.crashed;
  const won = !crashed && !me.aborted && (s.runners.length === 1 ? s.winner === 0 && !me.foul : s.winner === 0);
  const ranked = raceKind === 'ghost';      // (a ranked run starts fresh, so it leaves the visit's clutch, fuel and engine heat alone)
  if (!ranked) { if (me.launched) { clutchCondition = clutchAfterRun(me); tireWear = tireWearAfterRun(me); } fuelLoad = me.fuel; engineTemp = slip.engineTemp ?? engineOf(); }
  const slips = s.runners.map(timeslip), candidate = ghostFromRunner(me, s.greenAt, STOCK_CAR.id);
  // autopilot runs are a separate leaderboard category, on the same ranked class day, and never touch your local records or best-pass ghost
  const category: RunCategory = options.driver === 'autopilot' ? AUTOPILOT_CATEGORY : 'manual', res = category === 'autopilot' ? { save, records: [] as string[] } : recordRace(save, { kind: raceKind, won, slip, crashed }, Date.now()); if (category === 'manual') commit(res.save);
  if (ranked) void lb.submitRun(slip, me.tune, RANKED.seed, candidate);
  result = { category, won, crashed, records: res.records, slips, reason: s.reason, winner: s.winner, kind: raceKind, hp: s.runners.map(r => Math.round(dynoPeaks(r.spec).hp)), da: densityAltitudeFt(s.conditions) };
}
// ---- input: everything goes through src/input (keys, touch, pad -> a timestamped queue -> the fixed-step loop -> one DriverInput). The autopilot returns the same shape. ----
let autopilot: Autopilot = createAutopilot();
const input = createInput({ options: () => options, racing: () => screen === 'race' && options.driver === 'manual', size: () => ({ w: innerWidth, h: innerHeight }), onMenu: () => { if (screen === 'race') show(screenBefore); } });
const haptics = createHaptics(() => options.touch.haptics);
const padMenu = createPadMenu(() => screen !== 'race' && rebinder.pending?.device !== 'gamepad');
/** the input for this tick goes to the car: the driver's (keys, touch, pad) or the autopilot's */
let pedal = 0;      // (the gas of the last tick, for the engine sound)
function readInput(): void { const inp = options.driver === 'autopilot' ? autopilot.decide(viewOf(race, 0, (race.state.runners[0] as Runner).stage)) : input.read(); pedal = inp.throttle; race.setInput(0, inp); }
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (screen === 'bench') { if (k === 'escape') benchScreen?.cancel(); return; }
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'tab'].includes(k)) e.preventDefault();
  if (screen === 'options' && rebinder.pending && rebinder.key(e.key)) { e.preventDefault(); return; }
  if (screen === 'race') { if (k === 'escape') show(screenBefore); return; }      // (leaving a race records nothing; the driving keys are read by src/input)
  if (screen === 'tune' && k === 'tab') { setTuneTab(tuneTab === 'tuning' ? 'stats' : 'tuning'); return; }
  if (k === 'escape') { if (screen === 'tune') show(backFrom.tune ?? 'title'); else if (screen === 'name') { lb.cancelNameEdit(); show('records'); } else if (screen !== 'title') show('title'); return; }
  if (menu && menu.key(k)) render(true);
});
input.attach(window, cv);

// ---- drawing: the strip from above (see topdown.ts), sized to the window (an itch.io frame can be any size, and can be resized or made fullscreen at any time) ----
function resize(): void { const dpr = Math.min(2, devicePixelRatio || 1); cv.width = Math.floor(innerWidth * dpr); cv.height = Math.floor(innerHeight * dpr); cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
watchViewport(resize); resize();
onFirstGesture(() => { sfx.unlock(); });      // (audio stays locked until the first touch or key)
const fsButton = $('fs'); if (fullscreenAvailable()) { fsButton.style.display = 'block'; fsButton.onclick = toggleFullscreen; }
const topDown = createDragTopDown();
let last = performance.now();
/** the touch buttons the left panel must stay clear of (none when the touch controls are not on screen) */
function touchSpots(): { id: string; x: number; y: number; w: number; h: number }[] { return options.driver === 'manual' && input.touchVisible() ? input.touch.layout : []; }
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000); last = now; padMenu(); if (screen === 'options') rebinder.pad(firstPad());
  if (screen === 'bench') { requestAnimationFrame(frame); return; }      // (nothing else draws while the benchmark measures the card)
  const W = innerWidth, H = innerHeight, S = Math.max(0.7, Math.min(1.6, H / 720)), s = race.state, me = s.runners[0] as Runner;
  if (screen === 'race') {
    acc += dt; let n = 0; input.startFrame(now - acc * 1000, firstPad(), now);
    while (acc >= DRAG.dt && n++ < 60) { acc -= DRAG.dt; readInput(); race.step(); haptics.onEvents(race.events); for (const e of race.events) { if (e.t === 'amber') sfx.treeLight('amber', e.n); else if (e.t === 'green') sfx.treeLight('green'); } }
    if (s.phase === 'over') { finishRace(); if ((overT += dt) > 1.6) show('slip'); }
  }
  sfx.engine(pedal, screen === 'race');
  topDown.draw(ctx, W, H, race.state, 0, dt, now / 1000);
  if (screen === 'race') {
    // with the touch buttons on screen the prompts name the buttons (GAS, BRAKE, BURN, BACK UP, GO, DEEP); otherwise the player's own bound keys
    const spots = touchSpots(), touch = spots.length > 0, button = (id: string): string | undefined => input.touch.layout.find(r => r.id === id)?.label;
    const label = (id: string, fallback: string): string => (touch ? button(id) : undefined) ?? keyLabel((options.binds[id] ?? [])[0] ?? fallback);
    drawProgress(ctx, W, H, s, 0, S, { launch: label('launch', ' '), nitro: label('nitro', 'Shift'), manual: me.tune.shift === 'manual' && options.driver === 'manual', auto: !!me.ai || options.driver === 'autopilot', burnout: label('burnout', 'j'), gas: label('gas', 'w'), brake: label('brake', 's'), chute: label('chute', 'n'), deepStage: label('deepStage', 'h'), backUp: label('backUp', 'r'), touch, avoid: spots });
    // the touch controls go on top of the panel, unchanged
    input.draw(ctx, options.driver === 'manual');
  }
  requestAnimationFrame(frame);
}
window.__drag = () => {
  const s = race.state;
  return { screen, tuneTab, phase: s.phase, stage: (s.runners[0] as Runner).stage, seed: raceSeed, conditions: s.conditions, menu: menu ? { sel: menu.items[menu.sel]?.id, items: menu.items.map(i => i.id) } : null, benchmark: save.benchmark, kind: raceKind, driver: options.driver, category: result?.category ?? null, clutch: clutchCondition, tireWear, fuel: fuelOf(), ghost: (() => { const g = ghostToRace(); return g ? { et: g.marks.quarter ?? 0, total: g.total, samples: g.samples.length } : null; })(), leaderboard: { class: lb.playerClass(), category: lb.category, leader: lb.leader().name, source: lb.leader().source, status: lb.status, ranked: raceKind === 'ghost', configured: lb.configured }, winner: s.winner, runners: s.runners.map(r => ({ name: r.name, x: r.x, v: r.v, gear: r.gear, rpm: r.rpm, launched: r.launched, finished: r.finished, crashed: r.crashed })), result };
};
show('title'); requestAnimationFrame(t => { last = t; frame(t); });
