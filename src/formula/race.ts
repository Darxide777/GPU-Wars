// THE LAP: a standing start, one lap, a timeslip. `stepLap` is a pure function (a lap's state, the driver's input and a fixed step in, the new state out); `createFormulaRace` keeps the state, the lap trace and the ghost for a page.
//
// The start: the car stands on the grid, 5 m behind the start line, with the lights on. Three lights come on, one a second, and go out together at the GREEN (`LIGHTS.go`). The car is held until then (the driver's input does nothing), and gas
// pressed before the green is a JUMP START (the lap is not ranked). The lap is TIMED FROM THE START LINE, not from the green: the clock runs from the moment the car crosses the line (a standing start, so the first seconds are the launch)
// to the moment it crosses it again at the end of the lap. The gates round the track (the first is the start line) are the sector splits; they must be crossed in order. The reaction is the time from the green to the first gas.
// Nothing else is in the lap: no rivals, no weapons, no pickups, no wrecks (the wall only scrubs speed).
import { FORMULA_DT, LAP, LIGHTS, TRACE } from './constants.ts';
import { ghostPose, ghostTimeAt, type GhostPose } from './ghost.ts';
import { driveStep, forwardSpeed, newCar, placeOnTrack, revOf, shiftLightOn } from './physics.ts';
import { carStats, cleanFormulaTune, STOCK_SPEC } from './car.ts';
import { crossesGate } from './road.ts';
import { FORMULA_TRACKS } from './tracks.ts';
import { IDLE_FORMULA_INPUT, type FormulaGhost, type FormulaInput, type FormulaSpec, type FormulaState, type FormulaTimeslip, type FormulaTrack, type FormulaTune, type LapState, type LapTrace } from './types.ts';

/** a new lap: the car on the grid, the lights on */
export function newLapState(track: FormulaTrack, spec: FormulaSpec, tune: Partial<FormulaTune> | null | undefined, laps = 1): FormulaState {
  const car = newCar(carStats(spec, cleanFormulaTune(tune)), track.grid.x, track.grid.y, track.grid.a);
  return { track, car, lap: { phase: 'lights', clock: 0, nextGate: 0, started: false, lapStarts: [], splits: [], lap: 0, laps: Math.max(1, Math.floor(laps)), lapTimes: [], finishedAt: 0, px: car.x, py: car.y, reaction: null, jumpStart: false, topSpeed: 0 } };
}

/** whether the lights are out at this clock (the clock is a sum of steps, so a hair of float error is allowed: 234 steps of 1/60 s are the green) */
export const isGreen = (clock: number): boolean => clock >= LIGHTS.go - 1e-9;
/** the lights lit at this clock (0 to 3): one more every `LIGHTS.gap` seconds, all out at the green */
export const lightsLit = (clock: number): number => (isGreen(clock) ? 0 : Math.max(0, Math.min(LIGHTS.count, Math.floor((clock - (LIGHTS.go - LIGHTS.count * LIGHTS.gap)) / LIGHTS.gap) + 1)));

/** one step of the lap. Pure: the state and the input are left as they were. */
export function stepLap(state: FormulaState, input: Partial<FormulaInput> = IDLE_FORMULA_INPUT, dt: number = FORMULA_DT): FormulaState {
  const lap = state.lap, gasPressed = (input.throttle ?? 0) >= LIGHTS.jumpStartGas;
  let driver: Partial<FormulaInput> = input;
  if (lap.phase === 'finished' || lap.phase === 'timeout') {
    // after the finish the car rolls out, braking, for a few seconds and then stands still
    if (lap.clock - lap.finishedAt >= LAP.rolloutSeconds) return state;
    // (the brake is also reverse here, as in the source game: it is let go once the car has stopped)
    driver = { steer: input.steer, throttle: 0, brake: forwardSpeed(state.car) > LAP.stopSpeed ? LAP.rolloutBrake : 0 };
  } else if (!isGreen(lap.clock)) {
    // the car is held until the green: nothing the driver does moves it (a gas press is a jump start)
    driver = IDLE_FORMULA_INPUT;
  }
  const clock = lap.clock + dt, car = driveStep(state.car, driver, state.track, dt);
  let next: LapState = { ...lap, clock, px: car.x, py: car.y, topSpeed: Math.max(lap.topSpeed, Math.hypot(car.vx, car.vy)) };
  if (lap.phase === 'lights' || lap.phase === 'racing') {
    if (lap.reaction === null && gasPressed) next = { ...next, reaction: +(lap.clock - LIGHTS.go).toFixed(4), jumpStart: !isGreen(lap.clock) };
    else if (!isGreen(lap.clock) && gasPressed && !lap.jumpStart) next = { ...next, jumpStart: true };
    if (lap.phase === 'lights' && isGreen(clock)) next = { ...next, phase: 'racing' };
    next = crossGates(state.track, next, lap, car.x, car.y);
    if (next.phase === 'racing' && clock - LIGHTS.go > LAP.maxSeconds) next = { ...next, phase: 'timeout', finishedAt: clock };
  }
  return { track: state.track, car, lap: next };
}
/** the gate the car has to cross next: crossing it in order is the lap (the first crossing of the start line starts the lap, the next crossing of it is the finish) */
function crossGates(track: FormulaTrack, lap: LapState, before: LapState, x: number, y: number): LapState {
  const gate = track.gates[lap.nextGate]; if (!gate || !crossesGate(gate, before.px, before.py, x, y)) return lap;
  const gates = track.gates.length, clock = lap.clock;
  if (lap.nextGate === 0 && !lap.started) return { ...lap, started: true, nextGate: gates > 1 ? 1 : 0, lapStarts: [...lap.lapStarts, clock], splits: [...lap.splits, []] };
  const index = lap.splits.length - 1, since = clock - (lap.lapStarts[index] as number), splits = lap.splits.map((s, i) => (i === index ? [...s, since] : s));
  if (lap.nextGate === 0) {
    // the finish line: the lap is done; the next one (if there is one) starts at the same moment
    const lapTimes = [...lap.lapTimes, since], done = lap.lap + 1;
    if (done >= lap.laps) return { ...lap, splits, lapTimes, lap: done, phase: 'finished', finishedAt: clock, started: false, nextGate: 0 };
    return { ...lap, splits: [...splits, []], lapTimes, lap: done, lapStarts: [...lap.lapStarts, clock], nextGate: gates > 1 ? 1 : 0 };
  }
  return { ...lap, splits, nextGate: (lap.nextGate + 1) % gates };
}

/** the timeslip of the lap run so far (or of the lap you ask for: 0 is the first, the ranked one) */
export function timeslipOf(state: FormulaState, lapIndex = 0): FormulaTimeslip {
  const lap = state.lap, done = lapIndex < lap.lapTimes.length, splits = (lap.splits[lapIndex] ?? []).map(t => +t.toFixed(3)), start = lap.lapStarts[lapIndex];
  const sectors = splits.map((t, i) => +(t - (i ? (splits[i - 1] as number) : 0)).toFixed(3));
  return {
    trackId: state.track.id, finished: done, valid: done && !lap.jumpStart, jumpStart: lap.jumpStart, reaction: lap.reaction, lapTime: done ? +(lap.lapTimes[lapIndex] as number).toFixed(3) : 0, splits, sectors,
    launchTime: start === undefined ? 0 : +(start - LIGHTS.go).toFixed(3), topSpeed: +(lap.topSpeed * 3.6).toFixed(1), wallHits: state.car.wallHits,
  };
}

/** what the picture and the autopilot see: plain numbers, nothing they could change */
export interface FormulaView {
  track: FormulaTrack; phase: LapState['phase'];
  /** seconds since the lights came on, and since the green (negative before it) */ clock: number; raceTime: number;
  /** the lights lit (0 to 3) and whether the lights have gone out */ lights: number; green: boolean;
  car: { x: number; y: number; a: number; speed: number; kmh: number; forward: number; gear: number; rev: number; shiftLight: boolean; nitroT: number; nitroLeft: number; throttle: number; brake: number; steer: number; wallHit: number; wallHits: number; manual: boolean };
  /** the lap on the clock (seconds since the start line; 0 before it), the sector the car is in (1 to the number of gates) and how many there are, the times at the gates so far this lap, and the time at the last one */
  lapClock: number; sector: number; sectors: number; splits: number[]; lastSplit: number | null;
  /** seconds from the green to the first gas (null before it) and whether the start was jumped */ reaction: number | null; jumpStart: boolean; topSpeed: number;
  finished: boolean; timeslip: FormulaTimeslip;
  /** the ghost car (null: no ghost), and how far behind it you are in seconds at this place on the track (negative: ahead; null: no ghost or not on the lap yet) */ ghost: GhostPose | null; ghostDelta: number | null;
}

/** the view of a state (see `FormulaView`) */
export function viewOf(state: FormulaState, ghost: FormulaGhost | null = null): FormulaView {
  const { car, lap, track } = state, speed = Math.hypot(car.vx, car.vy), shown = lap.phase === 'finished' ? 0 : Math.max(0, lap.splits.length - 1);
  const splits = lap.splits[shown] ?? [], start = lap.lapStarts[shown], running = lap.started || lap.phase === 'finished';
  const lapClock = lap.phase === 'finished' ? (lap.lapTimes[0] as number) : lap.started && start !== undefined ? lap.clock - start : 0;
  const raceTime = lap.clock - LIGHTS.go, pose = ghost ? ghostPose(ghost, track, Math.max(0, raceTime)) : null;
  let ghostDelta: number | null = null;
  if (ghost && raceTime > 0 && lap.phase === 'racing') { const raw = placeOnTrack(track, car.x, car.y, track.length / 2).along, along = lap.started || raw < track.length / 2 ? raw : raw - track.length; ghostDelta = +(raceTime - ghostTimeAt(ghost, along)).toFixed(3); }
  return {
    track, phase: lap.phase, clock: lap.clock, raceTime, lights: lightsLit(lap.clock), green: isGreen(lap.clock),
    car: { x: car.x, y: car.y, a: car.a, speed, kmh: Math.round(speed * 3.6), forward: forwardSpeed(car), gear: car.gear, rev: revOf(car), shiftLight: shiftLightOn(car), nitroT: car.nitroT, nitroLeft: car.nitroLeft, throttle: car.throttle, brake: car.brake, steer: car.steer, wallHit: car.wallHit, wallHits: car.wallHits, manual: car.stats.gearbox === 'manual' },
    lapClock, sector: Math.min(track.gates.length, running ? splits.length + 1 : 1), sectors: track.gates.length, splits: [...splits], lastSplit: splits.length ? (splits[splits.length - 1] as number) : null,
    reaction: lap.reaction, jumpStart: lap.jumpStart, topSpeed: lap.topSpeed, finished: lap.phase === 'finished', timeslip: timeslipOf(state), ghost: pose, ghostDelta,
  };
}

export interface FormulaRaceOptions { track?: FormulaTrack; spec?: FormulaSpec; tune?: Partial<FormulaTune> | null; /** laps to run: a race is one; the racing line is worked out over two */ laps?: number; ghost?: FormulaGhost | null }
/** a race you hold on to: `step(input)` runs one fixed step, `view()` is what to draw, `timeslip()` the result so far, `trace()` the lap recorded so far (see ghost.ts `ghostFromLap`) */
export function createFormulaRace(opts: FormulaRaceOptions = {}) {
  const track = opts.track ?? (FORMULA_TRACKS[0] as FormulaTrack), spec = opts.spec ?? STOCK_SPEC, ghost = opts.ghost && opts.ghost.trackId === track.id ? opts.ghost : null;
  let state = newLapState(track, spec, opts.tune, opts.laps ?? 1), alongNow = placeOnTrack(track, state.car.x, state.car.y).along;
  const recorded: LapTrace = { step: TRACE.step, s: [], o: [], v: [] };
  /** one sample of the trace every TRACE.step seconds from the green, until the first lap is done */
  function record(): void {
    const t = state.lap.clock - LIGHTS.go; if (t < -1e-9 || state.lap.lap > 0 || state.lap.phase === 'timeout') return;
    while (recorded.s.length * TRACE.step <= t + 1e-9) {
      const place = placeOnTrack(track, state.car.x, state.car.y, alongNow); alongNow = place.along;
      recorded.s.push(Math.round(place.along * 10)); recorded.o.push(Math.round(place.across * 10)); recorded.v.push(Math.round(Math.hypot(state.car.vx, state.car.vy) * 10));
    }
  }
  return {
    get state(): FormulaState { return state; },
    track, spec, ghost,
    step(input: Partial<FormulaInput> = IDLE_FORMULA_INPUT): void { state = stepLap(state, input); record(); },
    view(): FormulaView { return viewOf(state, ghost); },
    timeslip(lapIndex = 0): FormulaTimeslip { return timeslipOf(state, lapIndex); },
    /** the lap trace recorded so far (a copy) */
    trace(): LapTrace { return { step: recorded.step, s: [...recorded.s], o: [...recorded.o], v: [...recorded.v] }; },
    /** whether the lap (or all the laps asked for) is over: finished or timed out */
    get over(): boolean { return state.lap.phase === 'finished' || state.lap.phase === 'timeout'; },
  };
}
export type FormulaRace = ReturnType<typeof createFormulaRace>;
