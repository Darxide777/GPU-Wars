// What Formula mode is made of: the track, the car, the tune, the input, the lap and its timeslip, and the ghost. Plain data, so a lap can be copied, compared and replayed.

/** a point on the ground, in metres */
export interface Point { x: number; y: number }

/** a line across the road that the car must cross in order: from the driver's right edge (x1, y1) to the left edge (x2, y2); `a` is the heading you cross it with, `i` the path point it sits on */
export interface Gate { x1: number; y1: number; x2: number; y2: number; a: number; i: number }

/** the middle line of the road (a closed curve, driven clockwise on the screen), how wide it is, the banking (radians) and the height of the road (m) at each path point; a missing list is flat */
export interface Road { path: Point[]; width: number; bank?: number[]; elev?: number[] }

/** where the car stands before the start: on the middle line this many metres behind the start line, this far to the side (a share of the road's width, negative is the driver's left) */
export interface GridSlot { x: number; y: number; a: number }

/** a track as the simulation uses it: built from a `TrackSpec` by `buildTrack` (tracks.ts) */
export interface FormulaTrack {
  id: string; name: string;
  /** the ground colour family the picture uses */ theme: 'speedway';
  /** the size of the ground round the road, metres: the picture draws this box */ w: number; h: number;
  road: Road;
  /** the gates in driving order: the first is the start and finish line, the others are the sector splits */ gates: Gate[];
  /** the standing start place */ grid: GridSlot;
  /** the length of one lap along the middle line, metres */ length: number;
}

/** what the car does this tick. Gas and brake are shares (0 to 1), steer is -1 (left) to 1 (right); a shift is a press (true for the one tick it lands). The page's `DriverInput` fits this shape. */
export interface FormulaInput { throttle: number; brake: number; steer: number; shiftUp: boolean; shiftDown: boolean; nitro: boolean }
export const IDLE_FORMULA_INPUT: Readonly<FormulaInput> = { throttle: 0, brake: 0, steer: 0, shiftUp: false, shiftDown: false, nitro: false };

/** the tune: each setting is a trade. Gearing (-1 short: more pull, less top speed; 1 tall), downforce (0 to 1: grip for top speed), steering (-1 slow and steady to 1 quick and twitchy: turn for grip),
 *  tyre pressure (-1 soft: grip, slower; 1 hard: top speed, less grip), nitro (bottles carried, 0 to 3: a burst of pull each, a little grip lost to the weight), the gearbox (you shift, or it does) and the shift light (the
 *  share of a gear's revs at which the light says shift; an automatic gearbox shifts there too). */
export interface FormulaTune { gearing: number; downforce: number; steering: number; pressure: number; nitro: number; gearbox: 'manual' | 'auto'; shiftLight: number }

/** the car as it comes from the factory: the engine's power (in the old parts' levels, a real number, so the benchmark can set it finely) and the top level of every other part (the old chassis part only changed the hull and mass, which Formula has no use for: no damage) */
export interface FormulaSpec {
  name: string; col: string; trim: string;
  /** the engine, in levels (0 to 8: the formula car's old ENGINE part; fractions and a little under 0 are allowed) */ engine: number;
  /** the other parts, each at its top level (the stock parts) */ gearbox: number; tyres: number; steering: number; aero: number;
}

/** the numbers the driving physics reads, worked out from a spec and a tune (see `carStats`) */
export interface CarStats {
  /** top speed (m/s) and pull (m/s2) */ vmax: number; accel: number;
  /** grip (the base car's is 12), downforce (grip that grows with speed squared) and how fast it turns the wheel */ grip: number; aero: number; turn: number;
  /** the radius of the hit circle against the wall */ radius: number;
  /** nitro bottles and the manual or automatic gearbox */ nitroShots: number; gearbox: 'manual' | 'auto'; shiftLight: number;
}

/** everything about the car that changes during the lap (never mutated: `driveStep` returns a new one) */
export interface FormulaCar {
  stats: CarStats;
  /** where it is (m), which way it points (rad) and its velocity (m/s) */ x: number; y: number; a: number; vx: number; vy: number;
  /** the gear (1 to 7) */ gear: number;
  /** nitro: seconds of burst left, bottles left, and seconds before the next press may start another */ nitroT: number; nitroLeft: number; nitroCd: number;
  /** how hard the last wall hit was (m/s into the wall; 0 for none this tick), and how many times the wall has been hit this lap */ wallHit: number; wallHits: number;
  /** the throttle and brake the driver had last tick (for the picture and the sound) */ throttle: number; brake: number;
  /** the steering the driver had last tick */ steer: number;
}

/** where the lap is: the lights, the clock, the gates and the times */
export type LapPhase = 'lights' | 'racing' | 'finished' | 'timeout';
export interface LapState {
  phase: LapPhase;
  /** seconds since the lights came on (the race clock; the green is at `LIGHTS.go`) */ clock: number;
  /** the gate the car must cross next (0 is the start line before the lap, and again for the finish) and whether it has crossed the start line for the lap it is on */ nextGate: number; started: boolean;
  /** the clock each time the car crossed the start line (one for each lap begun) */ lapStarts: number[];
  /** for each lap begun: the seconds from its start line to each gate (the sector splits; the last of a finished lap is the finish) */ splits: number[][];
  /** laps done and laps to run (a race is one lap; the racing line is worked out over two), and the time of each lap done */ lap: number; laps: number; lapTimes: number[];
  /** the clock at the finish (the car rolls out for a few seconds after it) */ finishedAt: number;
  /** the car's last position (for the gate crossing test) */ px: number; py: number;
  /** seconds from the green to the first gas (negative: gas before the green), null until it comes; a gas pressed before the green is a jump start */ reaction: number | null; jumpStart: boolean;
  /** the fastest the car has gone (m/s) */ topSpeed: number;
}

/** the timeslip of a lap: reaction, the sector splits, the lap time and the top speed */
export interface FormulaTimeslip {
  trackId: string; finished: boolean; valid: boolean; jumpStart: boolean;
  /** seconds from the green to the first gas (null: never) */ reaction: number | null;
  /** seconds from the start line to the finish line (the ranked time; 0 until it is run) */ lapTime: number;
  /** seconds from the start line to each gate (the last one is the finish): the split times */ splits: number[];
  /** the time of each sector (the splits taken apart) */ sectors: number[];
  /** seconds from the green to the start line */ launchTime: number;
  /** the top speed (km/h) and how many times the wall was hit */ topSpeed: number; wallHits: number;
}

/** the whole lap simulation's state (what `stepLap` takes and returns) */
export interface FormulaState { track: FormulaTrack; car: FormulaCar; lap: LapState }

/** the compact lap trace, as saved and sent: every `step` seconds from the green, how far along the lap (decimetres from the start line, negative behind it), how far across the road (decimetres, positive to the driver's right)
 *  and the speed (decimetres per second). All whole numbers, so it stays small as JSON. */
export interface LapTrace { step: number; s: number[]; o: number[]; v: number[] }

/** a ghost: a lap to race against. `trace` is what the picture plays; the times are the leader's own, so the ghost lines up with the timeslip even where the trace is made up. */
export interface FormulaGhost { trackId: string; name: string; reaction: number; /** seconds from the green to the start line */ launchTime: number; lapTime: number; splits: number[]; topSpeed: number; trace: LapTrace }
