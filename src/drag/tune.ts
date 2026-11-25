// A car's numbers once its parts are fitted, the tune it starts with, and a tune kept within what the car allows (so a bad save or a slider at its end can never break a run).
import { PARTS } from './data.ts';
import type { DragCarDef, DragSpec, PartId, Parts, Tune } from './types.ts';

const clamp = (v: unknown, lo: number, hi: number, d = lo): number => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
export const DRIVETRAIN = { eff: 0.88, minEff: 0.5, maxEff: 1 } as const;
export const CLUTCH = {
  aggressionMin: 0, aggressionMax: 10, aggressionDefault: 5, aggressionMid: 5, biteStep: 0.06,
  /** the clutch locks once the engine and wheel revs are within this gap, then drags for a moment as the plates settle */
  lockRpm: 50, lockedDrag: 0.015, lockedDragTime: 0.5,
  baseShare: 1, partShare: 0, shareMin: 0.55, shareMax: 1, aggressionShareLow: 0.85, aggressionShareStep: 0.03,
  partHeatCapacity: 0.12, partWearResist: 0.12, shiftTimeBonus: 0.012,
  ambient: 20, maxTemp: 600, heatPerJoule: 0.0012, cool: 0.08, airflowCool: 0.0005, radPerRpm: 2 * Math.PI / 60,
  fadeFrom: 120, fadeTorque: 0.5,
  minCondition: 0.35, minConditionTorque: 0.78, wearPerRun: 0.05, wearPerSlipSecond: 0.08, wearHotTemp: 240, wearPerHotLaunch: 0.14,
} as const;

export const level = (parts: Parts, id: PartId): number => { const max = PARTS.find(p => p.id === id)?.max ?? 0; return Math.max(0, Math.min(max, Math.floor(parts[id] ?? 0))); };
const SHIFT_TIME = [0.32, 0.24, 0.17, 0.11, 0.07];
/** shift quality: torque interruption is the shift timer; revs match the next gear's wheel speed during the shift, lift-off drops them faster and lift-on holds them up. A hot clutch or spinning tires can miss the shift and add penalty time. Turn `SHIFT_TIME` first, then `CLUTCH.shiftTimeBonus`, then `missedHeatFrom`/`missedSpin`. */
export const SHIFT_QUALITY = {
  liftOnRpmShare: 0.35, liftOffDrop: 1.25, matchWindow: 220, penaltyMax: 0.22, penaltySlipHeat: 1.5,
  missedHeatFrom: 0.45, missedHeatMax: 0.18, missedSpin: 0.12, missedClutchSlip: 0.08,
} as const;
/** suspension tune levels: 0 to 10, with 5 in the middle. A longer wheelie bar lets the nose rise further before it stops it. */
export const SUSPENSION_TUNE = { stiffness: { min: 0, max: 10, def: 5 }, wheelieBar: { min: 0, max: 10, def: 5 } } as const;
/** the blower: its flat torque, peak and limiter gains, the boost each level allows, and the seconds to 90% boost at levels 1-6. Turn `lagByLevel` first. */
export const TURBO = {
  torquePerLevel: 0.05, peakRpmPerLevel: 200, redlinePerLevel: 200, boostPerLevel: 0.06,
  lagByLevel: [0.75, 0.66, 0.57, 0.48, 0.39, 0.30] as const,
} as const;
/** boost: charge rises toward a rev-based target after launch, drops on each shift, and above `safeLimit` heats the clutch more. Sustained charge soaks heat into the engine, which retards the timing and fades torque instead of cutting grip. Engine load, revs, clutch slip and holding the gas on the line heat it too; recovery slows as it soaks and a hot day adds to the load heat. Turn `heatFade` after TURBO.lagByLevel, then `heatPerCharge` and `safeLimit`, then the new `heatLoad` and `heatBurnout`. */
export const BOOST = {
  minLimit: 0, maxLimit: 1, defaultLimit: 0.8, step: 0.05, safeLimit: 0.8, riskSpan: 0.2,
  minRpmShare: 0.25, riseFactor: Math.log(10), minLag: 0.05, shiftMax: 0.2,
  riskHeat: 0.35, heatPerCharge: 120, heatRisk: 1, heatCool: 0.45, heatAirCool: 0.0006,
  heatFadeFrom: 90, heatMax: 220, heatFade: 0.25,
  /** engine heat beyond boost: C/s from load at full torque and revs, from clutch slip at `slipRef` rad/s, from holding the gas on the line and from a burnout; heat above `heatFadeFrom` cools `heatSoakCool` slower, and each C of air over the reference adds `heatAirGain` of load heat */
  heatLoad: 4, heatLoadMax: 2, heatSlip: 6, slipRef: 200, heatLine: 5, heatBurnout: 12, heatSoakCool: 0.45, heatAirGain: 0.012,
  /** the auto driver opens the wastegate when hot and cuts its burnout short: `aiTrim` is the most boost it gives up at full soak, after `aiTrimFrom` */
  aiSense: 1, aiTrimFrom: 0.1, aiTrim: 0.35, aiBurnTrim: 0.8,
  /** thin air: the blower makes up this share (0 to 1, times the charge it has) of the torque a thin day takes away, and each unit of density it makes up soaks `chargeHeatPerComp` C/s into the engine (a hot, thin day taxes a boosted car). Turn `densityCompensation` first. */
  densityCompensation: 0.7, chargeHeatPerComp: 40,
} as const;
/** the bottle: the shot is full while it is above `taperFrom` pressure, then fades to `taperShare` of the tune's shot as it empties. Firing warms the bottle, which raises its pressure; cooling pulls it back toward the day. Turn `LIMITS.nitroShot` first (how big the asked-for shot is), then `taperFrom`, then `pressurePerC`. */
export const NITRO = {
  refTempC: 20, heatPerSecond: 12, cool: 0.35, pressurePerC: 0.004, taperFrom: 0.55, taperShare: 0.55,
} as const;
/** the engine: a named rev/torque map (torque as a fraction of peak, from idle to `peakRpm` and then to `redline`), a limiter that fades torque over its last `span` revs instead of cutting it, and the drag of a closed throttle. Turn `DRAG.rev` first (how fast the revs move), then `map.rise`/`map.fall`, then `limiter.span`/`limiter.cut`, then `brake.share`. */
export const ENGINE = {
  map: {
    rise: [[0, 0.55], [0.25, 0.722], [0.5, 0.868], [0.75, 0.966], [1, 1]] as const,
    fall: [[0, 1], [0.4, 0.965], [0.7, 0.892], [1, 0.78]] as const,
  },
  limiter: { span: 250, cut: 1 },
  brake: { share: 0.06 },
  /** a naturally aspirated engine makes torque in proportion to the air it breathes: torque x (density / reference density) to this power. 1 is a straight proportion; turn it first to make a thin or hot day matter more or less. */
  densityTorqueExp: 1,
  /** below this pedal position a staged car is not burning the tires */
  burnMin: 0.5,
  /** the auto driver lifts for wheelspin and over-revs rather than fighting them, then goes back to full gas */
  ai: { spinLift: 0.98, limitLift: 0.95, min: 0.9 },
} as const;
/** tires: the contact patch likes one hot pressure. Below it the tire squirms and overheats (grip falls `underSlope` per psi), above it the patch shrinks (grip falls `overSlope` per psi). Pressure climbs `psiPerC` for every degree C the tire is above the day's air, so the cold pressure you set is lower than the hot one that matters.
 * `refHotPsi` is the hot pressure that gives a grip of exactly 1. Turn `optimalHotPsi` first (where the peak is), then `psiWindow` (the flat top), then `heatFromUnderInflation` (C/s per psi under the optimum, while rolling fast). */
export const TIRE = { optimalHotPsi: 24, psiWindow: 1.5, refHotPsi: 29, underSlope: 0.03, psiPerC: 0.035, heatFromUnderInflation: 0.35, heatMinSpeed: 5 } as const;
/** the car with its parts on: what the physics drives */
export function specFor(car: DragCarDef, parts: Parts, clutchCondition = 1): DragSpec {
  const L = (id: PartId): number => level(parts, id), n = L('nitro'), gearsMax = car.gears.length + (L('gearbox') >= 2 ? 1 : 0);
  const eff = car.gears.map((_, i) => +clamp(car.gearEff?.[i], DRIVETRAIN.minEff, DRIVETRAIN.maxEff, DRIVETRAIN.eff).toFixed(3));
  const extraEff = eff[eff.length - 1] ?? DRIVETRAIN.eff; while (eff.length < gearsMax) eff.push(extraEff);
  return {
    name: car.name, col: car.col, trim: car.trim,
    mass: car.mass - 40 * L('weight'),
    torque: car.torque * (1 + TURBO.torquePerLevel * L('turbo')), peakRpm: car.peakRpm + TURBO.peakRpmPerLevel * L('turbo'), idle: car.idle, redline: car.redline + TURBO.redlinePerLevel * L('turbo'),
    boostCap: +(TURBO.boostPerLevel * L('turbo')).toFixed(3), boostLag: TURBO.lagByLevel[Math.max(0, L('turbo') - 1)] ?? TURBO.lagByLevel[0]!,
    gearsMax,
    tire: car.tire, rearKg: car.mass * car.rear, grip: car.grip * (1 + [0, 0.12, 0.26, 0.42, 0.6, 0.8, 1.0][L('tires')]!), rear: car.rear, cda: car.cda * (1 - 0.07 * L('aero')),
    shiftTime: Math.max(0.04, (SHIFT_TIME[L('gearbox')] as number) - L('clutch') * CLUTCH.shiftTimeBonus), nitroSecs: [0, 2.5, 3.5, 4.5, 5.5][n] as number, nitroMax: [0, 0.25, 0.35, 0.45, 0.6][n] as number,
    gearEff: eff,
    clutchShare: +clamp(CLUTCH.baseShare + L('clutch') * CLUTCH.partShare, CLUTCH.shareMin, CLUTCH.shareMax, CLUTCH.baseShare).toFixed(3),
    clutchHeatCapacity: +(1 + L('clutch') * CLUTCH.partHeatCapacity).toFixed(3), clutchWearResist: +(1 + L('clutch') * CLUTCH.partWearResist).toFixed(3),
    clutchCondition: +clamp(clutchCondition, CLUTCH.minCondition, 1, 1).toFixed(3),
  };
}
/** straight-line interpolation through one side of the named engine map */
const mapAt = (points: readonly (readonly [number, number])[], f: number): number => {
  const x = clamp(f, 0, 1), last = points[points.length - 1] as readonly [number, number];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as readonly [number, number], b = points[i] as readonly [number, number];
    if (x <= b[0]) return a[1] + (b[1] - a[1]) * clamp((x - a[0]) / Math.max(1e-9, b[0] - a[0]), 0, 1);
  }
  return last[1];
};
/** the named rev/torque map: the torque at `rpm` as a fraction of the peak, rising to `peakRpm` and falling toward the limiter */
export function torqueShape(spec: Pick<DragSpec, 'idle' | 'peakRpm' | 'redline'>, rpm: number): number {
  const r = Math.max(spec.idle, Math.min(spec.redline, rpm));
  return r <= spec.peakRpm ? mapAt(ENGINE.map.rise, (r - spec.idle) / Math.max(1, spec.peakRpm - spec.idle)) : mapAt(ENGINE.map.fall, (r - spec.peakRpm) / Math.max(1, spec.redline - spec.peakRpm));
}
/** the torque left in the soft part of the limiter: full until `redline - span`, fading to `1 - cut` at the redline */
export const limiterTorqueShare = (spec: Pick<DragSpec, 'redline'>, rpm: number): number => 1 - ENGINE.limiter.cut * clamp((rpm - (spec.redline - ENGINE.limiter.span)) / Math.max(1, ENGINE.limiter.span), 0, 1);

/** a car's first tune: its own gearing, a gentle launch and shifts near the limiter, normal tires, no ballast, nitro by hand */
export function defaultTune(car: DragCarDef): Tune {
  return { shift: 'auto', ratios: [...car.gears], final: car.final, launchRpm: Math.round((car.idle + car.peakRpm) / 2 / 100) * 100, launchAggression: CLUTCH.aggressionDefault, shiftRpm: Math.round((car.redline - 300) / 100) * 100, pressure: 28, ballast: 0, stiffness: SUSPENSION_TUNE.stiffness.def, wheelieBar: SUSPENSION_TUNE.wheelieBar.def, nitroShot: 0.25, nitroGear: 0, boostLimit: BOOST.defaultLimit };
}
export const LIMITS = { ratio: [0.5, 5], final: [2.2, 5.5], pressure: [12, 40], ballast: [0, 120], nitroShot: [0.05, 0.6], launchAggression: [CLUTCH.aggressionMin, CLUTCH.aggressionMax], stiffness: [SUSPENSION_TUNE.stiffness.min, SUSPENSION_TUNE.stiffness.max], wheelieBar: [SUSPENSION_TUNE.wheelieBar.min, SUSPENSION_TUNE.wheelieBar.max], boostLimit: [BOOST.minLimit, BOOST.maxLimit] } as const;
/** a tune made safe for this car and its parts: as many gears as it has, every number in its range */
export function cleanTune(raw: Partial<Tune> | null | undefined, car: DragCarDef, spec: DragSpec): Tune {
  const d = defaultTune(car), r = raw ?? {}, n = spec.gearsMax, ratios: number[] = [];
  for (let i = 0; i < n; i++) { const fallback = d.ratios[i] ?? Math.max(LIMITS.ratio[0], (ratios[i - 1] ?? 1) * 0.82); ratios.push(+clamp(r.ratios?.[i], LIMITS.ratio[0], LIMITS.ratio[1], fallback).toFixed(2)); }
  return {
    shift: r.shift === 'manual' ? 'manual' : 'auto', ratios, final: +clamp(r.final, LIMITS.final[0], LIMITS.final[1], d.final).toFixed(2),
    launchRpm: Math.round(clamp(r.launchRpm, spec.idle, spec.redline, d.launchRpm)), launchAggression: Math.round(clamp(r.launchAggression, LIMITS.launchAggression[0], LIMITS.launchAggression[1], d.launchAggression)), shiftRpm: Math.round(clamp(r.shiftRpm, spec.idle + 500, spec.redline, Math.min(spec.redline, d.shiftRpm))),
    pressure: Math.round(clamp(r.pressure, LIMITS.pressure[0], LIMITS.pressure[1], d.pressure)), ballast: Math.round(clamp(r.ballast, LIMITS.ballast[0], LIMITS.ballast[1], d.ballast)),
    stiffness: Math.round(clamp(r.stiffness, LIMITS.stiffness[0], LIMITS.stiffness[1], d.stiffness)), wheelieBar: Math.round(clamp(r.wheelieBar, LIMITS.wheelieBar[0], LIMITS.wheelieBar[1], d.wheelieBar)),
    nitroShot: +clamp(r.nitroShot, LIMITS.nitroShot[0], Math.max(LIMITS.nitroShot[0], spec.nitroMax || LIMITS.nitroShot[0]), d.nitroShot).toFixed(2), nitroGear: Math.round(clamp(r.nitroGear, 0, n, 0)),
    boostLimit: +clamp(r.boostLimit, LIMITS.boostLimit[0], LIMITS.boostLimit[1], d.boostLimit).toFixed(2),
  };
}
