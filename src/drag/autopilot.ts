// The AUTOPILOT: a driver that races for you. It has no powers the player lacks: every tick it reads what a driver can see (the tree, the gauges, where the car is in the lane) and
// returns a DriverInput, the same shape the keyboard, pad and touch controls produce, which the page hands to `race.setInput` exactly like a manual input.
// It is fully deterministic: no random numbers, no clock; the same car, tune and seed give the same run. Autopilot runs carry `category: 'autopilot'` (see `AUTOPILOT_CATEGORY`)
// so the leaderboard keeps them apart from manual runs.
import { DRAG, LANE, STAGE, autoThrottle, engineHotShare, stageRolloutTime } from './physics.ts';
import { BOOST, SHIFT_POINT } from './tune.ts';
import type { DragConditions, Runner, StagePhase } from './types.ts';
import { IDLE_INPUT, type DriverInput } from '../input/controls.ts';

/** the leaderboard category of a run: autopilot runs are never mixed with manual runs */
export type RunCategory = 'manual' | 'autopilot';
export const AUTOPILOT_CATEGORY: RunCategory = 'autopilot';

/** what the autopilot may look at: the same things a driver sees. Nothing here is the green time (the tree is read light by light). */
export interface AutopilotView {
  /** race clock, seconds */ t: number;
  /** ambers lit so far (0 to 3) and whether the light is green */ ambers: number; green: boolean;
  /** the car */ runner: Runner;
  /** where the car is in the staging sequence: the engine's own phase (waterBoxApproach, burnout, runOut, backup, preStage, staged, deepStaged, rolling, launched) */ stagePhase: StagePhase;
  /** the day's air, for the burnout length */ conditions?: Pick<DragConditions, 'airC'>;
}
/** the autopilot's numbers. Turn `reaction` first: it is how long after green the car leaves. */
export const AUTOPILOT = {
  /** seconds after the green that the launch happens: a steady, clean, near-perfect driver, never a red light */ reaction: 0.12,
  /** the longest burnout (seconds) and the tire temperature (C) at which it stops: the tires are in their window */ burnoutMax: 5, burnoutTireTemp: 80, /** warm tires do not end the burnout before the car is this far past the start line (metres), so the launch lane gets fresh rubber */ burnoutPastLine: 3,
  /** the gas while rolling to the water box, between the water box and the burnout, and after it (fractions of the pedal) */ approachGas: 0.6, runOutGas: 0.75,
  /** the gas that creeps the car into the beams (slow enough for the stage to hold it), and the longest the burnout may run past the end of the water box (metres) */ creepGas: 0.06, burnoutPastWater: 10,
  /** a throttle lift when the tires spin or the limiter is hit comes from the physics's own `autoThrottle` (what a driver would do) */
  /** the gear the nitro is pressed in when the tune leaves it to the driver */ nitroGear: 2,
  /** how far behind the final beam the back up stops (metres) */ backUpStop: 0.6,
} as const;

/** steering: aim the heading back toward the lane's middle (the same control law the engine's own driver uses, from the car's own sensors) */
export function steerFor(r: Pick<Runner, 'v' | 'y' | 'psi' | 'yawRate' | 'gripLeft'>): number {
  if (r.v < 0.3) return 0;
  const grip = Math.max(0.2, Number.isFinite(r.gripLeft) ? r.gripLeft : 1);
  const psiWant = Math.max(-0.03, Math.min(0.03, -0.25 * r.y)), rateWant = (psiWant - r.psi) * 3 - r.yawRate, lock = LANE.lock / (1 + r.v / LANE.lockFall);
  return Math.max(-1, Math.min(1, Math.atan(rateWant * LANE.base / r.v) / (lock * grip)));
}

export function createAutopilot() {
  let ambersSeen = 0, greenPredicted = Infinity, burnoutStart = -1, burnoutDone = false, prevNitro = false, prevShift = false;
  /** the autopilot's whole decision for one tick. It drives the staging with the same inputs a player has: gas, burnout, brake, back up and the launch (roll-out) press. */
  function decide(view: AutopilotView): DriverInput {
    const r = view.runner, t = view.t, out: DriverInput = { ...IDLE_INPUT }, phase = view.stagePhase;
    // reading the tree: each amber lights half a second apart and green follows the third by the same gap, so after any amber the green's time is known
    if (view.ambers > ambersSeen) { ambersSeen = view.ambers; greenPredicted = t + (4 - view.ambers) * DRAG.amberGap; }
    out.steer = steerFor(r);
    if (phase === 'launched') return drive(r, out);
    const brakeDistance = r.v * r.v / (2 * STAGE.brakeDecel);
    switch (phase) {
      case 'waterBoxApproach': case 'burnout': {
        // roll to the water box, burn out (shorter when the engine is hot, and until the tires are in their window), then roll on
        if (r.x < STAGE.waterBoxStart + 1) { out.throttle = AUTOPILOT.approachGas; return out; }
        if (!burnoutDone) {
          if (burnoutStart < 0) burnoutStart = t;
          const hot = engineHotShare(r.engineTemp), limit = AUTOPILOT.burnoutMax * (1 - BOOST.aiSense * BOOST.aiBurnTrim * hot);
          if (t - burnoutStart >= limit || (r.tireTemp >= AUTOPILOT.burnoutTireTemp && r.x >= AUTOPILOT.burnoutPastLine) || r.x >= STAGE.waterBoxEnd + AUTOPILOT.burnoutPastWater) burnoutDone = true;
          else { out.throttle = 1; out.burnout = true; return out; }
        }
        out.throttle = AUTOPILOT.runOutGas; return out;
      }
      case 'runOut':
        // run out past the tree, stop, then reverse
        if (r.x + brakeDistance < STAGE.runOutPastTree) out.throttle = AUTOPILOT.runOutGas; else if (r.v > STAGE.stopSpeed) out.brake = true; else out.backUp = true;
        return out;
      case 'backup':
        // reverse until just behind the pre-stage beam, stop, then creep forward into the beams
        if (r.v < -STAGE.stopSpeed) { if (r.x - brakeDistance > -AUTOPILOT.backUpStop - 0.05) out.backUp = true; else out.brake = true; }
        else if (r.x > -AUTOPILOT.backUpStop) out.backUp = true; else out.throttle = AUTOPILOT.creepGas;
        return out;
      case 'preStage': out.throttle = AUTOPILOT.creepGas; return out;      // creep into the stage beam: the engine holds a slow car there
      case 'staged': case 'deepStaged': case 'rolling': break;
    }
    // staged: gas on the launch revs, then press launch (roll out) at the moment that puts the car on the final beam `reaction` seconds after the green
    out.throttle = 1;
    const rollTime = stageRolloutTime(phase === 'deepStaged' || r.deepStage), leaveAt = greenPredicted + AUTOPILOT.reaction - rollTime;
    out.launch = phase === 'rolling' || (view.ambers > 0 && t >= leaveAt);
    return out;
  }
  /** after the launch: gas with a lift for spin and the limiter, shifts, nitro, and the stop (brake then chute) after the line */
  function drive(r: Runner, out: DriverInput): DriverInput {
    out.deepStage = false;
    if (r.finished) { out.throttle = 0; out.brake = true; out.chute = true; prevNitro = prevShift = false; return out; }
    out.throttle = autoThrottle(r);
    // manual shifting: press shift up once as the revs reach the tune's shift point; an automatic tune shifts itself
    const shiftAt = Math.min(r.tune.shiftRpm, r.spec.redline - SHIFT_POINT.lampRpm);
    const top = r.gear >= r.tune.ratios.length, want = r.tune.shift === 'manual' && !top && r.shiftT <= 0 && r.shiftPenalty <= 0 && r.rpm >= shiftAt;
    out.shiftUp = want && !prevShift; prevShift = want;
    // nitro: by hand once, in the autopilot's gear, when the tune leaves it to the driver and the bottle has some left
    const nitroWant = r.tune.nitroGear === 0 && r.nitroLeft > 0 && !r.nitroOn && r.gear >= AUTOPILOT.nitroGear;
    out.nitro = nitroWant && !prevNitro; prevNitro = nitroWant;
    out.chute = false;
    return out;
  }
  return { decide, category: AUTOPILOT_CATEGORY };
}
export type Autopilot = ReturnType<typeof createAutopilot>;
/** the view from a running engine (what the page passes each tick): the engine's own staging phase comes in as `stagePhase` */
export function viewOf(race: { state: { t: number; ambers: number; green: boolean; conditions: DragConditions; runners: Runner[] } }, car: number, stagePhase: StagePhase): AutopilotView {
  const s = race.state, runner = s.runners[car] as Runner;
  return { t: s.t, ambers: s.ambers, green: s.green, runner, stagePhase, conditions: s.conditions };
}
