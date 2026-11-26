// Every number that decides how Formula drives, in one place. Distances are in metres, times in seconds, speeds in metres per second.
// These are Chromium Halo: Neon's arena numbers (src/arena/tuning.ts and grip.ts) that its race simulation used, kept at the same values so the lap times agree. Turn BASE first to make every car quicker or slower.

/** the step of the simulation: 60 times a second (the Arena's own step, so the laps match the source game) */
export const FORMULA_DT = 1 / 60;

/** the base car the arena had (before the formula car's parts and tune scale it) */
export const BASE = {
  /** top speed (m/s), pull (m/s2), how fast it turns the wheel (rad/s at lock), and its grip (the base car's) */ vmax: 26, accel: 24, turn: 3.6, grip: 12,
  /** how much of the wheel's turn is lost at top speed, how much a steered tyre gives up sideways grip, the rolling and air drag (per second), and the top speed in reverse as a share of vmax */ turnFade: 0.3, driftSlip: 0.4, drag: 0.12, reverse: 0.45,
  /** the hardest a car brakes when the tyres have grip to spare, and the engine braking when the gas is off (m/s2) */ brake: 42, coast: 6,
  /** the hit circle against the wall (m), and how much the wall pushes back */ radius: 1.1, wallRestitution: 0.3,
  /** the formula car's top speed and pull over the base car's (a stock formula car is a little quicker in a straight line than a garage car) */ vmaxScale: 1.05,
} as const;

/** how the tyres hold (race simulation's grip.ts) */
export const GRIP = {
  /** the sideways acceleration (m/s2) the tyres hold with no downforce, for a car of the base grip */ lateral: 10,
  /** extra grip from downforce: this times the car's aero (0 to about 1.5) times speed squared */ aero: 0.011,
  /** the hardest a car can brake in a straight line (m/s2) */ brake: 30,
  /** the share of its speed a car keeps when it runs into the barrier */ wallKeep: 0.45, /** the speed into the wall (m/s) under which it only slides along it */ wallScrub: 1.5,
  /** a simulation car's top speed and its pull over an arcade car's */ speedUp: 3.2, accelUp: 1.6,
} as const;
/** gravity (m/s2), for the banking */
export const G = 9.81;

/** where each gear of the car ends, as a share of its top speed (seven gears, short at the bottom and long at the top) */
export const GEAR_TOPS = [0.12, 0.26, 0.42, 0.58, 0.73, 0.87, 1.02] as const;
export const GEARS = GEAR_TOPS.length;
/** the manual gearbox's feel: the pull in a gear has a floor (`low`) and best in the upper part of its range, and the limiter cuts it over the last `limiterSpan` of the gear's revs; a higher gear pulls `lowGearBonus` less per gear */
export const GEARBOX = { rev0: 0.12, revSpan: 0.43, floor: 0.35, limiterStart: 0.97, limiterSpan: 0.03, lowGearBonus: 0.05, overTopSlow: 14 } as const;
/** the automatic gearbox: it shifts down when the revs fall under `downRev`, and up at the tune's shift light (see `FormulaTune.shiftLight`) */
export const AUTO_GEARBOX = { downRev: 0.32 } as const;

/** the start: seconds of lights before the green (three lights, one a second, in the last three seconds), and how long the car is held; gas pressed before the green is a jump start */
export const LIGHTS = { go: 3.9, count: 3, gap: 1, jumpStartGas: 0.1 } as const;
/** the lap rules: the longest a lap may take (a stuck car is a DNF), and the seconds the car rolls out after the finish (braking until it stops) */
export const LAP = { maxSeconds: 300, rolloutSeconds: 6, rolloutBrake: 1, stopSpeed: 0.5 } as const;

/** nitro: bottles carried (the tune, 0 to `maxBottles`), seconds each burst lasts, the pull and top speed during it, the seconds before the next bottle may be opened and the share of grip each bottle's weight costs.
 *  Turn `pull` first to make nitro matter more. (The source game's race simulation had no nitro.) */
export const NITRO = { maxBottles: 3, seconds: 2, pull: 1.35, top: 1.06, cooldown: 6, gripPerBottle: 0.012 } as const;

/** the lap trace: one sample every this many seconds from the green (so a lap is a few hundred whole numbers) */
export const TRACE = { step: 0.1 } as const;

/** HOW THE TUNE BENDS THE CAR (src/formula/car.ts `carStats`). Numbers are shares: 0.05 is 5 percent. Turn these first to make the tune matter more or less (docs/CALIBRATION.md, "Tune balance").
 *  The source game's tune was a straight line (tall gears and hard tyres only ever made the lap quicker, up to 7 percent). Here the TOP SPEED of gearing and of tyre pressure follows a curve `top * x - curve * x^2`, so each has a best value inside its range (about +0.4)
 *  and the extremes lose: a gear that is too tall (or a tyre too hard) cannot reach its top speed in the lap. The best tune is then worth about 2 to 3.5 percent of the lap at every score. */
export const TUNE_EFFECT = {
  /** gearing (-1 short .. +1 tall): top speed gained per +1 and the curve that takes it back at the ends; pull lost per +1 (a short gear gives it back) */
  gearingTop: 0.05, gearingCurve: 0.0625, gearingPull: 0.12,
  /** downforce (0..1, neutral 0.5): top speed lost per +1 and grip gained per +1 (as the source) */
  downforceTop: 0.07, downforceGrip: 0.3,
  /** tyre pressure (-1 soft .. +1 hard): top speed gained per +1 and its curve; grip lost per +1 */
  pressureTop: 0.025, pressureCurve: 0.03125, pressureGrip: 0.08,
  /** steering (-1 slow .. +1 quick): turn gained per +1 and grip lost per +1 (as the source; the autopilot's line barely needs the turn, so it is worth under 0.5 percent) */
  steeringTurn: 0.15, steeringGrip: 0.08,
} as const;
