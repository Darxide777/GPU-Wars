// What drag racing is made of: the car, its stock parts, the tune you set, the run itself, and a replay of your best pass. Plain data, so a race can be replayed.

/** a drag car as it comes from the factory (there is no dealer or shop in GPU Wars) */
export interface DragCarDef {
  id: string; name: string; col: string; trim: string;
  /** kg */ mass: number;
  /** the engine: peak torque (Nm) at `peakRpm`, idling at `idle`, the limiter at `redline` */ torque: number; peakRpm: number; idle: number; redline: number;
  /** the gearbox it comes with: the number of gears, their ratios and the final drive; the drivetrain efficiency of each stock gear (0 to 1) */ gears: number[]; gearEff: number[]; final: number;
  /** tire radius (m), grip (1 is a street tire), the share of the weight on the driven (rear) wheels, the frontal drag (Cd x area, m2) */ tire: number; grip: number; rear: number; cda: number;
  /** a sentence about the car */ blurb: string;
}
export type PartId = 'turbo' | 'gearbox' | 'clutch' | 'tires' | 'weight' | 'nitro' | 'aero';
/** a part of the car and its top level; GPU Wars has no shop, so every car runs the top level as stock parts (see STOCK_PARTS in data.ts) */
export interface PartDef { id: PartId; name: string; max: number; what: string }
/** a car's part levels (0 is the bare chassis) */
export type Parts = Partial<Record<PartId, number>>;

/** everything you can set for a car: deep tuning */
export interface Tune {
  /** 'manual': you shift with a key at the right moment; 'auto': it shifts at `shiftRpm` */ shift: 'manual' | 'auto';
  /** the ratio of each gear (first is the shortest), and the final drive */ ratios: number[]; final: number;
  /** revs held by the launch control on the line, and how hard the clutch is let out (0 gentle, 10 aggressive) */ launchRpm: number; launchAggression: number;
  /** where the automatic shifts up */ shiftRpm: number;
  /** tire pressure in psi: lower grips more off the line but rolls heavier */ pressure: number;
  /** kg of ballast over the rear wheels: more grip, more weight */ ballast: number;
  /** suspension stiffness and wheelie-bar limit, 0 to 10: softer lets the nose rise sooner, a longer bar lets it rise further */ stiffness: number; wheelieBar: number;
  /** the nitro: how big a shot (extra torque, 0 to 1) and when it fires: 0 by hand (the nitro key), or in gear n */ nitroShot: number; nitroGear: number;
  /** the share of the blower's boost you ask for (0 to 1); past BOOST.safeLimit it heats the clutch faster, and sustained boost soaks the engine and retards the timing */ boostLimit: number;
}

export interface DragStrip { rubber: number[][][]; version: number }
export interface GhostSample { t: number; x: number; y: number; psi: number; v: number }
export interface DragGhost { car: string; name: string; reaction: number; marks: Partial<Record<Mark, number>>; trap: number; total: number; samples: GhostSample[]; deepStage?: boolean }
export type DragRaceKind = 'test' | 'solo' | 'ghost';

/** a seeded weather front: how far the air, track and grip move from the forecast during a run, and the gust's phase */
export interface WeatherFront { air: number; track: number; grip: number; phase: number }
export interface DragConditions {
  airC: number; rho: number;
  /** metres above sea level; missing on older conditions is a sea-level strip */ altitude?: number;
  trackC: number;
  grip: number;
  headwind: number; crosswind: number; gust: number; headPhase: number; crossPhase: number;
  /** missing on older conditions: the day stays as forecast all the way down the strip */
  weather?: WeatherFront;
}

/** a car ready to race: the dealer car with its parts applied (what the physics uses) */
/** a rev/torque map: torque as a share of the peak from idle up to `peakRpm` (`rise`) and from `peakRpm` to the limiter (`fall`); each point is [how far along 0 to 1, the share] */
export interface TorqueCurve { rise: readonly (readonly [number, number])[]; fall: readonly (readonly [number, number])[] }
export interface DragSpec {
  name: string; col: string; trim: string; mass: number; torque: number; peakRpm: number; idle: number; redline: number; gearsMax: number;
  tire: number; grip: number; rear: number; /** kg on the driven wheels (losing weight takes it off the front) */ rearKg: number; cda: number; shiftTime: number; /** seconds of nitro at a full shot (0: no bottle) */ nitroSecs: number; nitroMax: number;
  /** drivetrain efficiency in each gear, aligned with the tune's ratios */
  gearEff: number[];
  /** the blower's full boost multiplier (0 with no part) and the seconds it takes to reach 90% of its target */
  boostCap: number; boostLag: number;
  /** this car's own torque curve; missing means the shared ENGINE.map (the stock dragster with no benchmark) */ curve?: TorqueCurve;
  /** clutch: torque share while slipping, heat capacity, wear resistance and the condition this run starts with (1 new) */
  clutchShare: number; clutchHeatCapacity: number; clutchWearResist: number; clutchCondition: number;
}

/** how the automatic driver reacts and shifts; `heatSense` lets it back off boost and shorten a burnout when the engine is hot */
export interface Skill { react: number; spread: number; shiftErr: number; foul: number; fuelSense?: number; heatSense?: number; deepStage?: boolean }

/** what a driver asks for this tick: the gas (0 to 1), launching (roll out of the staging beam), shifting up and the nitro (both by a press), and the brake held with the gas to burn out */
export interface DragInput { throttle: number; /** clutch engagement: 0 pedal in/disengaged, 1 released/engaged; missing means automatic */ clutch?: number; launch: boolean; shiftUp: boolean; nitro: boolean; /** held with the gas while staged: the rear tires spin and heat */ burnout: boolean; /** held after the line to stop */ brake: boolean; /** pressed after the line to drop the chute, or before it to abort the start */ chute: boolean; /** held while pre-staged or staged to creep closer to the line (deep stage) */ deepStage?: boolean; /** held to reverse slowly (the BACK UP of the staging sequence); missing means not held */ backUp?: boolean; /** pressed in manual shifting to go down a gear (refused if it would over-rev the engine); missing means not pressed */ shiftDown?: boolean; /** -1 full left to 1 full right */ steer?: number }

/** one rear slick: temperature (C) and wear (0 new, 1 worn out) this run */
export interface DragTire { temp: number; wear: number }

/** where one car is in the run */
export interface Runner {
  name: string; spec: DragSpec; tune: Tune; ai: Skill | null;
  x: number; v: number; rpm: number; gear: number; launched: boolean; rolling: boolean; deepStage: boolean; aborted: boolean; launchT: number; shiftT: number; nitroLeft: number; nitroOn: boolean; spin: boolean; limiter: boolean;
  /** shift quality: the wheel rpm the next gear should land on, penalty time left after a bad shift, and whether the last shift was missed */ shiftTargetRpm: number; shiftPenalty: number; shiftMissed: boolean;
  /** the bottle this run: seconds fired, its temperature (C), pressure (0 to 1), the torque gain now and the best gain reached */ nitroUsed: number; nitroTemp: number; nitroPressure: number; nitroGain: number; nitroPeakGain: number;
  /** the rear tires' temperature (C), the mean of the two slicks, and whether they are burning out on the line now */ tireTemp: number; burnout: boolean;
  /** the left and right rear slicks, with their own temperature and wear; tireTemp is their mean */ tires: [DragTire, DragTire];
  /** the clutch's temperature now and its peak this run (C), seconds of slip this run, its condition at the start of the run, whether the plates have locked and when */
  clutchTemp: number; clutchPeakTemp: number; clutchSlip: number; clutchCondition: number; clutchLocked: boolean; clutchLockT: number;
  /** seconds from green to the launch (negative: jumped the start), and when it crossed each mark */ reaction: number | null; foul: boolean; marks: Partial<Record<Mark, number>>; trap: number; finished: boolean;
  ghost?: DragGhost; trace: GhostSample[];
  /** after the line: braking and the chute, whether the car stopped before the end of the strip or crashed, and when */ shutdown: boolean; brake: boolean; chute: boolean; stopped: boolean; crashed: boolean; crashT: number;
  /** brake temperature (C) and the share of braking left after fade; the chute's age and how far it has opened (0 to 1) */ brakeTemp: number; brakeFade: number; chuteT: number; chuteOpen: number;
  /** seconds the rear tires spent spinning this run */ spinTime: number;
  /** the AI's plan: when it will launch, its shift points, and the staging plan (see StagingPlan) */ plan: { launchAt: number; shifts: number[]; /** metres of dry burnout after the water box (0: none) */ burnout: number; deepStage: boolean; /** how long after green it rolls out: negative is a red light (set when the tree arms) */ reactFromGreen: number; /** metres past the line where the run-out stops, and where the back up stops (behind the pre-stage beam) */ runOutStop: number; backupStop: number };
  prev: DragInput;
  /** across the lane: metres to the car's right of the lane's middle, the heading (rad, + to the right), how fast it turns, the steering now (-1 to 1); which rear wheel spins; over the centre line (a disqualification) and when; against the wall */
  y: number; psi: number; yawRate: number; steer: number; spinL: boolean; spinR: boolean; crossed: boolean; foulT: number; wall: boolean;
  /** grip left for turning after the slicks spend some of it driving (0 to 1), and the turn the wheel asks for that the tires cannot deliver (rad) */
  gripLeft: number; drift: number;
  /** the body's pitch (rad, nose up), its rate, the share of weight on the rear wheels, and front-wheel lift (0 to 1, past the lift pitch) */
  pitch: number; pitchRate: number; rearShare: number; lift: number;
  /** the blower's charge now (0 to 1) and its peak this run */
  boost: number; boostPeak: number;
  /** the engine's temperature now and its peak this run (C), and the share of torque the timing retard is costing now */
  engineTemp: number; enginePeakTemp: number; retard: number;
  fuel: number; fuelUsed: number;
  /** where the car is in the staging sequence before the launch (see StagePhase) */ stage: StagePhase;
  /** the pre-stage and stage bulbs on the strip's beams, and whether the car crept past the stage beam into the over-stage zone (the stage bulb is reset until it backs out) */ preBulb: boolean; stageBulb: boolean; overstaged: boolean;
  /** metres burned out this staging run (dry and wet), seconds held still in final stage, whether the reverse light is on, and how wet the slicks still are (0 dry, 1 straight out of the water box) */ burnDistance: number; stagedFor: number; reversing: boolean; wet: number;
  /** the gear a shift in progress is going to (up or down) */ shiftTo: number;
  /** longitudinal acceleration of the car this tick (m/s2) and the weight moved to the rear by the sprung part of the car (a share of the weight, lags behind the acceleration) */ accel: number; sprungTransfer: number;
  /** the tire pressure after the tires have heated up (psi), the left and right rear mean */ hotPsi: number;
}
/** where a car is before the launch: it rolls up to the water box, does a burnout while moving, runs out past the tree, backs up to the pre-stage beam, creeps to stage (or deep stage), then rolls out to the final beam and launches */
export type StagePhase = 'waterBoxApproach' | 'burnout' | 'runOut' | 'backup' | 'preStage' | 'staged' | 'deepStaged' | 'rolling' | 'launched';
export type Mark = 'ft60' | 'ft330' | 'eighth' | 'ft1000' | 'trapStart' | 'quarter';
export interface Timeslip { name: string; reaction: number | null; foul: boolean; /** seconds of wheelspin; missing on older callers */ spin?: number; deepStage?: boolean; aborted?: boolean; crossed?: boolean; crashed?: boolean; stopped?: boolean; ft60?: number; ft330?: number; eighth?: number; eighthSpeed?: number; ft1000?: number; quarter?: number; trap?: number; /** the average speed over the last 66 ft is `trap`; this is the same window's start time (s from the launch) */ trapStart?: number; total?: number; /** hot tire pressure at the finish (psi), left and right */ hotPsi?: number; clutchTemp?: number; clutchCondition?: number; boostPeak?: number; enginePeakTemp?: number; engineTemp?: number; peakRetard?: number; tireTempL?: number; tireTempR?: number; tireWearL?: number; tireWearR?: number; /** the run-out stop: brake temperature (C) and braking left after fade, how far the chute opened, and the rear weight share at the line */ brakeTemp?: number; brakeFade?: number; chuteOpen?: number; rearShare?: number; /** nitrous: seconds fired, its peak torque share and the bottle at the finish */ nitroUsed?: number; nitroPeakGain?: number; nitroPressure?: number; nitroTemp?: number; fuelLeft?: number; fuelUsed?: number }
export type DragEvent = { t: 'amber'; n: number } | { t: 'green' } | { t: 'rollout'; car: number } | { t: 'launch'; car: number } | { t: 'abort'; car: number } | { t: 'foul'; car: number } | { t: 'shift'; car: number; gear: number } | { t: 'spin'; car: number } | { t: 'wheelie'; car: number } | { t: 'nitro'; car: number } | { t: 'chute'; car: number } | { t: 'cross'; car: number } | { t: 'wall'; car: number } | { t: 'finish'; car: number } | { t: 'crash'; car: number } | { t: 'over'; winner: number };
