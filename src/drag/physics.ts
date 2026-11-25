// A drag race: the tree (three ambers, then green), the launch, an engine with a torque curve and a limiter, gears and the time a shift takes, traction with suspension pitch and
// wheelspin, tire pressure, tire temperature and ballast, aero and rolling drag, nitro, and a blower whose boost spools up with revs and throttle and dips after each shift. Boost, load, revs, clutch slip and time on the line soak heat into the engine and retard the timing instead of cutting grip; the auto driver backs off boost while it is hot. The clutch engages over time, pulls the engine down to the wheels and locks when the rev gap closes, then costs a little drag. It draws nothing and has no clock: step() moves it on by DRAG.dt, the same seed gives the same race.
// You heat the rear tires by holding the brake with the gas on the line, launch with a key on green (before it is a red light), shift up by hand or let the tune shift, and fire the
// nitro by hand or in a set gear. A ghost replays your best pass from saved samples instead of driving a second car.
import { createRng } from '../arena/rng.ts';
import { STOCK_PARTS, DRAG_CARS } from './data.ts';
import { BOOST, CLUTCH, DRIVETRAIN, ENGINE, LIMITS, NITRO, SHIFT_QUALITY, TIRE, defaultTune, limiterTorqueShare, specFor, torqueShape } from './tune.ts';
import type { DragCarDef, DragConditions, DragEvent, DragGhost, DragInput, DragSpec, DragStrip, DragTire, GhostSample, Mark, Runner, Skill, StagePhase, Timeslip, Tune } from './types.ts';

export const DRAG = {
  dt: 1 / 240, g: 9.81, eff: DRIVETRAIN.eff, effRange: [DRIVETRAIN.minEff, DRIVETRAIN.maxEff] as [number, number], driver: 80,
  /** the marks on a timeslip, in metres */ marks: { ft60: 18.288, ft330: 100.584, eighth: 201.168, ft1000: 304.8, trapStart: 402.336 - 20.1168, quarter: 402.336 } as Record<Mark, number>,
  /** the trap speed is the average speed over the last 66 ft (20.1168 m) before the finish, as a real strip times it */ trapWindow: 20.1168,
  /** the tree: green comes between these many seconds after the start, the ambers half a second apart before it */ green: [2.4, 3.4] as [number, number], amberGap: 0.5, stageRollout: 0.45, deepStageRollout: 0.12, stageCreep: 2.2,
  /** the clutch takes this long to bite at the tune's middle launch aggression; revs rise this fast with the gas on and no load; a spinning tire pulls this share of its grip */
  clutch: 0.32, rev: 9000, spinPull: 0.68, maxTime: 45, /** all tires grip this much more than a 1 (so a street car can just about pull a g) */ gripScale: 1.5, /** the engine's flywheel (kg m2): high revs dumped on launch hit the tires harder */ inertia: 0.22, /** once a tire spins it keeps spinning until the drive drops below this share of its grip */ spinHold: 0.8, /** how much grip a psi above or below 28 costs or gains */ pressureGripPerPsi: 0.014,
  /** rear tire temperature (C): cold at the line grips less, the window grips best, a burnout or wheelspin heats them and the air cools them; above the window grip falls toward hotGrip.
   * Turn coldGrip first (how much a cold launch costs), then burnoutHeat/spinHeat, then the window and cool numbers. */
  tire: { ambient: 20, windowLo: 80, windowHi: 110, hot: 180, maxTemp: 260, windowGrip: 1, coldGrip: 0.92, hotGrip: 0.82, spinHeat: 8, spinHeatMax: 2, burnoutHeat: 55, cool: 0.02, airflowCool: 0.002, aiBurnBase: 2.0, aiBurnReact: 2.5, aiBurnMax: 2.2, wearPerSlip: 0.12, wornGrip: 0.85, wearGripFrom: 0.05 },
};
export const FUEL = { capacity: 95, reserve: 10, burnPerJoule: 4e-7, idleBurn: 0.0008, lineBurn: 0.02, torqueFade: 0.06, trimFrom: 0.5, launchTrim: 0.3, shiftTrim: 0.05, loads: [0.25, 0.5, 0.75, 1] } as const;
/** after the line: the strip ends here (about 358 m past the quarter mile), the brakes pull this many g, the chute adds this much drag area (Cd x A, m2), and below this speed the car counts as stopped.
 * Brakes heat with the work they do and cool toward the day; past `brakeFadeFrom` they lose grip down to `brakeFadeMin` at `brakeFadeTo`. The chute opens over `chuteDeploy` seconds instead of at once.
 * Turn `end` first (how much room there is to stop), then `brakeG` (how much the brakes do on their own), then `chuteDeploy`, then `brakeFadeMin`, then `chuteCda`. */
export const SHUTDOWN = { end: 760, brakeG: 1.6, chuteCda: 3.2, stopSpeed: 0.5, brakeHeat: 0.035, brakeCool: 0.3, brakeAirCool: 0.0012, brakeFadeFrom: 140, brakeFadeTo: 400, brakeFadeMin: 0.7, brakeMaxTemp: 600, chuteDeploy: 0.35 } as const;
/** the staging sequence before the green, in metres along the strip (0 is the final beam, the start line; negative is behind it). A car starts `startX` back, rolls into the water box (low grip, wet tires), burns out while moving
 * (heat and rubber come from the slip over distance), runs out past the tree, stops, backs up (slowly, with the reverse light) behind the pre-stage beam, then creeps to the stage beam. The tree stays dark until every live car has held
 * still in final stage for `armHold` seconds. Creeping past the stage beam into `overstageLimit` resets the stage bulb until the car backs out; crossing the final beam before green is a red light.
 * Turn `backupSpeed` first (how long the back up takes), then `burnoutSpeed`, `burnoutDistance` (the auto driver's dry burnout), `runOutPastTree`, then the beam spacing (`preStageRollout`, `overstageLimit`), then `wetGripLoss`. */
export const STAGE = {
  startX: -34, waterBoxStart: -26, waterBoxEnd: -19, burnoutDistance: 5, runOutPastTree: 8,
  /** the pre-stage beam is this far behind the final beam; the stage beam is `DRAG.stageRollout` behind it and deep stage `DRAG.deepStageRollout`; past `overstageLimit` before the final beam the stage bulb resets */
  preStageRollout: 0.8, overstageLimit: 0.05,
  /** how the car moves before the launch: the gas asks for up to `rollMaxSpeed` (m/s) and the car gains `rollAccel` (m/s2), a lifted gas coasts down `coastDecel`, the brake pulls `brakeDecel` */
  rollMaxSpeed: 8, rollAccel: 3, coastDecel: 1.2, brakeDecel: 5,
  /** a burnout rolls forward at `burnoutSpeed` with the rears spinning `burnSlipSpeed` m/s faster than the ground */
  burnoutSpeed: 3.5, burnoutAccel: 4, burnSlipSpeed: 10,
  /** the back up: top reverse speed (m/s) and how fast it gets there */
  backupSpeed: 2, reverseAccel: 1.6,
  /** the speed of a held deep-stage creep (m/s), the speed under which a beam counts, the speed the car is held (trans-brake) in final stage if it arrives slower than this, the speed that counts as stopped, seconds held still before the tree arms */
  creepSpeed: 0.45, beamSpeed: 1.5, catchSpeed: 0.5, stopSpeed: 0.08, armHold: 0.5,
  /** the water box: slick grip lost while the tires are fully wet, the share of burnout heat a wet tire makes, and how much wetness each metre driven (dry) or burned (times `spinDry`) dries */
  wetGripLoss: 0.35, wetHeatShare: 0.25, dryPerMetre: 0.12, spinDry: 2.5,
  /** burnout heat (C) and rubber (0 to 1 per cell) laid for each metre of wheel slip on dry strip */
  heatPerSlipMetre: 5.5, rubberPerMetre: 0.35,
  /** sideways correction while staging: metres per second at full lock and rolling at 1 m/s, and the most the car may be off its lane's middle */
  steerRate: 0.5, maxOffset: 0.9,
  /** the auto driver's staging: the speeds it rolls and backs at, how far past the tree it stops (a little different every seed), and the backup stop behind the pre-stage beam */
  aiApproachSpeed: 5, aiRunOutSpeed: 6, aiRunOutJitter: 3, aiBackupMargin: 0.3, salt: 0x5bd1e995,
  /** a saved ghost keeps this many seconds before the green; the tree gives up waiting for a stage after this long */
  ghostLead: 8, timeout: 150,
} as const;
/** suspension: the body pitches toward a tire-force-based angle through a spring and damper; past `liftPitch` the front tires unload and the car wheelies, up to the wheelie bar.
 * Turn `spring` first (how fast it reacts), then `dampingRatio`, then `spinPitchShare` (how much a spinning tire still lifts) and `liftPitch`/`barStep`. */
export const SUSP = {
  spring: 130, stiffnessStep: 0.035, dampingRatio: 0.72,
  pitchPerG: 0.08, gLimit: 2.6,
  liftPitch: 0.075, maxPitch: 0.18,
  barBase: 0.04, barStep: 0.015,
  steerLift: 0.35, rearShareMax: 0.97, spinPitchShare: 0.55, spinPitchSpeed: 40,
  /** weight transfer: the centre of gravity's height and the wheelbase (m) set how much weight an acceleration moves to the rear (a x height / (g x wheelbase)); `transferGain` scales it, `transferTau` is how slowly the springs let the body carry it (s, at the middle stiffness).
   * Anti-squat is the share of the transfer the rear suspension's links deliver at once (the rest waits for the springs): it grows with the stiffness setting from `antiSquatBase` by `antiSquatPerStep`. Turn `transferGain` first (how much a launch loads the rear). */
  cgHeight: 0.62, wheelbase: 3.2, transferGain: 0.2, transferTau: 0.25, antiSquatBase: 0.35, antiSquatPerStep: 0.06,
} as const;
/** load-sensitive traction: a slick makes less force per added newton of load, and near its slip limit gives less of its grip to turning.
 * Turn `SUSP.spring` first (how fast the axle loads), then `loadExp` (1 is the old linear grip, lower softens the extra grip a wheelie earns),
 * then `slideGrip` for the pull left in a spinning tire, `lateralFloor` for the steering still available while driving, and `slipFall` for the slip curve. */
export const TRACTION = {
  loadExp: 0.85,
  /** slip ratio where a slick gives all its grip, and the slip it takes to fall toward `slideGrip` */
  slipPeak: 0.08, slipFall: 0.35, slideGrip: 0.72,
  /** share of the tires' grip held back for cornering even when they are spinning, and share of that budget spent on yaw */
  lateralFloor: 0.5, lateralUse: 0.85,
  /** how much unrealised turn the lane marker shows */
  understeer: 0.8,
} as const;
/** grip force relative to the reference axle: a loaded axle gains less than its extra load, and an unloaded axle loses less */
export const loadGrip = (load: number, ref: number): number => Math.pow(Math.max(0, load) / Math.max(1, ref), TRACTION.loadExp);
/** the share of a tire's grip left as it slides: full grip up to `slipPeak`, then an exponential fall to `slideGrip` */
export const slipGrip = (ratio: number): number => { const u = Number.isFinite(ratio) ? Math.max(0, ratio) : 0; return u <= TRACTION.slipPeak ? 1 : TRACTION.slideGrip + (1 - TRACTION.slideGrip) * Math.exp(-(u - TRACTION.slipPeak) / TRACTION.slipFall); };
/** grip left for turning once the tire is using `used` of its `grip` to drive: a circle with a floor for the correction still needed at full power */
export const lateralShare = (used: number, grip: number): number => { const u = used / Math.max(1, grip), room = Math.sqrt(Math.max(0, 1 - u * u)); return TRACTION.lateralFloor + (1 - TRACTION.lateralFloor) * room; };
export const CONDITIONS = {
  airRange: [0, 40] as [number, number], trackRange: [10, 60] as [number, number], surfaceGripRange: [0.9, 1.1] as [number, number], gripClamp: [0.85, 1.15] as [number, number],
  /** sea level up to this many metres: turn this first for how thin a seeded day can get */
  altitudeRange: [0, 1500] as [number, number],
  rhoRef: 1.2, refAirC: 20, kelvin: 273.15,
  /** the standard atmosphere's pressure fall with height: lapse (K/m), sea-level temperature (K), pressure exponent */
  lapseKPerM: 0.0065, seaLevelK: 288.15, pressureExponent: 5.25588,
  neutralGrip: 1, trackGripRefC: 35, trackGripPerC: -0.002, trackWarmShare: 0.35, trackWarmRate: 0.008,
  conditionSalt: 0x9e3779b9, altitudeSalt: 0x248f35d9,
  /** the standard atmosphere's sea-level density (kg/m3), the reference for density altitude */ isaRho: 1.225,
} as const;
export const WIND = { headRange: [-10, 10] as [number, number], crossRange: [-4, 4] as [number, number], gustRange: [0, 1.5] as [number, number], headWave: 70, crossWave: 55, headHz: 0.21, crossHz: 0.29, sideYaw: 40, salt: 0x85ebca6b } as const;
/** a seeded weather front crosses the strip during a run: the air, the track and the surface grip move this far from the forecast over `span` seconds, with a small wave on top.
 * Turn `gripRange` first (how much the strip changes under the tires), then `airRange` and `trackRange`, then `span` for how quickly it happens. */
export const WEATHER = { airRange: [-4, 4] as [number, number], trackRange: [-9, 9] as [number, number], gripRange: [-0.08, 0.08] as [number, number], span: 12, hz: 0.17, wave: 0.18, salt: 0x27d4eb2f } as const;
export const GHOST = { step: 0.05, maxSamples: 1200, maxTime: 60 } as const;
export const RUBBER = { cell: 2, gain: 0.1, burnoutLength: 18, burnoutRate: 1.2, spinRate: 0.8, spinWidth: 6 } as const;
export const STRIP_CELLS = Math.ceil((SHUTDOWN.end + 20) / RUBBER.cell) + 1;
export const createDragStrip = (lanes = 2): DragStrip => ({ rubber: Array.from({ length: lanes }, () => [Array.from({ length: STRIP_CELLS }, () => 0), Array.from({ length: STRIP_CELLS }, () => 0)]), version: 0 });
export const cloneDragStrip = (strip: DragStrip): DragStrip => ({ rubber: (strip?.rubber ?? createDragStrip().rubber).map(side => side.map(cells => [...cells])), version: strip?.version ?? 0 });
export const clearDragStrip = (strip: DragStrip): void => { for (const rows of strip?.rubber ?? []) for (const cells of rows) cells.fill(0); if (strip) strip.version++; };
const stripCell = (x: number): number => clamp(Math.floor(Math.max(0, x) / RUBBER.cell), 0, STRIP_CELLS - 1);
export const rubberAt = (strip: DragStrip | undefined, lane: number, side: 0 | 1, x: number): number => {
  const rows = strip?.rubber?.[lane]; if (!rows || !rows[side]) return 0;
  const raw = Math.max(0, x) / RUBBER.cell, i = clamp(Math.floor(raw), 0, STRIP_CELLS - 1), j = Math.min(STRIP_CELLS - 1, i + 1), cells = rows[side] as number[];
  return (cells[i] ?? 0) + ((cells[j] ?? 0) - (cells[i] ?? 0)) * (raw - Math.floor(raw));
};
export const layRubber = (strip: DragStrip | undefined, lane: number, side: 0 | 1, x0: number, x1: number, amount: number): void => {
  const rows = strip?.rubber?.[lane]; if (!rows || !rows[side] || !(amount > 0)) return;
  const cells = rows[side] as number[], a = stripCell(Math.min(x0, x1)), b = stripCell(Math.max(x0, x1)); let changed = false;
  for (let i = a; i <= b; i++) { const next = clamp((cells[i] ?? 0) + amount, 0, 1); if (next !== cells[i]) { cells[i] = next; changed = true; } }
  if (changed) strip!.version++;
};
export const rubberShare = (strip: DragStrip | undefined, lane: number): number => {
  const rows = strip?.rubber?.[lane]; if (!rows) return 0;
  const cells = Math.min(STRIP_CELLS, Math.ceil(RUBBER.burnoutLength / RUBBER.cell)); let sum = 0, n = 0;
  for (const side of rows) for (let i = 0; i < cells; i++) { sum += side[i] ?? 0; n++; }
  return n ? sum / n : 0;
};
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
/** the pedal position, repaired for old callers that used a boolean or left it missing */
export const throttleOf = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? clamp(n, 0, 1) : 0; };
/** the clutch pedal position: 1 released/engaged, 0 pedal in/disengaged; missing means automatic */
export const clutchOfInput = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? clamp(n, 0, 1) : null; };
/** how much braking is left at a brake temperature: full when cold, down to `brakeFadeMin` once the brakes soak past `brakeFadeTo` */
export const brakeFadeOf = (temp: number): number => { const t = SHUTDOWN, v = Number.isFinite(temp) ? temp : t.brakeFadeFrom; return clamp(1 - (v - t.brakeFadeFrom) / (t.brakeFadeTo - t.brakeFadeFrom) * (1 - t.brakeFadeMin), t.brakeFadeMin, 1); };
/** the requested boost limit, repaired for an old or broken tune */
export const boostLimitOf = (tu: Tune): number => clamp(Number.isFinite(tu.boostLimit) ? tu.boostLimit : BOOST.defaultLimit, BOOST.minLimit, BOOST.maxLimit);
/** the share of the boost risk that this tune asks for: none at the safe limit, full at the maximum */
export const boostRisk = (tu: Tune): number => clamp((boostLimitOf(tu) - BOOST.safeLimit) / BOOST.riskSpan, BOOST.minLimit, BOOST.maxLimit);
/** how much torque the timing retard takes away at an engine temperature: none until it soaks past `heatFadeFrom`, then a straight fade to `heatFade` */
export const boostRetardAt = (temp: number): number => BOOST.heatFade * clamp((temp - BOOST.heatFadeFrom) / Math.max(1, BOOST.heatMax - BOOST.heatFadeFrom), 0, 1);
/** how far into the hot range an engine is: none at `heatFadeFrom`, full at `heatMax` */
export const engineHotShare = (temp: number): number => clamp((Number.isFinite(temp) ? temp - BOOST.heatFadeFrom : 0) / Math.max(1, BOOST.heatMax - BOOST.heatFadeFrom), 0, 1);
/** the auto driver's wastegate: past `aiTrimFrom` of the hot range it asks for less charge, so a hot run still tracks instead of cooking the engine */
export const engineTrim = (r: Runner): number => { const sense = clamp(Number.isFinite(r.ai?.heatSense) ? r.ai!.heatSense! : 0, 0, 1), hot = clamp((engineHotShare(r.engineTemp) - BOOST.aiTrimFrom) / Math.max(1e-9, 1 - BOOST.aiTrimFrom), 0, 1); return 1 - sense * BOOST.aiTrim * hot; };
/** bottle pressure: the charge left, helped or hurt by the bottle's temperature against the reference day */
export const bottlePressure = (r: Runner): number => { const charge = r.spec.nitroSecs > 0 ? clamp(Number.isFinite(r.nitroLeft) ? r.nitroLeft : 0, 0, r.spec.nitroSecs) / r.spec.nitroSecs : 0, temp = Number.isFinite(r.nitroTemp) ? r.nitroTemp : NITRO.refTempC; return clamp(charge * (1 + (temp - NITRO.refTempC) * NITRO.pressurePerC), 0, 1); };
/** the torque share the tune's shot actually gives now: full above `NITRO.taperFrom` pressure, fading to `NITRO.taperShare` as the bottle empties */
export const nitroShotGain = (r: Runner): number => { const p = bottlePressure(r), taper = p >= NITRO.taperFrom ? 1 : NITRO.taperShare + (1 - NITRO.taperShare) * p / NITRO.taperFrom, shot = Number.isFinite(r.tune.nitroShot) ? clamp(r.tune.nitroShot, 0, LIMITS.nitroShot[1]) : 0; return shot * taper; };
export const gearEfficiency = (sp: DragSpec, gear: number): number => clamp(sp.gearEff?.[gear - 1] ?? DRAG.eff, DRAG.effRange[0], DRAG.effRange[1]);
export const clutchBiteTime = (tu: Tune): number => DRAG.clutch * (1 + (CLUTCH.aggressionMid - clamp(tu.launchAggression, CLUTCH.aggressionMin, CLUTCH.aggressionMax)) * CLUTCH.biteStep);
export const clutchTorqueShare = (tu: Tune, sp: DragSpec): number => clamp(sp.clutchShare * (CLUTCH.aggressionShareLow + clamp(tu.launchAggression, CLUTCH.aggressionMin, CLUTCH.aggressionMax) * CLUTCH.aggressionShareStep), CLUTCH.shareMin, CLUTCH.shareMax);
export const clutchTorqueScale = (r: Runner): number => { const heat = clamp((r.clutchTemp - CLUTCH.fadeFrom) / Math.max(1, CLUTCH.maxTemp - CLUTCH.fadeFrom), 0, 1); const condition = clamp(r.clutchCondition, CLUTCH.minCondition, 1); const worn = CLUTCH.minConditionTorque + (1 - CLUTCH.minConditionTorque) * (condition - CLUTCH.minCondition) / Math.max(1e-9, 1 - CLUTCH.minCondition); return (1 - CLUTCH.fadeTorque * heat) * worn; };
export function clutchAfterRun(r: Runner): number { const hot = clamp((r.clutchPeakTemp - CLUTCH.wearHotTemp) / Math.max(1, CLUTCH.maxTemp - CLUTCH.wearHotTemp), 0, 1); const wear = (CLUTCH.wearPerRun + r.clutchSlip * CLUTCH.wearPerSlipSecond + hot * CLUTCH.wearPerHotLaunch) / Math.max(1, r.spec.clutchWearResist); return clamp(r.clutchCondition - wear, CLUTCH.minCondition, 1); }
export const fuelShareOf = (kg: number): number => { const f = FUEL, v = Number.isFinite(kg) ? kg : f.capacity; return clamp((v - f.reserve) / (f.capacity - f.reserve), 0, 1); };
export const fuelShare = (r: Runner): number => fuelShareOf(r.fuel);
export const fuelMass = (kg: number): number => FUEL.reserve + fuelShareOf(kg) * (FUEL.capacity - FUEL.reserve);
export const fuelKg = (share: number): number => FUEL.reserve + clamp(Number.isFinite(share) ? share : 1, 0, 1) * (FUEL.capacity - FUEL.reserve);
export const fuelTorqueShare = (r: Runner): number => 1 - FUEL.torqueFade * (1 - fuelShare(r));
export const fuelTrim = (r: Runner): number => Math.max(0, (1 - fuelShare(r)) / (1 - FUEL.trimFrom));
export const runnerMass = (r: Pick<Runner, 'spec' | 'tune' | 'fuel'>): number => r.spec.mass + r.tune.ballast + DRAG.driver - (FUEL.capacity - fuelMass(r.fuel));
/** the share of the car's weight on its rear wheels when it is sitting still */
export const staticRearShare = (sp: DragSpec, tu: Tune, fuel: number = FUEL.capacity): number => { const burned = FUEL.capacity - fuelMass(fuel); return (sp.rearKg + sp.rear * DRAG.driver + tu.ballast - burned) / (sp.mass + tu.ballast + DRAG.driver - burned); };
/** the body angle the wheelie bar lets the nose reach: longer bar, higher limit */
export const wheelieBarLimit = (tu: Tune): number => Math.min(SUSP.maxPitch, SUSP.barBase + SUSP.barStep * (clamp(tu.wheelieBar, LIMITS.wheelieBar[0], LIMITS.wheelieBar[1]) - LIMITS.wheelieBar[0]));
export const airDensity = (airC: number, altitude = 0): number => { const c = CONDITIONS, t = Number.isFinite(airC) ? clamp(airC, c.airRange[0], c.airRange[1]) : c.refAirC, h = Number.isFinite(altitude) ? clamp(altitude, c.altitudeRange[0], c.altitudeRange[1]) : 0, pressure = Math.pow((c.seaLevelK - c.lapseKPerM * h) / c.seaLevelK, c.pressureExponent); return c.rhoRef * (c.refAirC + c.kelvin) / (t + c.kelvin) * pressure; };
/** the altitude (m) at which the standard atmosphere has this air density: the "density altitude" a driver talks about. Hot and thin air gives a high one. */
export const densityAltitudeOf = (rho: number): number => { const c = CONDITIONS, r = Number.isFinite(rho) && rho > 0 ? rho : c.rhoRef; return (c.seaLevelK / c.lapseKPerM) * (1 - Math.pow(r / c.isaRho, 1 / (c.pressureExponent - 1))); };
/** the share of its sea-level-reference torque an engine makes in this air: a naturally aspirated one follows the density (to `ENGINE.densityTorqueExp`), and a blower with some charge makes up part of the shortfall (but heats the engine for it, see `BOOST.chargeHeatPerComp`) */
export const densityTorqueShare = (rho: number, charge = 0, cap = 0): number => { const ratio = clamp((Number.isFinite(rho) ? rho : CONDITIONS.rhoRef) / CONDITIONS.rhoRef, 0.5, 1.5), base = Math.pow(ratio, ENGINE.densityTorqueExp), made = cap > 0 ? clamp(charge, 0, 1) * BOOST.densityCompensation : 0; return base >= 1 ? base : base + (1 - base) * made; };
export const trackGrip = (trackC: number): number => { const c = CONDITIONS, t = Number.isFinite(trackC) ? clamp(trackC, c.trackRange[0], c.trackRange[1]) : c.trackGripRefC; return c.neutralGrip + (t - c.trackGripRefC) * c.trackGripPerC; };
export const tireTarget = (cond: DragConditions): number => cond.airC + (cond.trackC - cond.airC) * CONDITIONS.trackWarmShare;
export const windText = (cond: DragConditions): string => Number.isFinite(cond.headwind) && Number.isFinite(cond.crosswind) && Number.isFinite(cond.gust) ? ` WIND H${cond.headwind >= 0 ? '+' : ''}${cond.headwind.toFixed(1)} X${cond.crosswind >= 0 ? '+' : ''}${cond.crosswind.toFixed(1)} G${cond.gust.toFixed(1)}` : '';
export const conditionsText = (cond: DragConditions): string => { const alt = Number.isFinite(cond.altitude) ? cond.altitude as number : 0; return `AIR ${Math.round(cond.airC)}C  ALT ${Math.round(alt)}M  RHO ${cond.rho.toFixed(2)}  TRACK ${Math.round(cond.trackC)}C  GRIP ${cond.grip.toFixed(2)}  DA ${Math.round(densityAltitudeOf(cond.rho))}M${windText(cond)}`; };
/** the conditions at a time in the run: a front moves the seeded forecast, and the air density follows the new air temperature at the strip's altitude. Old conditions with no front stay as they are. */
export function conditionsAt(t: number, cond: DragConditions): DragConditions {
  const w = cond.weather; if (!w) return cond;
  const time = Number.isFinite(t) ? t : 0, front = clamp(time / WEATHER.span, 0, 1);
  const phase = Number.isFinite(w.phase) ? w.phase : 0, share = clamp(front * (1 + WEATHER.wave * Math.sin(time * WEATHER.hz + phase)), 0, 1);
  const airC = cond.airC + (Number.isFinite(w.air) ? w.air : 0) * share;
  const trackC = cond.trackC + (Number.isFinite(w.track) ? w.track : 0) * share;
  const grip = clamp(cond.grip + (Number.isFinite(w.grip) ? w.grip : 0) * share, CONDITIONS.gripClamp[0], CONDITIONS.gripClamp[1]);
  return { ...cond, airC, rho: airDensity(airC, cond.altitude), trackC, grip };
}
const signed = (v: number, digits: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`;
/** what the forecast says will change during the run; shown on the tune and 3D signs as well as the HUD */
export const weatherText = (cond: DragConditions): string => { const w = cond.weather; return w ? ` FRONT AIR ${signed(w.air, 0)}C TRACK ${signed(w.track, 0)}C GRIP ${signed(w.grip, 2)}` : ''; };
export const forecastText = (cond: DragConditions): string => conditionsText(cond) + weatherText(cond);
export const chuteOpening = (r: Pick<Runner, 'chute' | 'aborted' | 'chuteOpen'>): number => !r.chute && !r.aborted ? 0 : Number.isFinite(r.chuteOpen) ? clamp(r.chuteOpen, 0, 1) : 1;
export function windAt(x: number, t: number, cond: DragConditions): { head: number; cross: number } {
  const w = WIND, head = Number.isFinite(cond.headwind) ? cond.headwind : 0, cross = Number.isFinite(cond.crosswind) ? cond.crosswind : 0, gust = Number.isFinite(cond.gust) ? cond.gust : 0;
  const hp = Number.isFinite(cond.headPhase) ? cond.headPhase : 0, cp = Number.isFinite(cond.crossPhase) ? cond.crossPhase : 0;
  return { head: head + gust * (0.65 * Math.sin(x / w.headWave + hp) + 0.35 * Math.sin(t * w.headHz + hp * 1.7)), cross: cross + gust * (0.7 * Math.sin(x / w.crossWave + cp) + 0.3 * Math.sin(t * w.crossHz + cp * 1.3)) };
}
export function conditionsForSeed(seed: number): DragConditions {
  const c = CONDITIONS, w = WIND, q = createRng((seed ^ c.conditionSalt) >>> 0), wq = createRng((seed ^ w.salt) >>> 0), fq = createRng((seed ^ WEATHER.salt) >>> 0), bq = createRng((seed ^ c.altitudeSalt) >>> 0);
  const airC = q.range(c.airRange[0], c.airRange[1]), trackC = q.range(c.trackRange[0], c.trackRange[1]), surface = q.range(c.surfaceGripRange[0], c.surfaceGripRange[1]), altitude = bq.range(c.altitudeRange[0], c.altitudeRange[1]);
  const headwind = wq.range(w.headRange[0], w.headRange[1]), crosswind = wq.range(w.crossRange[0], w.crossRange[1]), gust = wq.range(w.gustRange[0], w.gustRange[1]), headPhase = wq.range(0, Math.PI * 2), crossPhase = wq.range(0, Math.PI * 2);
  const weather = { air: fq.range(WEATHER.airRange[0], WEATHER.airRange[1]), track: fq.range(WEATHER.trackRange[0], WEATHER.trackRange[1]), grip: fq.range(WEATHER.gripRange[0], WEATHER.gripRange[1]), phase: fq.range(0, Math.PI * 2) };
  return { airC, altitude, trackC, grip: clamp(surface * trackGrip(trackC), c.gripClamp[0], c.gripClamp[1]), rho: airDensity(airC, altitude), headwind, crosswind, gust, headPhase, crossPhase, weather };
}
/** the automatic driver for your car (DRIVER: AUTO): a steady, decent reaction, never early, and every shift exactly on the tune's shift point */
/** steering and staying in your lane: the wheelbase and half the rear track (m), the steering lock at rest and how it narrows with speed, how fast the car settles to the turn the
 * steering asks for, how far the car's middle can be from its lane's before the tires touch a line (m), how much more grip the left rear has when the engine's torque lifts the right,
 * how much the rubber on the strip varies under each wheel, how strongly the strip's ruts steer a car at speed (rad/s2), the speed a touch of the wall takes and how much more it scrubs while you stay on it (a share, and a share per second) */
export const LANE = { base: 2.7, track: 0.75, lock: 0.12, lockFall: 6, settle: 5, limit: 1.3, torqueBias: 0.05, rubber: 0.04, rut: 0.035, wallHit: 0.05, wallScrub: 0.3, yawGain: 0.4 };
export const AUTO_DRIVER: Skill = { react: 0.25, spread: 0.03, shiftErr: 0, foul: 0, fuelSense: 1, heatSense: BOOST.aiSense, deepStage: true };
/** the automatic driver keeps its foot down unless a tire is spinning or the limiter is biting, then eases off until the car hooks up again */
export const autoThrottle = (r: Pick<Runner, 'finished' | 'spin' | 'limiter'>): number => r.finished ? 0 : clamp(r.spin ? ENGINE.ai.spinLift : r.limiter ? ENGINE.ai.limitLift : 1, ENGINE.ai.min, 1);
/** the automatic driver modulates the clutch: in while staged/burnout/shifting, then released over the tune's bite time once launched */
export const autoClutch = (r: Pick<Runner, 'launched' | 'launchT' | 'shiftT' | 'finished' | 'burnout' | 'tune'>, t: number): number => {
  if (r.finished || !r.launched) return 0;
  if (r.shiftT > 0) return 0;
  return clamp((t - r.launchT) / clutchBiteTime(r.tune), 0, 1);
};
export const stageRolloutTime = (deep = false): number => (deep ? DRAG.deepStageRollout : DRAG.stageRollout) / Math.max(0.01, DRAG.stageCreep);
const MARK_ORDER: Mark[] = ['ft60', 'ft330', 'eighth', 'ft1000', 'trapStart', 'quarter'];
const NO_INPUT: DragInput = { throttle: 0, launch: false, shiftUp: false, nitro: false, burnout: false, brake: false, chute: false, deepStage: false, steer: 0 };
export interface Entrant { name: string; spec: DragSpec; tune: Tune; ai?: Skill | null; clutchCondition?: number; fuel?: number; /** engine temperature at the start of this run (C); missing means the day's air */ engineTemp?: number; ghost?: DragGhost }

const ghostNum = (v: unknown, lo: number, hi: number, fallback = 0): number => { const n = Number(v); return Number.isFinite(n) ? clamp(n, lo, hi) : fallback; };
const ghostMarks = (raw: unknown): Partial<Record<Mark, number>> => { const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}, out: Partial<Record<Mark, number>> = {}; for (const m of MARK_ORDER) { const v = Number(r[m]); if (Number.isFinite(v) && v > 0 && v < GHOST.maxTime) out[m] = +v.toFixed(3); } return out; };
export function cleanDragGhost(raw: unknown): DragGhost | null {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, any> : {}, marks = ghostMarks(r.marks), quarter = marks.quarter;
  if (quarter === undefined || !Array.isArray(r.samples)) return null;
  const rawSamples = r.samples.slice(0, GHOST.maxSamples * 2), keep = rawSamples.length > GHOST.maxSamples ? Math.ceil(rawSamples.length / GHOST.maxSamples) : 1;
  const samples: GhostSample[] = [];
  for (const [i, s] of rawSamples.entries()) {
    if (i % keep !== 0 && i !== rawSamples.length - 1) continue;
    const v = s && typeof s === 'object' ? s as Record<string, unknown> : {}, t = ghostNum(v.t, -GHOST.maxTime, GHOST.maxTime, NaN);
    if (!Number.isFinite(t)) continue;
    samples.push({ t: +t.toFixed(3), x: +ghostNum(v.x, -20, SHUTDOWN.end + 20).toFixed(3), y: +ghostNum(v.y, -4, 4).toFixed(3), psi: +ghostNum(v.psi, -1, 1).toFixed(4), v: +ghostNum(v.v, 0, 200).toFixed(3) });
  }
  samples.sort((a, b) => a.t - b.t);
  if (samples.length < 2) return null;
  const reaction = ghostNum(r.reaction, -9, 9), trap = ghostNum(r.trap, 0, 500), total = ghostNum(r.total, 0, GHOST.maxTime, reaction + quarter);
  if (!(total > 0)) return null;
  return { car: typeof r.car === 'string' ? r.car.slice(0, 20) : 'streeter', name: typeof r.name === 'string' ? r.name.slice(0, 20) : 'BEST PASS', reaction, marks, trap, total: +total.toFixed(3), samples, ...(r.deepStage === true ? { deepStage: true } : {}) };
}
export function ghostFromRunner(r: Runner, greenAt: number, car: string): DragGhost | null {
  const q = r.marks.quarter;
  if (!r.finished || r.foul || r.crossed || r.aborted || r.crashed || r.reaction === null || r.reaction < 0 || q === undefined) return null;
  const end = greenAt + q + 0.1, raw = r.trace.filter(s => s.t >= greenAt - STAGE.ghostLead && s.t <= end);
  if (raw.length < 2) return null;
  const keep = raw.length > GHOST.maxSamples ? Math.ceil(raw.length / GHOST.maxSamples) : 1, samples: GhostSample[] = [];
  for (const [i, s] of raw.entries()) {
    if (i % keep !== 0 && i !== raw.length - 1) continue;
    samples.push({ t: +(s.t - greenAt).toFixed(3), x: +s.x.toFixed(3), y: +s.y.toFixed(3), psi: +s.psi.toFixed(4), v: +s.v.toFixed(3) });
  }
  return cleanDragGhost({ car, name: 'BEST PASS', reaction: r.reaction, marks: r.marks, trap: r.trap, total: r.reaction + q, samples, deepStage: r.deepStage });
}

/** the pressure a tire really runs once it is hot: the cold pressure you set plus `TIRE.psiPerC` for every degree C above the day's air */
export const hotPressure = (coldPsi: number, tireC: number, airC: number = DRAG.tire.ambient): number => coldPsi + Math.max(0, (Number.isFinite(tireC) ? tireC : airC) - airC) * TIRE.psiPerC;
/** the grip a tire has at a HOT pressure: the same straight slope as before above the optimum's flat top (`TIRE.refHotPsi` hot gives 1, so the default 28 psi cold, about 31 hot, is a little over-inflated), a flat top of `TIRE.psiWindow` at `optimalHotPsi`, and a steeper fall below it as the tire squirms */
export const pressureGrip = (hotPsi: number): number => { const t = TIRE, top = 1 + DRAG.pressureGripPerPsi * (t.refHotPsi - (t.optimalHotPsi + t.psiWindow)); return hotPsi >= t.optimalHotPsi + t.psiWindow ? 1 + DRAG.pressureGripPerPsi * (t.refHotPsi - hotPsi) : hotPsi >= t.optimalHotPsi ? top : top - t.underSlope * (t.optimalHotPsi - hotPsi); };
/** the grip a rear tire has at a temperature: a straight climb from cold to the window, flat across it, then a straight fall to hotGrip. Multiplies with pressureGrip. */
export function tireGrip(temp: number, airC = DRAG.tire.ambient): number {
  const t = DRAG.tire, c = Number.isFinite(temp) ? temp : airC;
  if (c <= t.windowLo) return t.coldGrip + (t.windowGrip - t.coldGrip) * Math.max(0, Math.min(1, (c - airC) / Math.max(1, t.windowLo - airC)));
  if (c <= t.windowHi) return t.windowGrip;
  return t.windowGrip + (t.hotGrip - t.windowGrip) * Math.min(1, (c - t.windowHi) / Math.max(1, t.hot - t.windowHi));
}
export const wearGrip = (wear: number): number => { const w = clamp(Number.isFinite(wear) ? wear : 0, 0, 1), from = DRAG.tire.wearGripFrom; return 1 - (1 - DRAG.tire.wornGrip) * (from >= 1 ? 0 : clamp((w - from) / (1 - from), 0, 1)); };
function syncTires(r: Runner, fallback: number): void {
  const [l, right] = r.tires, mean = l && right && Number.isFinite(l.temp) && Number.isFinite(right.temp) ? (l.temp + right.temp) / 2 : NaN;
  if (!l || !right || !Number.isFinite(mean)) {
    const temp = Number.isFinite(r.tireTemp) ? r.tireTemp : fallback;
    r.tires = [{ temp, wear: 0 }, { temp, wear: 0 }];
  } else if (Number.isFinite(r.tireTemp) && Math.abs(r.tireTemp - mean) > 1e-9) {
    const delta = r.tireTemp - mean; l.temp += delta; right.temp += delta;
  }
  for (const w of r.tires) w.wear = clamp(Number.isFinite(w.wear) ? w.wear : 0, 0, 1);
  r.tireTemp = (r.tires[0]!.temp + r.tires[1]!.temp) / 2;
}
/** and how much it drags rolling: lower rolls heavier */ export const rollingDrag = (psi: number): number => 0.013 * (1 + (28 - psi) * 0.025);
/** how many full-shot seconds of nitro a shot uses per second */ const burn = (spec: DragSpec, shot: number): number => (spec.nitroMax > 0 ? shot / spec.nitroMax : 1);
/** engine revs when the wheels turn at speed v in a gear */ export const wheelRpm = (v: number, ratio: number, final: number, tire: number): number => (v / tire) * ratio * final * 60 / (2 * Math.PI);

/** the stage's names as shown on the HUD */
export const STAGE_LABELS: Record<StagePhase, string> = { waterBoxApproach: 'WATER BOX', burnout: 'BURNOUT', runOut: 'RUN OUT', backup: 'BACK UP', preStage: 'PRE-STAGE', staged: 'STAGED', deepStaged: 'DEEP STAGED', rolling: 'ROLLING', launched: '' };
/** the words for where a car is in the staging sequence (an over-staged car says so) */
export const stageLabel = (r: Pick<Runner, 'stage' | 'overstaged' | 'rolling' | 'deepStage' | 'launched'>): string => (r.launched ? '' : r.rolling ? STAGE_LABELS.rolling : r.overstaged && r.stage === 'preStage' ? 'OVER-STAGED' : r.deepStage && r.stage === 'staged' ? STAGE_LABELS.deepStaged : STAGE_LABELS[r.stage] ?? '');
const inStageFamily = (st: StagePhase): boolean => st === 'preStage' || st === 'staged' || st === 'deepStaged';

/** the auto driver's staging plan for a lane: how far it burns out (dry metres past the water box), where the run-out stops (past the tree) and where the back up stops (inside the pre-stage zone).
 * It uses its own seeded numbers, so the race's draws are untouched, and it is the same plan a ghost's visual staging path is made from (see `ghostStagingPath`). */
export interface StagingPlan { burnout: number; runOutStop: number; backupStop: number; deepStage: boolean }
export function stagingPlanFor(seed: number, lane: number, ai: Skill | null | undefined): StagingPlan {
  const q = createRng(((seed >>> 0) ^ STAGE.salt) + lane * 7919), t = DRAG.tire, react = ai?.react ?? 0.25;
  const burnSeconds = Math.max(0, Math.min(t.aiBurnMax, t.aiBurnBase - react * t.aiBurnReact));      // the better the driver, the longer it warms the tires
  const stopCentre = -(STAGE.preStageRollout + DRAG.stageRollout) / 2;
  return { burnout: burnSeconds * STAGE.burnoutSpeed, runOutStop: STAGE.runOutPastTree + q.range(0, STAGE.aiRunOutJitter), backupStop: stopCentre + q.range(-0.05, 0.05), deepStage: ai?.deepStage === true };
}

export function createDrag(o: { seed: number; entrants: Entrant[]; conditions?: DragConditions; strip?: DragStrip; /** start every car staged with the tree armed (the old behaviour: tune-screen predictions and tests that only need a launch) */ quickStart?: boolean }) {
  const rng = createRng(o.seed), events: DragEvent[] = [], conditions = o.conditions ?? conditionsForSeed(o.seed), weather = { ...conditions }, rubberOn = !!o.strip, strip = o.strip ?? createDragStrip(o.entrants.length);
  const normal = (): number => { let s = 0; for (let i = 0; i < 6; i++) s += rng.next(); return (s - 3) / Math.sqrt(0.5); };      // a bell curve, roughly
  const quick = o.quickStart === true, treeDelay0 = rng.range(DRAG.green[0], DRAG.green[1]);
  /** `greenAt` is infinite while the tree is dark: it is set when every live car has staged (`armed`), `treeDelay` is the seed's amber-to-green delay (redrawn if the tree has to be restarted) */
  const s = { t: 0, greenAt: Infinity, treeDelay: treeDelay0, armed: false, armedAt: Infinity, ambers: 0, green: false, phase: 'tree' as 'tree' | 'run' | 'shutdown' | 'over', conditions, weather, strip, runners: [] as Runner[], winner: -1, reason: '' };
  s.runners = o.entrants.map((e, lane) => {
    const ai = e.ai ?? null, fuel = clamp(Number.isFinite(e.fuel) ? e.fuel as number : FUEL.capacity, FUEL.reserve, FUEL.capacity), staging = stagingPlanFor(o.seed, lane, ai);
    const plan = { launchAt: Infinity, shifts: [] as number[], burnout: 0, deepStage: ai?.deepStage === true, reactFromGreen: 0, runOutStop: staging.runOutStop, backupStop: staging.backupStop };
    if (ai) {
      plan.reactFromGreen = rng.next() < ai.foul ? -rng.range(0.02, 0.15) : Math.max(0.06, ai.react + normal() * ai.spread);
      for (let g = 0; g < e.tune.ratios.length; g++) plan.shifts.push(Math.min(e.spec.redline - 50, e.tune.shiftRpm + normal() * ai.shiftErr));
      plan.burnout = staging.burnout;
    }
    const startDeep = quick && plan.deepStage, startX = quick ? (startDeep ? -DRAG.deepStageRollout : -DRAG.stageRollout) : STAGE.startX;
    const engineTemp = clamp(Number.isFinite(e.engineTemp) ? e.engineTemp as number : weather.airC, weather.airC, BOOST.heatMax);
    return { name: e.name, spec: e.spec, tune: e.tune, ai, x: startX, v: 0, rpm: e.spec.idle, gear: 1, launched: false, rolling: false, deepStage: startDeep, stage: (quick ? (startDeep ? 'deepStaged' : 'staged') : 'waterBoxApproach') as StagePhase, preBulb: quick, stageBulb: quick, overstaged: false, burnDistance: 0, stagedFor: 0, reversing: false, wet: 0, shiftTo: 1, accel: 0, sprungTransfer: 0, hotPsi: e.tune.pressure, aborted: false, launchT: 0, shiftT: 0, shiftTargetRpm: e.spec.idle, shiftPenalty: 0, shiftMissed: false, nitroLeft: e.spec.nitroSecs, nitroOn: false, nitroUsed: 0, nitroTemp: weather.airC, nitroPressure: 1, nitroGain: 0, nitroPeakGain: 0, spin: false, limiter: false, tireTemp: weather.airC, tires: [{ temp: weather.airC, wear: 0 }, { temp: weather.airC, wear: 0 }] as [DragTire, DragTire], burnout: false, clutchTemp: weather.airC, clutchPeakTemp: weather.airC, clutchSlip: 0, clutchCondition: clamp(e.clutchCondition ?? e.spec.clutchCondition ?? 1, CLUTCH.minCondition, 1), clutchLocked: false, clutchLockT: Infinity, reaction: null, foul: false, marks: {}, trap: 0, finished: false, ghost: e.ghost, trace: [], spinTime: 0, plan, prev: { ...NO_INPUT }, y: 0, psi: 0, yawRate: 0, steer: 0, spinL: false, spinR: false, crossed: false, foulT: Infinity, wall: false, gripLeft: 1, drift: 0, pitch: 0, pitchRate: 0, rearShare: staticRearShare(e.spec, e.tune, fuel), lift: 0, boost: 0, boostPeak: 0, engineTemp, enginePeakTemp: engineTemp, retard: boostRetardAt(engineTemp), fuel, fuelUsed: 0, shutdown: false, brake: false, chute: false, stopped: false, crashed: false, crashT: Infinity, brakeTemp: weather.airC, brakeFade: 1, chuteT: 0, chuteOpen: 0 };
  });
  // each lane's own strip: the rubber under each wheel and the ruts, as gentle waves along it (their own random numbers, so the race's draws are untouched)
  const strips = s.runners.map((_, i) => { const q = createRng(o.seed * 7919 + i * 104729 + 13); return Array.from({ length: 8 }, () => q.range(0, Math.PI * 2)); });
  const rubber = (i: number, side: 0 | 1, x: number): number => { const p = strips[i] as number[], wave = LANE.rubber * (0.6 * Math.sin(x / 7 + (p[side * 2] as number)) + 0.4 * Math.sin(x / 23 + (p[side * 2 + 1] as number))); return (1 + wave) * (1 + (rubberOn ? RUBBER.gain * rubberAt(strip, i, side, x) : 0)); };
  const rut = (i: number, x: number): number => { const p = strips[i] as number[]; return LANE.rut * (Math.sin(x / 31 + (p[4] as number)) + 0.5 * Math.sin(x / 11 + (p[5] as number))); };
  /** which way the centre line is from a lane, to the car's right (+1) or left (-1): the left lane (0) has it on its left */
  const centre = (i: number): number => (i === 0 ? -1 : 1);
  const inputs: DragInput[] = s.runners.map(() => ({ ...NO_INPUT }));
  /** the engine cools toward the day's air, helped by speed but slowed once it has soaked heat */
  const coolEngine = (r: Runner, dt: number): void => { const t = Number.isFinite(r.engineTemp) ? r.engineTemp : weather.airC; r.engineTemp = t + (weather.airC - t) * BOOST.heatCool * (1 - BOOST.heatSoakCool * engineHotShare(t)) * (1 + BOOST.heatAirCool * r.v) * dt; };
  const ghostAt = (samples: GhostSample[], t: number): GhostSample | null => {
    if (!samples.length) return null; const first = samples[0] as GhostSample, last = samples[samples.length - 1] as GhostSample;
    if (t <= first.t) return first; if (t >= last.t) return last;
    let lo = 0, hi = samples.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if ((samples[mid] as GhostSample).t <= t) lo = mid; else hi = mid; }
    const a = samples[lo] as GhostSample, b = samples[hi] as GhostSample, f = (t - a.t) / Math.max(1e-9, b.t - a.t);
    return { t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, psi: a.psi + (b.psi - a.psi) * f, v: a.v + (b.v - a.v) * f };
  };
  /** how much harder than the player's brakes a ghost must brake to stop inside the run-out (1 when its own speed is no problem): a fast ghost on the stock car's brakes would drive off the end of the strip. It is estimated with the same forces, a little pessimistically (brake fade), and the answer only depends on the ghost's speed at the line. */
  function ghostBrakeScale(r: Runner): number {
    const room = (SHUTDOWN.end - r.x) * 0.8, mass = runnerMass(r), fade = (SHUTDOWN.brakeFadeMin + 1) / 2;
    for (let scale = 1; scale < 8; scale *= 1.1) {
      let v = r.v, x = 0, t = 0;
      while (v > SHUTDOWN.stopSpeed && t < 60) { const drag = 0.5 * weather.rho * (r.spec.cda + SHUTDOWN.chuteCda) * v * v, brakes = SHUTDOWN.brakeG * fade * mass * DRAG.g * weather.grip * scale; const v0 = v; v = Math.max(0, v - (drag + brakes) / mass * 0.02); x += (v0 + v) / 2 * 0.02; t += 0.02; }
      if (x <= room) return scale;
    }
    return 8;
  }
  const ghostBrake = new Map<number, number>();
  const ghostPaths = new Map<number, StagingPath>();
  /** the ghosts that have crossed the finish line and are now braking on the run-out */
  const ghostRunOut = new Set<number>();
  /** the ghost's canned staging path (burnout, run-out, back up, stage): it is only for the eye, its time starts at the green */
  const pathOf = (i: number, deep: boolean): StagingPath => { let p = ghostPaths.get(i); if (!p) { p = ghostStagingPath(o.seed, i, deep); ghostPaths.set(i, p); } return p; };
  function playGhost(i: number, r: Runner, g: DragGhost): void {
    const t = s.armed ? s.t - s.greenAt : -1, q = g.marks.quarter, at = ghostAt(g.samples, t);
    if (ghostRunOut.has(i) && t >= 0) { if (!r.stopped) shutdownStep(i, r, { ...NO_INPUT, brake: true, chute: true }, ghostBrake.get(i)); r.psi *= 0.98; return; }
    if (t < 0) {      // before the green the ghost does the staging procedure along its canned path (the leaderboard ghost only has samples from the green)
      const pose = stagingPoseAt(pathOf(i, !!g.deepStage), s.t);
      r.x = pose.x; r.y = pose.y; r.psi = 0; r.v = pose.v; r.stage = pose.stage; r.burnout = pose.burnout; r.reversing = pose.reversing; r.deepStage = pose.stage === 'deepStaged'; r.preBulb = pose.x >= -STAGE.preStageRollout && pose.x < 0; r.stageBulb = pose.stage === 'staged' || pose.stage === 'deepStaged';
    } else if (at) { r.x = at.x; r.y = at.y; r.psi = at.psi; r.v = Math.max(0, at.v); r.burnout = false; r.reversing = false; }
    const ratio = r.tune.ratios[0] ?? 1; r.rpm = clamp(wheelRpm(r.v, ratio, r.tune.final, r.spec.tire), r.spec.idle, r.spec.redline);
    r.reaction = g.reaction; r.marks = { ...g.marks }; r.trap = g.trap; r.foul = g.reaction < 0; r.crossed = false; r.aborted = false; r.crashed = false;
    r.rolling = t >= g.reaction - stageRolloutTime(g.deepStage) && t < g.reaction; if (t >= 0) r.deepStage = !!g.deepStage && (r.rolling || t < g.reaction); r.launched = t >= g.reaction; r.launchT = s.greenAt + g.reaction; if (t >= 0) r.stage = r.launched ? 'launched' : r.rolling ? 'rolling' : r.deepStage ? 'deepStaged' : 'staged';
    r.chute = false; r.chuteOpen = 0; r.nitroOn = false; r.nitroUsed = 0; r.nitroTemp = s.conditions.airC; r.nitroPressure = 0; r.nitroGain = 0; r.nitroPeakGain = 0; r.boost = 0; r.retard = 0; r.yawRate = 0; r.steer = 0; r.gripLeft = 1; r.drift = 0; r.fuel = FUEL.capacity; r.fuelUsed = 0;
    /* the marks are timed from the launch and `t` from the green: the finish is the reaction plus the quarter */
    if (q !== undefined && t >= g.reaction + q) {
      if (!r.finished) events.push({ t: 'finish', car: i });
      r.finished = true; r.shutdown = true;
      // from the line the ghost is a car on the run-out: it takes the position and speed it had at the line, then brakes and opens its chute through the same shutdown physics the player's car uses
      if (!ghostRunOut.has(i)) { const atLine = ghostAt(g.samples, g.reaction + q) ?? { t, x: DRAG.marks.quarter, y: 0, psi: 0, v: g.trap / 3.6 }; ghostRunOut.add(i); r.x = atLine.x; r.v = Math.max(0, atLine.v); r.y = atLine.y; r.psi = atLine.psi; ghostBrake.set(i, ghostBrakeScale(r)); }
      if (!r.stopped) shutdownStep(i, r, { ...NO_INPUT, brake: true, chute: true }, ghostBrake.get(i));
      r.psi *= 0.98;
      return;
    }
    const last = g.samples[g.samples.length - 1] as GhostSample | undefined; if (last && t >= last.t) { r.v = 0; r.stopped = true; }
  }
  const recordTrace = (r: Runner): void => { if (r.ghost) return; const prev = r.trace[r.trace.length - 1]; if (!prev || s.t - prev.t + DRAG.dt / 2 >= GHOST.step) r.trace.push({ t: s.t, x: r.x, y: r.y, psi: r.psi, v: r.v }); };

  /** the beam breaks at the final beam: the launch, the reaction time from the green (negative before it, or with the tree still dark: a red light) */
  function breakBeam(i: number, r: Runner): void {
    r.launched = true; r.rolling = false; r.launchT = s.t; r.burnout = false; r.stage = 'launched'; r.reversing = false; r.reaction = s.armed ? s.t - s.greenAt : -1; events.push({ t: 'launch', car: i });
    if (r.reaction < 0) { r.foul = true; r.foulT = s.t; events.push({ t: 'foul', car: i }); }
  }
  /** the staging sequence for a car that has not launched (see STAGE): the car rolls, burns out while moving, runs out, backs up and creeps to the beams; the gas, brake and back up decide how it moves, and its slicks heat and its rubber is laid from the slip over distance */
  function stagingStep(i: number, r: Runner, inp: DragInput): void {
    const dt = DRAG.dt, sp = r.spec, tu = r.tune, ty = DRAG.tire, tires = r.tires, press = (k: 'launch' | 'chute'): boolean => inp[k] && !r.prev[k];
    const gas = throttleOf(inp.throttle), pedal = clutchOfInput(inp.clutch), manual = pedal !== null, st0 = r.stage, family0 = inStageFamily(st0);
    const burning = !!inp.burnout && gas >= ENGINE.burnMin && !r.rolling && (st0 === 'waterBoxApproach' || st0 === 'burnout' || st0 === 'runOut') && r.x >= STAGE.waterBoxStart && (!manual || (pedal as number) > 0.1);
    r.burnout = burning;
    // the engine revs to the launch control's limit with the gas, and burns fuel and heats as it did on the line
    const sense = (r.ai?.fuelSense ?? 0) * fuelTrim(r), launchWant = tu.launchRpm * (1 - sense * FUEL.launchTrim), freeRev = manual && (pedal as number) < 0.999;
    const want = freeRev ? sp.idle + (sp.redline - sp.idle) * gas : sp.idle + (Math.min(tu.launchRpm, launchWant) - sp.idle) * gas;
    r.rpm += Math.sign(want - r.rpm) * Math.min(Math.abs(want - r.rpm), DRAG.rev * dt * (freeRev ? (0.35 + gas * 0.65) : 1));
    const idleBurn = (FUEL.idleBurn + (FUEL.lineBurn - FUEL.idleBurn) * gas) * Math.max(1, r.rpm / sp.idle) * dt, spent = Math.min(idleBurn, Math.max(0, r.fuel - FUEL.reserve)); r.fuel -= spent; r.fuelUsed += spent;
    if (gas > 0) { const share = gas * clamp((r.rpm - sp.idle) / Math.max(1, sp.redline - sp.idle), 0, 1), slipHeat = manual ? BOOST.heatSlip * clamp(1 - (pedal as number), 0, 1) * clamp((r.rpm - sp.idle) / Math.max(1, sp.redline - sp.idle), 0, 1) : 0; r.engineTemp = Math.min(BOOST.heatMax, r.engineTemp + (BOOST.heatLine + (burning ? BOOST.heatBurnout : 0) + slipHeat) * share * dt); r.enginePeakTemp = Math.max(r.enginePeakTemp, r.engineTemp); r.retard = boostRetardAt(r.engineTemp); }
    // a chute pulled with the car on the beams (or rolling to the final beam) aborts the start
    if (press('chute') && (family0 || r.rolling)) { r.aborted = true; r.foul = true; r.foulT = s.t; r.rolling = false; r.burnout = false; r.chute = true; r.chuteT = SHUTDOWN.chuteDeploy; r.chuteOpen = 1; r.v = 0; r.stopped = true; r.stage = 'launched'; events.push({ t: 'abort', car: i }); return; }
    if (!r.rolling && (st0 === 'staged' || st0 === 'deepStaged') && press('launch')) { r.rolling = true; r.stage = 'rolling'; r.v = 0; events.push({ t: 'rollout', car: i }); }
    const x0 = r.x;
    if (r.rolling) {
      r.x = Math.min(0, r.x + DRAG.stageCreep * dt);
      if (r.x >= 0) breakBeam(i, r);
    } else {
      // how it moves: the burnout rolls forward spinning the rears, back up reverses slowly, a held deep stage creeps to the deep beam, the brake stops, final stage holds a slow car (the trans-brake) and the gas rolls it
      const held = (st0 === 'staged' || st0 === 'deepStaged') && Math.abs(r.v) <= STAGE.catchSpeed, deepCreep = !!inp.deepStage && !inp.backUp && (st0 === 'staged' || st0 === 'preStage') && r.x < -DRAG.deepStageRollout;
      let target = 0, rate: number = STAGE.coastDecel;
      if (burning) { target = STAGE.burnoutSpeed; rate = STAGE.burnoutAccel; }
      else if (inp.backUp) { target = -STAGE.backupSpeed; rate = r.v > 0 ? STAGE.brakeDecel : STAGE.reverseAccel; }
      else if (deepCreep) { target = STAGE.creepSpeed; rate = STAGE.rollAccel; }
      else if (inp.brake) rate = STAGE.brakeDecel;
      else if (held) { r.v = 0; rate = STAGE.brakeDecel; }
      else if (gas > 0) { target = gas * STAGE.rollMaxSpeed; rate = target > r.v ? STAGE.rollAccel : STAGE.coastDecel; }
      const vOld = r.v, dv = target - r.v; r.v += Math.sign(dv) * Math.min(Math.abs(dv), rate * dt); if (Math.abs(r.v) < 1e-9) r.v = 0;
      r.x += (vOld + r.v) / 2 * dt;
      if (deepCreep && r.x >= -DRAG.deepStageRollout) { r.x = -DRAG.deepStageRollout; r.v = 0; }
      // a creep or a roll from behind the final beam into it breaks the beam: that is the launch (a red light before the green)
      if (family0 && x0 < 0 && r.x >= 0 && r.v > 0) breakBeam(i, r);
    }
    if (r.launched) return;
    // across the lane: a small correction while rolling
    const want0 = clamp(Number.isFinite(inp.steer) ? inp.steer as number : 0, -1, 1); r.steer = want0; r.psi = 0; r.yawRate = 0;
    r.y = clamp(r.y + want0 * STAGE.steerRate * Math.min(1, Math.abs(r.v)) * dt, -STAGE.maxOffset, STAGE.maxOffset);
    // the water box wets the slicks; every metre driven dries them, a burnout dries them faster
    const travel = Math.abs(r.x - x0);
    if (r.x >= STAGE.waterBoxStart && r.x <= STAGE.waterBoxEnd) r.wet = 1; else if (r.wet > 0) r.wet = Math.max(0, r.wet - STAGE.dryPerMetre * travel * (burning ? STAGE.spinDry : 1));
    if (burning) {
      const pedalShare = manual ? clamp(pedal as number, 0.2, 1) : 1, slipMetres = STAGE.burnSlipSpeed * gas * pedalShare * dt, heat = STAGE.heatPerSlipMetre * slipMetres * (1 - (1 - STAGE.wetHeatShare) * r.wet);
      for (const w of tires) w.temp = Math.min(ty.maxTemp, w.temp + heat);
      r.burnDistance += travel;
      if (rubberOn && r.x > 0) { const lay = STAGE.rubberPerMetre * travel * (1 - r.wet) * pedalShare; layRubber(strip, i, 0, Math.max(0, x0), r.x, lay); layRubber(strip, i, 1, Math.max(0, x0), r.x, lay); }
    }
    // where it is now: the burnout, the run-out, the back up, then the beams (pre-stage, stage, deep stage); creeping past the stage beam is over-staging
    let st: StagePhase = r.rolling ? 'rolling' : st0;
    if (!r.rolling) {
      if (burning) st = 'burnout'; else if (st === 'burnout') st = 'runOut'; else if (st === 'waterBoxApproach' && r.x >= STAGE.waterBoxEnd) st = 'runOut';
      if (!burning && r.v < -STAGE.stopSpeed && (st === 'runOut' || st === 'backup' || inStageFamily(st))) st = 'backup';
      if (!burning && (st === 'runOut' || st === 'backup' || inStageFamily(st)) && r.v >= -STAGE.stopSpeed && Math.abs(r.v) <= STAGE.beamSpeed) {
        if (r.x < -DRAG.stageRollout) r.overstaged = false;
        if (r.x >= 0) { /* past the final beam without a launch: still the run-out */ }
        else if (r.x >= -STAGE.overstageLimit) { r.overstaged = true; st = 'preStage'; }
        else if (r.x >= -DRAG.deepStageRollout) st = r.overstaged ? 'preStage' : 'deepStaged';
        else if (r.x >= -DRAG.stageRollout) st = r.overstaged ? 'preStage' : 'staged';
        else if (r.x >= -STAGE.preStageRollout) st = 'preStage';
        else if (inStageFamily(st)) st = 'backup';
      }
    }
    r.stage = st; r.deepStage = st === 'deepStaged' || (r.rolling && r.deepStage);
    r.preBulb = r.x >= -STAGE.preStageRollout && r.x < 0; r.stageBulb = r.x >= -DRAG.stageRollout && r.x < -STAGE.overstageLimit && !r.overstaged;
    r.stagedFor = (st === 'staged' || st === 'deepStaged') && Math.abs(r.v) <= STAGE.stopSpeed ? r.stagedFor + dt : 0;
    r.reversing = !!inp.backUp || r.v < -0.01;
    r.hotPsi = hotPressure(tu.pressure, (tires[0]!.temp + tires[1]!.temp) / 2, weather.airC);
  }

  function drive(i: number, r: Runner, inp: DragInput): void {
    const dt = DRAG.dt, sp = r.spec, tu = r.tune, ty = DRAG.tire, target = tireTarget(weather), press = (k: 'launch' | 'shiftUp' | 'nitro' | 'chute'): boolean => inp[k] && !r.prev[k];
    if (!Number.isFinite(r.tireTemp)) r.tireTemp = weather.airC;
    syncTires(r, weather.airC);
    if (!Number.isFinite(r.clutchTemp)) r.clutchTemp = weather.airC;
    if (!Number.isFinite(r.clutchCondition)) r.clutchCondition = 1;
    coolEngine(r, dt); r.retard = boostRetardAt(r.engineTemp); if (!Number.isFinite(r.enginePeakTemp)) r.enginePeakTemp = r.engineTemp;
    const tires = r.tires;
    for (const w of tires) w.temp += (target - w.temp) * (ty.cool + CONDITIONS.trackWarmRate) * (1 + ty.airflowCool * r.v) * dt;      // air and hot track pull the tires toward the strip's temperature
    if (r.aborted) { r.tireTemp = (tires[0]!.temp + tires[1]!.temp) / 2; return; }
    if (!r.launched) { stagingStep(i, r, inp); r.tireTemp = (tires[0]!.temp + tires[1]!.temp) / 2; return; }
    if (r.finished) { r.tireTemp = (tires[0]!.temp + tires[1]!.temp) / 2; shutdownStep(i, r, inp); return; }
    r.burnout = false;
    const since = s.t - r.launchT;
    // shifting: up a gear by hand (a press), or at the tune's shift point; torque interrupts during the shift and revs match the next gear's wheel speed
    const top = r.gear >= tu.ratios.length, sense = (r.ai?.fuelSense ?? 0) * fuelTrim(r), autoAt = r.ai ? (r.plan.shifts[r.gear - 1] ?? tu.shiftRpm) * (1 - sense * FUEL.shiftTrim) : tu.shiftRpm;
    const upWanted = !top && ((tu.shift === 'manual' && !r.ai) ? press('shiftUp') : r.rpm >= autoAt);
    /** a manual downshift: refused if the lower gear would spin the engine past the redline at this speed */
    const downWanted = !upWanted && tu.shift === 'manual' && !r.ai && r.gear > 1 && !!inp.shiftDown && !r.prev.shiftDown && wheelRpm(r.v, tu.ratios[r.gear - 2] as number, tu.final, sp.tire) <= sp.redline;
    if (r.shiftT <= 0 && r.shiftPenalty <= 0 && (upWanted || downWanted)) {
      r.shiftTo = upWanted ? r.gear + 1 : r.gear - 1;
      const target = wheelRpm(r.v, tu.ratios[r.shiftTo - 1] as number, tu.final, sp.tire);
      const hot = clamp((r.clutchTemp - CLUTCH.fadeFrom) / Math.max(1, CLUTCH.maxTemp - CLUTCH.fadeFrom), 0, 1);
      const missChance = Math.max(0, (hot - SHIFT_QUALITY.missedHeatFrom) / Math.max(1e-6, 1 - SHIFT_QUALITY.missedHeatFrom)) * SHIFT_QUALITY.missedHeatMax + (r.spin ? SHIFT_QUALITY.missedSpin : 0) + (r.clutchSlip > 0.1 ? SHIFT_QUALITY.missedClutchSlip : 0);
      r.shiftMissed = !r.ai && rng.next() < missChance;
      r.shiftTargetRpm = target;
      r.shiftT = sp.shiftTime + (r.shiftMissed ? SHIFT_QUALITY.penaltyMax * (0.5 + hot * 0.5) : 0);
      r.shiftPenalty = r.shiftMissed ? SHIFT_QUALITY.penaltyMax * (0.35 + hot * 0.65) : 0;
      r.clutchLocked = false; r.clutchLockT = Infinity;
    }
    if (r.shiftPenalty > 0) r.shiftPenalty = Math.max(0, r.shiftPenalty - dt);
    if (r.shiftT > 0) {
      r.shiftT -= dt;
      if (r.shiftT <= 0) {
        r.gear = r.shiftTo;
        const landed = wheelRpm(r.v, tu.ratios[r.gear - 1] as number, tu.final, sp.tire);
        const miss = r.shiftMissed ? 1 : clamp(Math.abs(r.rpm - landed) / SHIFT_QUALITY.matchWindow, 0, 1);
        r.rpm = clamp(landed + (r.rpm - landed) * miss * 0.35, sp.idle, sp.redline);
        r.boost = Math.min(r.boost, BOOST.shiftMax * (1 - miss * 0.5));
        r.clutchTemp = clamp(r.clutchTemp + miss * SHIFT_QUALITY.penaltySlipHeat * 8, CLUTCH.ambient, CLUTCH.maxTemp);
        r.shiftMissed = false;
        events.push({ t: 'shift', car: i, gear: r.gear });
      }
    }
    const ratio = tu.ratios[r.gear - 1] as number, wr = wheelRpm(r.v, ratio, tu.final, sp.tire);      // (after the shift, so a new gear's revs are its own)
    // nitro: by hand (a press turns it on until the bottle is empty), or from the tune's gear
    if (!r.nitroOn && r.nitroLeft > 0 && (tu.nitroGear > 0 ? r.gear >= tu.nitroGear : (r.ai ? r.gear >= 2 : press('nitro')))) { r.nitroOn = true; events.push({ t: 'nitro', car: i }); }
    if (r.nitroOn) {
      r.nitroLeft -= dt * burn(sp, tu.nitroShot); r.nitroUsed += dt; r.nitroTemp += (NITRO.refTempC - r.nitroTemp) * NITRO.cool * dt + NITRO.heatPerSecond * dt;
      if (r.nitroLeft <= 0) { r.nitroLeft = 0; r.nitroOn = false; }
    } else r.nitroTemp += (weather.airC - r.nitroTemp) * NITRO.cool * dt;
    r.nitroPressure = bottlePressure(r); r.nitroGain = nitroShotGain(r); if (r.nitroOn) r.nitroPeakGain = Math.max(r.nitroPeakGain, r.nitroGain);
    // the engine: the clutch comes together over the tune's bite time, pulls the revs down to the wheels and locks when the gap is small; spinning tires keep it slipping
    const gas = throttleOf(inp.throttle), pedal = clutchOfInput(inp.clutch), manual = pedal !== null, autoEngage = Math.min(1, since / clutchBiteTime(tu)), engage = manual ? pedal : autoEngage, before = r.rpm;
    let rpm = before;
    if (r.shiftT > 0) {
      const target = clamp(r.shiftTargetRpm, sp.idle, sp.redline), rate = DRAG.rev * (gas < 0.2 ? SHIFT_QUALITY.liftOffDrop : Math.max(0.2, 1 - gas * SHIFT_QUALITY.liftOnRpmShare));
      rpm += Math.sign(target - before) * Math.min(Math.abs(target - before), rate * dt);
      rpm = clamp(rpm, sp.idle, sp.redline);
    }
    else if (r.spin) rpm = Math.max(wr, before + DRAG.rev * 0.35 * dt);
    else if (r.clutchLocked) rpm = wr;
    else if (manual) {
      const free = Math.max(sp.idle, Math.min(sp.redline, before + (gas > 0 ? DRAG.rev : -DRAG.rev * 0.35) * dt * (0.35 + gas * 0.65)));
      rpm = Math.max(wr, wr * engage + free * (1 - engage));
    }
    else rpm = Math.max(wr, tu.launchRpm * (1 - engage) + wr * engage);
    if (manual && engage < 0.999) { r.clutchLocked = false; r.clutchLockT = Infinity; }
    if (!r.clutchLocked && r.shiftT <= 0 && engage > 0 && (rpm - wr <= CLUTCH.lockRpm || engage >= 0.999)) { r.clutchLocked = true; r.clutchLockT = s.t; if (!r.spin) rpm = wr; }
    const over = clamp((rpm - (sp.redline - ENGINE.limiter.span)) / Math.max(1, ENGINE.limiter.span), 0, 1);
    r.limiter = over > 0; rpm = Math.min(sp.redline, Math.max(sp.idle, rpm)); r.rpm = rpm;
    const boostCap = sp.boostCap * boostLimitOf(tu), risk = boostCap > 0 ? boostRisk(tu) : 0;
    const boostTarget = (boostCap <= 0 ? 0 : r.shiftT > 0 ? BOOST.shiftMax : gas * clamp((rpm - sp.idle) / Math.max(1, sp.peakRpm - sp.idle), BOOST.minRpmShare, BOOST.maxLimit)) * (r.ai ? engineTrim(r) : 1);
    r.boost = clamp(r.boost + (boostTarget - r.boost) * Math.min(BOOST.maxLimit, BOOST.riseFactor / Math.max(BOOST.minLag, sp.boostLag) * dt), BOOST.minLimit, BOOST.maxLimit);
    r.boostPeak = Math.max(r.boostPeak, r.boost);
    const boostTorque = BOOST.maxLimit + boostCap * r.boost;
    const slip = !r.clutchLocked && r.shiftT <= 0 && engage > 0 ? Math.max(0, rpm - wr) * CLUTCH.radPerRpm : 0, slipping = slip > 0;
    const fly = slipping ? Math.max(0, (before - rpm) * CLUTCH.radPerRpm / dt) * DRAG.inertia : 0;      // the flywheel giving up its spin as the clutch bites
    const mapped = sp.torque * torqueShape(sp, rpm);
    const thinAir = densityTorqueShare(weather.rho), airShare = densityTorqueShare(weather.rho, r.boost, boostCap), blowerMadeUp = airShare - thinAir;
    const engine = r.shiftT > 0 ? 0 : mapped * gas * limiterTorqueShare(sp, rpm) * boostTorque * airShare * fuelTorqueShare(r) * (1 - r.retard) * (r.nitroOn ? 1 + r.nitroGain : 1);
    const engineBrake = r.shiftT > 0 || engage <= 0 ? 0 : -mapped * ENGINE.brake.share * (1 - gas) * clamp((rpm - sp.idle) / Math.max(1, sp.peakRpm - sp.idle), 0, 1);
    const load = clamp(engine / Math.max(1, sp.torque), 0, BOOST.heatLoadMax), rpmShare = clamp((rpm - sp.idle) / Math.max(1, sp.redline - sp.idle), 0, 1), slipShare = clamp(slip / BOOST.slipRef, 0, 1), airGain = Math.max(0.5, 1 + BOOST.heatAirGain * (weather.airC - CONDITIONS.refAirC));
    r.engineTemp = clamp(r.engineTemp + (BOOST.heatPerCharge * boostCap * r.boost * (1 + BOOST.heatRisk * risk) + BOOST.heatLoad * load * rpmShare * airGain + BOOST.heatSlip * slipShare + BOOST.chargeHeatPerComp * blowerMadeUp * gas) * dt, weather.airC, BOOST.heatMax);
    r.retard = boostRetardAt(r.engineTemp); r.enginePeakTemp = Math.max(r.enginePeakTemp, r.engineTemp);
    const settle = r.clutchLocked && s.t - r.clutchLockT < CLUTCH.lockedDragTime ? CLUTCH.lockedDrag : 0;
    const shiftSettle = r.shiftPenalty > 0 ? 1 - clamp(r.shiftPenalty / SHIFT_QUALITY.penaltyMax, 0, 1) : 1;
    const share = r.clutchLocked && r.shiftT <= 0 ? (1 - settle) * shiftSettle : slipping ? clutchTorqueShare(tu, sp) : 0;
    const heat = (engine * share + fly) * slip * dt * CLUTCH.heatPerJoule * (BOOST.maxLimit + BOOST.riskHeat * risk * r.boost) / Math.max(1, sp.clutchHeatCapacity);
    r.clutchTemp = clamp(r.clutchTemp + heat + (CLUTCH.ambient - r.clutchTemp) * CLUTCH.cool * (1 + CLUTCH.airflowCool * r.v) * dt, CLUTCH.ambient, CLUTCH.maxTemp);
    r.clutchPeakTemp = Math.max(r.clutchPeakTemp, r.clutchTemp); if (slipping) r.clutchSlip += dt;
    const fade = slipping ? clutchTorqueScale(r) : 1;
    const torque = (fly + (engine + engineBrake) * share) * fade;
    const spent = Math.min(Math.max(0, torque * rpm * CLUTCH.radPerRpm * dt) * FUEL.burnPerJoule, Math.max(0, r.fuel - FUEL.reserve)); r.fuel -= spent; r.fuelUsed += spent;
    const mass = runnerMass(r), drive = torque * ratio * tu.final * gearEfficiency(sp, r.gear) / sp.tire;
    // each rear wheel has its own grip: the engine's torque lifts the right one a little, and the rubber under each varies. The axle is locked, so they turn together: the weaker
    // wheel slips at its limit and the other takes the rest (pushing the nose round), and both spin up when the drive beats their grip together
    const loadRef = staticRearShare(sp, tu, FUEL.capacity) * (sp.mass + tu.ballast + DRAG.driver) * DRAG.g;
    r.hotPsi = hotPressure(tu.pressure, r.tireTemp, weather.airC);
    const gripBase = DRAG.gripScale * sp.grip * weather.grip * pressureGrip(r.hotPsi) * (1 - STAGE.wetGripLoss * r.wet) * loadRef * loadGrip(r.rearShare * mass * DRAG.g, loadRef), meanWear = (tires[0]!.wear + tires[1]!.wear) / 2, grip = gripBase * tireGrip(r.tireTemp, weather.airC) * wearGrip(meanWear), bias = LANE.torqueBias * Math.max(0, Math.min(1, drive / Math.max(1, grip)));
    const gL = gripBase / 2 * (1 + bias) * rubber(i, 0, r.x) * tireGrip(tires[0]!.temp, weather.airC) * wearGrip(tires[0]!.wear), gR = gripBase / 2 * (1 - bias) * rubber(i, 1, r.x) * tireGrip(tires[1]!.temp, weather.airC) * wearGrip(tires[1]!.wear), both = gL + gR, half = drive / 2;
    const spinning = r.spin ? drive > both * DRAG.spinHold : drive > both;
    if (spinning && !r.spin) events.push({ t: 'spin', car: i }); r.spin = spinning; if (spinning) r.spinTime += dt; r.spinL = spinning || half > gL; r.spinR = spinning || half > gR;
    const slipL = Math.max(0, half - gL) / Math.max(1, gL), slipR = Math.max(0, half - gR) / Math.max(1, gR);
    if (spinning) {
      const intensity = Math.min(ty.spinHeatMax, drive / Math.max(1, both)), heat = ty.spinHeat * intensity * dt, laid = RUBBER.spinRate * Math.min(1.5, intensity) * dt;
      for (const w of tires) w.temp = Math.min(ty.maxTemp, w.temp + heat);
      if (rubberOn) { layRubber(strip, i, 0, r.x - RUBBER.spinWidth / 2, r.x + RUBBER.spinWidth / 2, laid); layRubber(strip, i, 1, r.x - RUBBER.spinWidth / 2, r.x + RUBBER.spinWidth / 2, laid); }
    }
    if (r.v > TIRE.heatMinSpeed) { const squirm = TIRE.heatFromUnderInflation * Math.max(0, TIRE.optimalHotPsi - r.hotPsi) * dt; for (const w of tires) w.temp = Math.min(ty.maxTemp, w.temp + squirm); }
    if (r.wet > 0) r.wet = Math.max(0, r.wet - STAGE.dryPerMetre * r.v * dt * 4);
    for (const [k, w] of tires.entries()) { const slip = k === 0 ? slipL : slipR; if (slip > 0) w.wear = clamp(w.wear + ty.wearPerSlip * slip * dt, 0, 1); }
    r.tireTemp = (tires[0]!.temp + tires[1]!.temp) / 2;
    let fL = 0, fR = 0;
    if (drive < 0) fR = drive;
    else {
      const capL = gL * (spinning ? DRAG.spinPull * fade : slipGrip(slipL)), capR = gR * (spinning ? DRAG.spinPull * fade : slipGrip(slipR));
      fL = Math.min(half, capL); fR = Math.min(half, capR);
      const rest = drive - fL - fR, roomL = Math.max(0, capL - fL), roomR = Math.max(0, capR - fR), room = roomL + roomR;
      if (rest > 0 && room > 0) { fL += rest * roomL / room; fR += rest * roomR / room; }
    }
    const wind = windAt(r.x, s.t, weather), airSpeed = r.v + wind.head;
    const pull = fL + fR, drag = 0.5 * weather.rho * sp.cda * airSpeed * Math.abs(airSpeed) + rollingDrag(tu.pressure) * mass * DRAG.g * (r.v > 0.1 ? 1 : 0);
    // suspension: the tires' pull pitches the body against a spring and damper, and the wheelie bar sets how far the nose may come up
    const stiffness = clamp(tu.stiffness, LIMITS.stiffness[0], LIMITS.stiffness[1]), midStiffness = (LIMITS.stiffness[0] + LIMITS.stiffness[1]) / 2;
    const stiffnessScale = Math.max(0, 1 - (stiffness - midStiffness) * SUSP.stiffnessStep);
    const omega = Math.sqrt(SUSP.spring);
    const pitchPull = spinning && r.v < SUSP.spinPitchSpeed ? pull * SUSP.spinPitchShare : pull;
    const gForce = Math.min(SUSP.gLimit, Math.max(0, pitchPull / (mass * DRAG.g))), pitchWant = Math.min(SUSP.maxPitch, SUSP.pitchPerG * gForce * stiffnessScale), bar = wheelieBarLimit(tu);
    const wasLifted = r.pitch >= SUSP.liftPitch;
    r.pitchRate += ((pitchWant - r.pitch) * omega * omega - 2 * SUSP.dampingRatio * omega * r.pitchRate) * dt;
    r.pitch = clamp(r.pitch + r.pitchRate * dt, 0, bar);
    if (r.pitch <= 0 && r.pitchRate < 0) r.pitchRate = 0; if (r.pitch >= bar && r.pitchRate > 0) r.pitchRate = 0;
    if (!wasLifted && r.pitch >= SUSP.liftPitch) events.push({ t: 'wheelie', car: i });
    // the front tires unload as the nose rises: at liftPitch they are off, so the rear carries the car and a wheelie earns its extra grip
    // weight transfer: an acceleration moves weight to the rear by (a x height / (g x wheelbase)); the rear links deliver the anti-squat share at once, the springs let the rest arrive over `transferTau`
    const transferWanted = clamp(r.accel * SUSP.cgHeight / (DRAG.g * SUSP.wheelbase), -0.3, 0.5) * SUSP.transferGain, antiSquat = clamp(SUSP.antiSquatBase + SUSP.antiSquatPerStep * (stiffness - midStiffness), 0, 0.9), tau = Math.max(0.05, SUSP.transferTau * (1 + (midStiffness - stiffness) * 0.08));
    r.sprungTransfer += (transferWanted - r.sprungTransfer) * Math.min(1, DRAG.dt / tau);
    const staticRear = Math.min(SUSP.rearShareMax, staticRearShare(sp, tu, r.fuel) + antiSquat * transferWanted + (1 - antiSquat) * r.sprungTransfer);
    const frontShare0 = Math.max(0, 1 - staticRear), frontShare = frontShare0 * (1 - Math.min(1, r.pitch / SUSP.liftPitch));
    r.rearShare = Math.min(SUSP.rearShareMax, 1 - frontShare);
    r.lift = clamp((r.pitch - SUSP.liftPitch) / (SUSP.maxPitch - SUSP.liftPitch), 0, 1);
    const v0 = r.v, x0 = r.x; r.v = Math.max(0, r.v + (pull - drag) / mass * dt); r.x += (v0 + r.v) / 2 * dt; r.accel = (r.v - v0) / dt;
    // across the lane: the steering asks for a turn (less lock the faster you go), the wheel that grips harder pushes the nose round, and the ruts nudge it at speed
    const want = Math.max(-1, Math.min(1, inp.steer ?? 0)); r.steer = r.ai ? want : r.steer + Math.sign(want - r.steer) * Math.min(Math.abs(want - r.steer), 6 * dt);
    if (r.v > 0.3) {
      const steerGrip = 1 - SUSP.steerLift * r.lift, delta = r.steer * steerGrip * LANE.lock / (1 + r.v / LANE.lockFall), turn = r.v * Math.tan(delta) / LANE.base, push = (fL - fR) * LANE.track * LANE.yawGain / (mass * 1.2);
      const sidePush = 0.5 * weather.rho * sp.cda * wind.cross * Math.abs(wind.cross) * WIND.sideYaw / (mass * Math.max(8, r.v));
      const share = clamp((gL * lateralShare(fL, gL) + gR * lateralShare(fR, gR)) / Math.max(1, both), TRACTION.lateralFloor, 1), cap = both * share * TRACTION.lateralUse * LANE.yawGain / Math.max(1, mass * 1.2);
      const yawWant = (turn - r.yawRate) * LANE.settle + push + sidePush + rut(i, r.x) * Math.min(1, r.v / 30), yawAdd = clamp(yawWant, -cap, cap);
      r.gripLeft = share; r.drift = clamp((turn - r.yawRate - yawAdd) * TRACTION.understeer, -0.12, 0.12);
      r.yawRate += yawAdd * dt; r.psi += r.yawRate * dt; r.y += r.v * Math.sin(r.psi) * dt;
    } else { r.gripLeft = 1; r.drift = 0; }
    const c = centre(i), side = r.y * c;
    if (side > LANE.limit && !r.crossed) { r.crossed = true; r.foulT = Math.min(r.foulT, s.t); events.push({ t: 'cross', car: i }); }
    if (side < -LANE.limit) { if (!r.wall) { events.push({ t: 'wall', car: i }); r.v *= 1 - LANE.wallHit; } r.wall = true; r.y = -LANE.limit * c; if (Math.sin(r.psi) * c < 0) { r.psi = 0; r.yawRate = 0; } r.v *= 1 - LANE.wallScrub * dt; } else r.wall = false;
    r.y = Math.max(-LANE.limit - 2.4, Math.min(LANE.limit + 2.4, r.y));
    for (const m of MARK_ORDER) if (r.marks[m] === undefined && r.x >= DRAG.marks[m]) {      // the moment it crossed, between the two ticks
      const f = (DRAG.marks[m] - x0) / Math.max(1e-9, r.x - x0); r.marks[m] = since - dt + f * dt;
      if (m === 'quarter') { const window = (r.marks.quarter as number) - (r.marks.trapStart ?? NaN); r.trap = (Number.isFinite(window) && window > 0 ? DRAG.trapWindow / window : v0 + (r.v - v0) * f) * 3.6; r.finished = true; r.shutdown = true; events.push({ t: 'finish', car: i }); }
    }
  }
  /** the run-out after the line: no engine, no nitro, just aero, brakes that heat and fade, and a chute that opens over a moment. Missing the end of the strip is a crash. */
  /** `brakeScale` is only for ghosts (see `ghostBrakeScale`): the player's car always brakes with 1 */
  function shutdownStep(i: number, r: Runner, inp: DragInput, brakeScale = 1): void {
    if (r.stopped) return;
    coolEngine(r, DRAG.dt); r.retard = boostRetardAt(r.engineTemp);
    if (!r.chute && inp.chute) { r.chute = true; events.push({ t: 'chute', car: i }); }
    r.brake = !!inp.brake; r.nitroOn = false; r.rpm = Math.max(r.spec.idle, r.rpm - DRAG.rev * DRAG.dt);
    if (r.chute && !Number.isFinite(r.chuteT)) r.chuteT = 0;
    if (r.chute && r.chuteT < SHUTDOWN.chuteDeploy) r.chuteT = Math.min(SHUTDOWN.chuteDeploy, r.chuteT + DRAG.dt);
    r.chuteOpen = r.chute ? SHUTDOWN.chuteDeploy > 0 ? clamp(r.chuteT / SHUTDOWN.chuteDeploy, 0, 1) : 1 : 0;
    const mass = runnerMass(r);
    const wind = windAt(r.x, s.t, weather), airSpeed = r.v + wind.head;
    const aero = 0.5 * weather.rho * r.spec.cda * airSpeed * Math.abs(airSpeed);
    const chute = r.chuteOpen > 0 ? 0.5 * weather.rho * SHUTDOWN.chuteCda * r.chuteOpen * airSpeed * Math.abs(airSpeed) : 0;
    let brakeTemp = Number.isFinite(r.brakeTemp) ? r.brakeTemp : weather.airC;
    const brakes = r.brake ? SHUTDOWN.brakeG * brakeFadeOf(brakeTemp) * mass * DRAG.g * weather.grip : 0;
    if (r.brake) brakeTemp += brakes / mass * Math.abs(r.v) * DRAG.dt * SHUTDOWN.brakeHeat;
    brakeTemp = clamp(brakeTemp - (SHUTDOWN.brakeCool + SHUTDOWN.brakeAirCool * Math.abs(r.v)) * DRAG.dt, weather.airC, SHUTDOWN.brakeMaxTemp);
    r.brakeTemp = brakeTemp; r.brakeFade = brakeFadeOf(brakeTemp);
    const v0 = r.v; r.v = Math.max(0, r.v - (aero + chute + brakes * brakeScale) / mass * DRAG.dt); r.x += (v0 + r.v) / 2 * DRAG.dt;
    if (r.v <= SHUTDOWN.stopSpeed) { r.v = 0; r.stopped = true; }
    else if (r.x >= SHUTDOWN.end) { r.x = SHUTDOWN.end; r.v = 0; r.stopped = true; r.crashed = true; r.crashT = s.t; events.push({ t: 'crash', car: i }); }
  }
  function decide(): void {
    s.phase = 'over'; const rs = s.runners, total = (r: Runner): number => (r.finished && r.reaction !== null ? r.reaction + (r.marks.quarter as number) : Infinity);
    const broke = (r: Runner): boolean => r.foul || r.crossed || r.crashed;
    const at = (r: Runner): number => Math.min(r.foulT, r.crashT);
    const why = (r: Runner): string => (r.aborted ? 'aborted the start' : r.foul ? 'red light' : r.crossed ? 'crossed the centre line' : r.crashed ? 'crashed on the run-out' : 'did not finish');
    if (rs.length === 1) { const r = rs[0] as Runner; s.winner = broke(r) || !r.finished ? -1 : 0; s.reason = broke(r) ? why(r) : r.finished ? 'a clean run' : 'did not finish'; }
    else {
      const clean = rs.map((r, i) => ({ r, i })).filter(e => !broke(e.r));
      if (clean.length === 1) { const other = rs.find((_, i) => i !== (clean[0] as { i: number }).i) as Runner; s.winner = (clean[0] as { i: number }).i; s.reason = why(other); }
      else if (clean.length === 0) { const first = rs.reduce((a, r, i) => (at(r) < at(rs[a] as Runner) ? i : a), 0); s.winner = first === 0 ? 1 : 0; s.reason = 'both broke the rules: the first to do it loses'; }
      else { const best = clean.reduce((a, e) => (total(e.r) < total(a.r) ? e : a)); s.winner = Number.isFinite(total(best.r)) ? best.i : -1; s.reason = s.winner < 0 ? 'nobody finished' : 'first across the line'; }
    }
    events.push({ t: 'over', winner: s.winner });
  }
  /** a driver keeping the car straight: aim the heading back toward the lane's middle and steer for that turn */
  function autoSteer(r: Runner): number {
    if (r.v < 0.3) return 0;
    const grip = Math.max(TRACTION.lateralFloor, Number.isFinite(r.gripLeft) ? r.gripLeft : 1);
    const psiWant = Math.max(-0.03, Math.min(0.03, -0.25 * r.y)), rateWant = (psiWant - r.psi) * 3 - r.yawRate, lock = LANE.lock / (1 + r.v / LANE.lockFall);
    return Math.max(-1, Math.min(1, Math.atan(rateWant * LANE.base / r.v) / (lock * grip)));
  }
  /** the tree arms when every live car has held still in final stage for `armHold` seconds (a ghost counts as staged once its canned path is done); the seed's delay then runs to the green. A car leaving final stage (backing out, over-staging) before the green puts the tree out again. */
  function arm(): void {
    s.armed = true; s.armedAt = s.t; s.greenAt = s.t + s.treeDelay;
    for (const r of s.runners) if (r.ai) r.plan.launchAt = s.greenAt + r.plan.reactFromGreen;
  }
  function updateTree(): void {
    if (s.green) return;
    const ready = (r: Runner, i: number): boolean => r.aborted || r.rolling || r.launched || (r.ghost ? s.t >= pathOf(i, !!r.ghost.deepStage).duration : r.stagedFor >= STAGE.armHold);
    if (!s.armed) { if (s.runners.some(r => !r.aborted) && s.runners.every(ready)) arm(); return; }
    const leftStage = s.runners.some(r => !r.ghost && !r.aborted && !r.rolling && !r.launched && r.stage !== 'staged' && r.stage !== 'deepStaged');
    if (leftStage) { s.armed = false; s.armedAt = Infinity; s.greenAt = Infinity; s.ambers = 0; s.treeDelay = rng.range(DRAG.green[0], DRAG.green[1]); for (const r of s.runners) if (r.ai) r.plan.launchAt = Infinity; }
  }
  /** the auto driver's staging: roll to the water box, burn out while moving, run out past the tree, stop, back up into the pre-stage zone, creep to stage (and deep stage if planned). It asks for analog gas like a pedal. */
  function aiStagingInput(r: Runner): DragInput {
    const p = r.plan, inp: DragInput = { ...NO_INPUT }, brakeDistance = r.v * r.v / (2 * STAGE.brakeDecel), gasFor = (speed: number): number => clamp(speed / STAGE.rollMaxSpeed, 0, 1);
    const burnLength = p.burnout * (1 - (r.ai?.heatSense ?? 0) * BOOST.aiBurnTrim * engineHotShare(r.engineTemp));
    if (r.stage === 'waterBoxApproach' || r.stage === 'burnout') {
      if (r.x < STAGE.waterBoxStart + 1) inp.throttle = gasFor(STAGE.aiApproachSpeed);
      else if (burnLength > 0 && r.x < STAGE.waterBoxEnd + burnLength) { inp.throttle = 1; inp.burnout = true; }
      else inp.throttle = gasFor(STAGE.aiRunOutSpeed);
    } else if (r.stage === 'runOut') {
      if (r.x + brakeDistance < p.runOutStop) inp.throttle = gasFor(STAGE.aiRunOutSpeed); else if (r.v > STAGE.stopSpeed) inp.brake = true; else inp.backUp = true;
    } else if (r.stage === 'backup') {
      if (r.v < -STAGE.stopSpeed) { if (r.x - brakeDistance > p.backupStop) inp.backUp = true; else inp.brake = true; }
      else if (r.x > p.backupStop + 0.05) inp.backUp = true; else inp.throttle = gasFor(STAGE.creepSpeed);
    } else if (r.stage === 'preStage') inp.throttle = gasFor(STAGE.creepSpeed);
    if (r.stage === 'staged' || r.stage === 'preStage') inp.deepStage = p.deepStage && !r.overstaged;
    return inp;
  }
  function step(): void {
    if (s.phase === 'over') return;
    events.length = 0; s.t += DRAG.dt;
    Object.assign(s.weather, conditionsAt(s.t, conditions));      // one front for both lanes, moving with the race clock rather than either car
    const lit = s.armed ? Math.max(0, Math.min(3, Math.floor((s.t - (s.greenAt - 3 * DRAG.amberGap)) / DRAG.amberGap) + 1)) : 0;
    if (!s.green) { if (lit > s.ambers) { s.ambers = lit; events.push({ t: 'amber', n: lit }); } if (s.armed && s.t >= s.greenAt) { s.green = true; s.phase = 'run'; events.push({ t: 'green' }); } }
    s.runners.forEach((r, i) => {
      if (r.ghost) { playGhost(i, r, r.ghost); return; }
      const stageAt = r.plan.launchAt - stageRolloutTime(r.plan.deepStage);
      const inp = r.ai ? (r.launched || r.finished ? { ...NO_INPUT, throttle: autoThrottle(r), launch: s.armed && s.t >= stageAt, brake: r.finished, chute: r.finished, steer: autoSteer(r), deepStage: r.plan.deepStage } : { ...aiStagingInput(r), launch: s.armed && s.t >= stageAt }) : (inputs[i] as DragInput);
      drive(i, r, inp); r.prev = { ...inp }; recordTrace(r);
    });
    updateTree();
    if (s.runners.some(r => r.finished)) s.phase = 'shutdown';
    const done = s.runners.every(r => r.stopped || (s.green && s.t - s.greenAt > 8 && !r.launched)) || s.t > s.greenAt + DRAG.maxTime || (!s.green && s.t > STAGE.timeout);
    if (done) decide();
  }
  if (quick) { arm(); }
  const setInput = (i: number, inp: Partial<DragInput>): void => { Object.assign(inputs[i] as DragInput, inp); };
  return { state: s, events, step, setInput };
}
export type Drag = ReturnType<typeof createDrag>;

/** a runner's timeslip: reaction, the times at each mark (from the launch), the speed at the eighth and the trap speed at the finish (km/h), and the total that decides the race */
export function timeslip(r: Runner): Timeslip {
  const q = r.marks.quarter;
  return { name: r.name, reaction: r.reaction, foul: r.foul, spin: r.spinTime, deepStage: r.deepStage, aborted: r.aborted, crossed: r.crossed, crashed: r.crashed, stopped: r.stopped, ft60: r.marks.ft60, ft330: r.marks.ft330, eighth: r.marks.eighth, ft1000: r.marks.ft1000, trapStart: r.marks.trapStart, hotPsi: r.hotPsi, quarter: q, trap: q !== undefined ? r.trap : undefined, total: q !== undefined && r.reaction !== null ? r.reaction + q : undefined, clutchTemp: r.clutchPeakTemp, clutchCondition: r.clutchCondition, boostPeak: r.boostPeak, enginePeakTemp: r.enginePeakTemp, engineTemp: r.engineTemp, peakRetard: boostRetardAt(r.enginePeakTemp), tireTempL: r.tires[0]!.temp, tireTempR: r.tires[1]!.temp, tireWearL: r.tires[0]!.wear, tireWearR: r.tires[1]!.wear, brakeTemp: r.brakeTemp, brakeFade: r.brakeFade, chuteOpen: r.chuteOpen, rearShare: r.rearShare, nitroUsed: r.nitroUsed ?? 0, nitroPeakGain: r.nitroPeakGain ?? 0, nitroPressure: r.nitroPressure ?? 0, nitroTemp: r.nitroTemp ?? 0, fuelLeft: r.fuel, fuelUsed: r.fuelUsed };
}
/** the perfect-driver run used by the tune screen: this calls the same engine as a race, so the predicted timeslip includes the suspension, wheelie bar and everything else. An `engineTemp` from the session starts the run hot; `nitroDelta` is the quarter-mile time with the bottle minus the same run with no bottle (negative: the shot helped). */
export function predictDrag(spec: DragSpec, tune: Tune, seed: number, conditions?: DragConditions, fuel: number = FUEL.capacity, engineTemp?: number, strip?: DragStrip): { slip: Timeslip; spin: number; runner: Runner; withoutNitro?: Timeslip; nitroDelta?: number } {
  const ai = { react: 0, spread: 0, shiftErr: 0, foul: 0, heatSense: AUTO_DRIVER.heatSense, deepStage: AUTO_DRIVER.deepStage !== false }, warm = (DRAG.tire.windowLo + DRAG.tire.windowHi) / 2, rubber = strip ? cloneDragStrip(strip) : undefined;
  const d = createDrag({ seed, conditions, strip: rubber, quickStart: true, entrants: [{ name: 'YOU', spec, tune: { ...tune, shift: 'auto' }, ai, fuel, engineTemp }] }), r = d.state.runners[0] as Runner;
  r.tireTemp = warm; r.plan.burnout = 0;
  while (d.state.phase !== 'over') d.step();
  const slip = timeslip(r), out = { slip, spin: slip.spin ?? 0, runner: r };
  if (spec.nitroSecs <= 0 || !Number.isFinite(tune.nitroShot) || tune.nitroShot <= 0) return { ...out, withoutNitro: slip, nitroDelta: 0 };
  const dry = createDrag({ seed, conditions, strip: strip ? cloneDragStrip(strip) : undefined, quickStart: true, entrants: [{ name: 'YOU', spec: { ...spec, nitroSecs: 0, nitroMax: 0 }, tune: { ...tune, shift: 'auto' }, ai, engineTemp }] }), noNitro = dry.state.runners[0] as Runner;
  noNitro.tireTemp = warm; noNitro.plan.burnout = 0;
  while (dry.state.phase !== 'over') dry.step();
  const withoutNitro = timeslip(noNitro), delta = withoutNitro.quarter !== undefined && slip.quarter !== undefined ? slip.quarter - withoutNitro.quarter : 0;
  return { ...out, withoutNitro, nitroDelta: delta };
}

/** one sample of a staging path: where a car is, how fast (negative is reversing), what it is doing, and whether it is burning out or reversing (smoke, reverse light) */
export interface StagingSample { t: number; x: number; y: number; v: number; stage: StagePhase; burnout: boolean; reversing: boolean }
/** a canned staging path from the start of the procedure to the moment the car is held in final stage: `duration` seconds long, sampled every `GHOST.step` seconds. It is made by running the auto driver's real staging, so it looks like the procedure and is the same every time for a seed and lane. */
export interface StagingPath { duration: number; samples: StagingSample[]; plan: StagingPlan }
const pathCache = new Map<string, StagingPath>();
/** the ghost's visual staging path for a lane of a race seed. A ghost's elapsed time only starts at the green, so this is only for the eye: the tree arms once the path is done (`duration`) and the player is staged. */
export function ghostStagingPath(seed: number, lane = 1, deepStage = false): StagingPath {
  const key = `${seed >>> 0}|${lane}|${deepStage ? 1 : 0}`, hit = pathCache.get(key); if (hit) return hit;
  const car = DRAG_CARS[0] as DragCarDef, spec = specFor(car, STOCK_PARTS), tune = defaultTune(car), skill: Skill = { ...AUTO_DRIVER, deepStage };
  // the lane argument picks the plan's numbers, so run it as that lane of a two-car race with one car on the line
  const d = createDrag({ seed, conditions: { airC: 20, rho: CONDITIONS.rhoRef, trackC: 35, grip: 1, headwind: 0, crosswind: 0, gust: 0, headPhase: 0, crossPhase: 0 }, entrants: lane === 0 ? [{ name: 'GHOST', spec, tune, ai: skill }] : [{ name: 'LANE0', spec, tune, ai: { ...AUTO_DRIVER, deepStage: false } }, { name: 'GHOST', spec, tune, ai: skill }] });
  const me = d.state.runners[lane === 0 ? 0 : 1] as Runner, samples: StagingSample[] = [];
  let next = 0;
  while (!d.state.armed && d.state.t < STAGE.timeout) { d.step(); if (d.state.t >= next) { samples.push({ t: +d.state.t.toFixed(3), x: +me.x.toFixed(4), y: +me.y.toFixed(4), v: +me.v.toFixed(3), stage: me.stage, burnout: me.burnout, reversing: me.reversing }); next += GHOST.step; } }
  const path: StagingPath = { duration: d.state.t, samples, plan: stagingPlanFor(seed, lane, skill) };
  if (pathCache.size > 64) pathCache.clear(); pathCache.set(key, path); return path;
}
/** the pose along a staging path at a time since the start of the procedure (held at the last sample after the end) */
export function stagingPoseAt(path: StagingPath, t: number): StagingSample {
  const a = path.samples, last = a[a.length - 1];
  if (!last) return { t, x: STAGE.startX, y: 0, v: 0, stage: 'waterBoxApproach', burnout: false, reversing: false };
  if (!(t > a[0]!.t)) return a[0]!; if (t >= last.t) return { ...last, t };
  let lo = 0, hi = a.length - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if ((a[mid] as StagingSample).t <= t) lo = mid; else hi = mid; }
  const p = a[lo] as StagingSample, q = a[hi] as StagingSample, f = (t - p.t) / Math.max(1e-9, q.t - p.t);
  return { t, x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, v: p.v + (q.v - p.v) * f, stage: p.stage, burnout: p.burnout, reversing: p.reversing };
}
