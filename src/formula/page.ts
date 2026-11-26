// FORMULA MODE inside the page: the parts of the GPU Wars page that are Formula's. src/drag/page.ts is the one page (one index.html, one bundle, shared title menu, benchmark, options, records, leaderboard) and asks this module for what is different in Formula:
// the FORMULA TUNE screen rows and its predicted lap, the race (standing start, ghost of the class leader, input, sound), the timeslip, the records table and the picture drawn behind the menus.
// It follows the conventions of src/drag/page.ts: menus are `MenuItem` lists, every change is kept at once, input goes through src/input, text is plain capitals, nothing here draws a ghost word on the race screen.
// It does not touch the DOM or any screen change itself: the page gives it a host (`FormulaHost`) with the save, the options, the input and the leaderboard, and draws the html this module returns.
import type { MenuItem } from '../arena/view/menu.ts';
import type { Input } from '../input/index.ts';
import type { Options } from '../options/model.ts';
import type { createSfx } from '../sfx.ts';
import type { Save } from '../save.ts';
import type { PadState } from '../arena/view/pad.ts';
import { newSlotState, slotRows } from '../tune-slots-menu.ts';
import { AUTOPILOT_CATEGORY, createFormulaAutopilot } from './autopilot.ts';
import { cleanFormulaTune, FORMULA_TUNE_HELP, FORMULA_TUNE_LIMITS, DEFAULT_FORMULA_TUNE, carStats } from './car.ts';
import { createFormulaRace, isGreen, lightsLit, type FormulaRace } from './race.ts';
import { predictFormula } from './predict.ts';
import { racingLineFor } from './racingLine.ts';
import { draw } from './topdown.ts';
import { clockText } from './hud.ts';
import { FORMULA_DT } from './constants.ts';
import { trackById } from './tracks.ts';
import { clearFormulaSlot, formulaCar, formulaSlots, loadFormulaSlot, recordFormulaLap, saveFormulaTune, saveToFormulaSlot, type FormulaRaceKind } from './model.ts';
import type { FormulaOnline } from './online.ts';
import type { FormulaGhost, FormulaInput, FormulaTimeslip, FormulaTune } from './types.ts';
import { DEFAULT_TRACK } from '../classes.ts';
import type { Rect } from './hud.ts';

export interface FormulaHost {
  /** the live options (read every time: a rebind or a switch takes effect at once) */ options: Options;
  save: () => Save; commit: (next: Save) => void;
  online: FormulaOnline; input: Input; sfx: ReturnType<typeof createSfx>;
  /** the first gamepad, or null */ pad: () => PadState | null; /** keep the options (after the driving line key flips one) */ saveOptions: () => void;
}
/** what the timeslip screen shows and says after a lap */
export interface FormulaResult { kind: FormulaRaceKind; category: 'manual' | 'autopilot'; slip: FormulaTimeslip; ghost: FormulaGhost | null; won: boolean; records: string[]; tune: FormulaTune; engine: number }

const sec = (v: number | null | undefined): string => (v === null || v === undefined || !Number.isFinite(v) ? '-' : v.toFixed(3));
const kmh = (v: number | undefined): string => (v === undefined || !v ? '-' : `${Math.round(v)} KM/H`);
const signed = (v: number): string => `${v <= 0 ? '-' : '+'}${Math.abs(v).toFixed(3)}`;
const red = (s: string): string => `<span style="color:#ff3355">${s}</span>`;
const delta = (v: number): string => `<span style="color:${v <= 0 ? '#34ff7a' : '#ff3355'}">${signed(v)}</span>`;
const table = (title: string, rows: [string, string][]): string => `<table><tr><th>${title}</th><th></th></tr>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`;
const step = (v: number, d: number, lo: number, hi: number, by = 0.1): number => Math.max(lo, Math.min(hi, Math.round((v + d * by) * 10) / 10));
/** how a -1 to 1 setting reads: its name for the low end, the stock middle and its name for the high end */
const swing = (v: number, low: string, high: string): string => (Math.abs(v) < 0.05 ? 'STOCK' : `${v < 0 ? low : high} ${Math.round(Math.abs(v) * 100)}%`);

export function createFormulaMode(host: FormulaHost) {
  const track = trackById(DEFAULT_TRACK.formula), slotState = newSlotState();
  let race: FormulaRace = createFormulaRace({ track }), kind: FormulaRaceKind = 'test', autopilot: ReturnType<typeof createFormulaAutopilot> | null = null;
  let banked = true, overT = 0, acc = 0, lastLights = 0, wasGreen = false, gasWasOn = false, pedal = 0, backdropKey = '', isBackdrop = true;
  let result: FormulaResult | null = null;
  const category = (): 'manual' | 'autopilot' => (host.options.driver === 'autopilot' ? AUTOPILOT_CATEGORY : 'manual');
  const car = () => formulaCar(host.save());
  /** the key of everything the backdrop (the car on the grid) depends on */
  const keyNow = (): string => { const s = host.save(), g = host.online.ghost(); return `${s.benchmark?.score ?? 0}|${JSON.stringify(s.formula.tune)}|${g?.lapTime ?? 0}`; };
  function newRace(withGhost: boolean): FormulaRace { const { spec, tune } = car(); return createFormulaRace({ track, spec, tune, ghost: withGhost ? host.online.ghost() : null }); }

  // ---- the tune screen ----
  /** the tune screen's rows. `back` leaves the screen, `test` starts a test lap, `refresh(id, msg)` redraws it with a row selected and a line under the title */
  function tuneItems(h: { back: () => void; test: () => void; refresh: (id: string, msg?: string) => void }): MenuItem[] {
    const get = (): FormulaTune => car().tune;
    const set = (f: (t: FormulaTune) => void): void => { const t = { ...get() }; f(t); host.commit(saveFormulaTune(host.save(), t)); };
    const row = (id: keyof FormulaTune, label: string, value: (t: FormulaTune) => string, change: (t: FormulaTune, d: number) => void): MenuItem => ({ id, label, value: () => value(get()), hint: () => FORMULA_TUNE_HELP[id], left: () => set(t => change(t, -1)), right: () => set(t => change(t, 1)) });
    const L = FORMULA_TUNE_LIMITS, lap = (): string => { const s = predictFormula(car().spec, get(), track); return s.finished ? `${sec(s.lapTime)} S` : '-'; };
    return [
      { id: 'predicted', label: 'PREDICTED LAP', value: lap, hint: () => 'The lap a perfect driver (the autopilot) makes from a standing start with this car and this tune. It changes as you tune. The STATS tab has the sectors and the car\'s numbers.' },
      row('gearing', 'GEARING', t => swing(t.gearing, 'SHORT', 'TALL'), (t, d) => { t.gearing = step(t.gearing, d, L.gearing[0], L.gearing[1]); }),
      row('downforce', 'DOWNFORCE', t => `${Math.round(t.downforce * 100)}%`, (t, d) => { t.downforce = step(t.downforce, d, L.downforce[0], L.downforce[1]); }),
      row('steering', 'STEERING', t => swing(t.steering, 'SLOW', 'QUICK'), (t, d) => { t.steering = step(t.steering, d, L.steering[0], L.steering[1]); }),
      row('pressure', 'TYRE PRESSURE', t => swing(t.pressure, 'SOFT', 'HARD'), (t, d) => { t.pressure = step(t.pressure, d, L.pressure[0], L.pressure[1]); }),
      row('nitro', 'NITRO BOTTLES', t => (t.nitro === 0 ? 'NONE' : String(t.nitro)), (t, d) => { t.nitro = Math.max(L.nitro[0], Math.min(L.nitro[1], t.nitro + d)); }),
      row('gearbox', 'GEARBOX', t => (t.gearbox === 'manual' ? 'MANUAL' : 'AUTO'), t => { t.gearbox = t.gearbox === 'manual' ? 'auto' : 'manual'; }),
      row('shiftLight', 'SHIFT LIGHT AT', t => `${Math.round(t.shiftLight * 100)}% OF THE REVS`, (t, d) => { t.shiftLight = step(t.shiftLight, d, L.shiftLight[0], L.shiftLight[1]); }),
      // (the Formula car has no tyre wear, so there is no REPLACE TIRES row: every lap starts on new tyres)
      { id: 'reset', label: 'RESET TUNE', hint: () => 'Back to the stock tune: stock gearing, half downforce, no nitro, you shift.', enter: () => { host.commit(saveFormulaTune(host.save(), DEFAULT_FORMULA_TUNE)); h.refresh('reset'); } },
      ...slotRows({
        slots: () => formulaSlots(host.save()), places: () => ['', track.name], place: () => track.name,
        save: (i, name) => host.commit(saveToFormulaSlot(host.save(), i, name, get())), load: i => host.commit(loadFormulaSlot(host.save(), i)), clear: i => host.commit(clearFormulaSlot(host.save(), i)),
        refresh: h.refresh,
      }, slotState),
      { id: 'test', label: 'TEST RUN', hint: () => 'A free lap with no ghost. Nothing is sent to the leaderboard.', enter: h.test },
      { id: 'back', label: 'BACK', enter: h.back },
    ];
  }
  /** the STATS tab: the predicted lap in full and the car's numbers */
  function statsHtml(): string {
    const { spec, tune } = car(), slip = predictFormula(spec, tune, track), stats = carStats(spec, tune);
    const cars: [string, string][] = [['CAR', spec.name], ['ENGINE LEVEL', spec.engine.toFixed(2)], ['TOP SPEED', `${Math.round(stats.vmax * 3.6)} KM/H`], ['PULL', `${stats.accel.toFixed(1)} M/S2`], ['GRIP', stats.grip.toFixed(1)], ['DOWNFORCE', stats.aero.toFixed(2)], ['NITRO', stats.nitroShots ? `${stats.nitroShots} BOTTLE${stats.nitroShots > 1 ? 'S' : ''}` : 'NONE'], ['GEARBOX', stats.gearbox === 'manual' ? 'MANUAL' : 'AUTO'], ['TRACK', `${track.name}, ${Math.round(track.length)} M`]];
    const lapRows: [string, string][] = [['LAP TIME', slip.finished ? `${sec(slip.lapTime)} S` : '-'], ['LAUNCH TO LINE', `${sec(slip.launchTime)} S`], ...slip.sectors.map((t, i): [string, string] => [`SECTOR ${i + 1}`, `${sec(t)} S`]), ['TOP SPEED', kmh(slip.topSpeed)], ['WALL HITS', String(slip.wallHits)]];
    return `<div class="slips">${table(spec.name, cars)}${table('PREDICTED: A PERFECT DRIVER FROM A STANDING START', lapRows)}</div>`;
  }

  // ---- the race ----
  const rankedGhost = (): FormulaGhost | null => host.online.ghost();
  /** the race item on the title menu: the class leader's lap to beat */
  function raceItem(go: () => void): MenuItem {
    return {
      id: 'race', label: 'RACE CLASS LEADER', value: () => { const r = host.online.leader(); return r ? `${sec(r.timeS)} S TO BEAT` : 'NO LEADER YET'; },
      hint: () => { const r = host.online.leader(); return `One ranked lap of ${track.name} in ${host.online.className()} from a standing start${r ? ` against ${r.name}` : ' (no leader online yet: you set the first time)'}. A clean lap is sent to the leaderboard. ${host.online.note()}`.trim(); },
      enter: go,
    };
  }
  /** starts a lap; the page shows the race screen */
  function start(k: FormulaRaceKind): void {
    kind = k; race = newRace(k === 'ranked'); isBackdrop = false; banked = false; overT = 0; acc = 0; result = null; lastLights = 0; wasGreen = false; gasWasOn = false; pedal = 0;
    autopilot = host.options.driver === 'autopilot' ? createFormulaAutopilot(race.track, race.state.car.stats) : null;
    host.input.reset(performance.now()); if (k === 'ranked') host.online.clearStatus();
  }
  /** behind the menus: your car on the grid (rebuilt only when what it depends on changed) */
  function backdrop(): void { const key = keyNow(); if (isBackdrop && key === backdropKey) return; race = newRace(true); isBackdrop = true; backdropKey = key; }
  /** one tick's input: the autopilot's or the driver's (keys, touch, pad). The driving-line key flips the option here. */
  function tickInput(): FormulaInput {
    if (autopilot) return autopilot.decide(race.view());
    const { toggleLine, ...input } = host.input.readFormula(FORMULA_DT);
    if (toggleLine) { host.options.drivingLine = !host.options.drivingLine; host.saveOptions(); }
    return input;
  }
  /** call every frame. While racing it runs the fixed steps and the sounds; the lap's end is banked once. Returns true when the timeslip should come up. */
  function frame(dt: number, now: number, racing: boolean): boolean {
    let showSlip = false;
    if (racing) {
      acc += dt; let n = 0; host.input.startFrame(now - acc * 1000, host.pad(), now);
      while (acc >= FORMULA_DT && n++ < 20 && !race.over) {
        acc -= FORMULA_DT; const input = tickInput(); pedal = input.throttle; race.step(input);
        const clock = race.state.lap.clock, lit = lightsLit(clock), green = isGreen(clock);
        if (lit > lastLights) host.sfx.treeLight('amber', lit); lastLights = lit; if (green && !wasGreen) host.sfx.treeLight('green'); wasGreen = green;
        if (green) { if (pedal >= 0.5) gasWasOn = true; else if (pedal < 0.05 && gasWasOn) { gasWasOn = false; host.sfx.liftOff(); } }
      }
      if (race.over) { finish(); showSlip = (overT += dt) > 1.6; }
    }
    host.sfx.engine(racing ? pedal : 0, racing, isGreen(race.state.lap.clock));
    return showSlip;
  }
  function finish(): void {
    if (banked) return; banked = true;
    const slip = race.timeslip(), ghost = race.ghost, cat = category(), clean = slip.finished && slip.valid, won = clean && !!ghost && slip.lapTime < ghost.lapTime, { tune, spec } = car();
    // autopilot laps are a separate leaderboard category and never touch your own records
    const rec = cat === 'autopilot' ? { save: host.save(), records: [] as string[] } : recordFormulaLap(host.save(), { kind, slip, won }, Date.now());
    if (cat === 'manual') host.commit(rec.save);
    if (kind === 'ranked') void host.online.submitLap(slip, tune);
    result = { kind, category: cat, slip, ghost, won, records: rec.records, tune, engine: spec.engine };
  }
  /** the picture: the race (or the grid behind a menu); `avoid` are the touch buttons the HUD stays clear of */
  function drawFrame(ctx: CanvasRenderingContext2D, W: number, H: number, now: number, racing: boolean, avoid: Rect[]): void {
    const { spec, tune } = car(), showLine = racing && host.options.drivingLine, line = showLine ? racingLineFor(spec, tune, track) : null;
    draw(ctx, W, H, race.view(), { showLine, line, time: now, avoid });
    if (racing && autopilot) { ctx.font = `bold ${Math.round(Math.max(10, H / 60))}px monospace`; ctx.textAlign = 'center'; ctx.fillStyle = '#8a9ac0'; ctx.fillText('AUTOPILOT', W / 2, Math.min(H - 6, 72 + H / 30)); }
  }

  // ---- the timeslip ----
  function slipView(): { title: string; ok: boolean; html: string } | null {
    if (!result) return null;
    const R = result, s = R.slip, g = R.ghost, vs = !!g && R.kind === 'ranked';
    const title = s.jumpStart ? 'JUMP START' : s.finished ? (R.kind === 'ranked' && g ? (R.won ? 'YOU WIN' : 'LEADER WINS') : 'TIMESLIP') : 'TIME OUT';
    const ok = s.finished && s.valid && (!vs || R.won);
    const gs = g ? g.splits.map((t, i) => +(t - (i ? (g.splits[i - 1] as number) : 0)).toFixed(3)) : [], cols = vs ? ['YOU', g?.name ?? 'LEADER'] : ['YOU'];
    const line = (k: string, mine: string, theirs: string): string => `<tr><td>${k}</td><td>${mine}</td>${vs ? `<td>${theirs}</td>` : ''}</tr>`;
    let html = `<p class="help">${track.name}  ${R.category === 'autopilot' ? 'AUTOPILOT  ' : ''}ENGINE LEVEL ${R.engine.toFixed(2)}</p><table><tr><th></th>${cols.map(c => `<th>${c}</th>`).join('')}</tr>`
      + line('R/T', s.jumpStart ? red('JUMP START') : sec(s.reaction), g ? sec(g.reaction) : '-') + line('LAUNCH TO LINE', sec(s.launchTime), g ? sec(g.launchTime) : '-')
      + s.sectors.map((t, i) => line(`SECTOR ${i + 1}`, sec(t), gs[i] !== undefined ? sec(gs[i]) : '-')).join('')
      + line('LAP TIME', s.finished ? sec(s.lapTime) : red('DNF'), g ? sec(g.lapTime) : '-') + line('TOP SPEED', kmh(s.topSpeed), g && g.topSpeed ? kmh(g.topSpeed) : '-') + line('WALL HITS', String(s.wallHits), '-')
      + `</table><div class="pts">${R.records.length ? 'NEW: ' + R.records.join(', ') : ''}</div>`;
    if (vs && g && s.finished) {
      const rows: [string, string][] = [];
      if (s.reaction !== null && s.reaction >= 0) rows.push(['R/T', delta(s.reaction - g.reaction)]);
      s.sectors.forEach((t, i) => { if (gs[i] !== undefined) rows.push([`SECTOR ${i + 1}`, delta(t - (gs[i] as number))]); });
      rows.push(['LAP TIME', delta(s.lapTime - g.lapTime)]);
      html += `${table(`VS ${g.name} (${host.online.className()})`, rows)}<p class="help" id="lbstatus">${host.online.status}</p>`;
    } else if (R.kind === 'ranked') html += `<p class="help" id="lbstatus">${host.online.status}</p>`;
    return { title, ok, html };
  }
  /** the RECORDS screen's tables (your own bests on this computer; the online boards are on the LEADERBOARD screen) */
  function recordsHtml(): string {
    const r = host.save().formula.records, row = (a: string, b: string): string => `<tr><td>${a}</td><td>${b}</td></tr>`;
    return `<table><tr><th>YOUR BESTS: FORMULA ${track.name}</th><th></th></tr>${row('BEST LAP', r.bestLap ? sec(r.bestLap) + ' S' : '-')}${r.bestSectors.map((t, i) => row(`BEST SECTOR ${i + 1}`, t ? sec(t) + ' S' : '-')).join('')}${row('BEST TOP SPEED', r.bestTopSpeed ? kmh(r.bestTopSpeed) : '-')}${row('BEST REACTION', r.bestReaction ? sec(r.bestReaction) + ' S' : '-')}${row('RACES / WINS', `${r.races} / ${r.wins}`)}${row('JUMP STARTS / WALL HITS', `${r.jumpStarts} / ${r.wallHits}`)}</table>`
      + `<table><tr><th>LAST LAPS</th><th></th></tr>${r.history.length ? [...r.history].reverse().map(h => row(h.against, h.jumpStart ? 'JUMP START' : h.lapTime ? `${sec(h.lapTime)} S` : 'DNF')).join('') : row('NONE YET', '')}</table>`;
  }
  return {
    track, tuneItems, statsHtml, raceItem, start, backdrop, frame, finish, drawFrame, slipView, recordsHtml,
    get result(): FormulaResult | null { return result; }, get race(): FormulaRace { return race; }, get kind(): FormulaRaceKind { return kind; }, get over(): boolean { return race.over; },
    get ghost(): FormulaGhost | null { return rankedGhost(); }, clockText,
    cleanTune: cleanFormulaTune,
  };
}
export type FormulaMode = ReturnType<typeof createFormulaMode>;
