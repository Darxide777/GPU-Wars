// The AUTOPILOT: a driver that races for you. It has no powers the player lacks: every tick it reads what a driver can see (the tree, the gauges, where the car is in the lane) and
// returns a DriverInput, the same shape the keyboard, pad and touch controls produce, which the page hands to `race.setInput` exactly like a manual input.
// It is fully deterministic: no random numbers, no clock; the same car, tune and seed give the same run. Autopilot runs carry `category: 'autopilot'` (see `AUTOPILOT_CATEGORY`)
// so the leaderboard keeps them apart from manual runs.
import { DRAG, LANE, autoThrottle, engineHotShare, stageRolloutTime } from './physics.ts';
import { BOOST } from './tune.ts';
import type { DragConditions, Runner } from './types.ts';
import { IDLE_INPUT, type DriverInput } from '../input/controls.ts';

/** the leaderboard category of a run: autopilot runs are never mixed with manual runs */
export type RunCategory = 'manual' | 'autopilot';
export const AUTOPILOT_CATEGORY: RunCategory = 'autopilot';

/**
 * The staging sequence from the physics (waterBoxApproach -> burnout -> runOut -> backup -> preStage -> staged / deepStaged -> rolling -> launched). The staging sequence is being built in
 * parallel; until the engine reports its phase the autopilot works it out from the car (see `stagePhaseOf`).
 */
export type StagePhase = 'waterBoxApproach' | 'burnout' | 'runOut' | 'backup' | 'preStage' | 'staged' | 'deepStaged' | 'rolling' | 'launched';

/** what the autopilot may look at: the same things a driver sees. Nothing here is the green time (the tree is read light by light). */
export interface AutopilotView {
  /** race clock, seconds */ t: number;
  /** ambers lit so far (0 to 3) and whether the light is green */ ambers: number; green: boolean;
  /** the car */ runner: Runner;
  /** where the car is in the staging sequence, when the engine tells us (undefined: work it out) */ stagePhase?: StagePhase;
  /** the rollout position: metres to the stage beam (negative while short of it). Defaults to the runner's `x`. */ rollout?: number;
  /** the day's air, for the burnout length */ conditions?: Pick<DragConditions, 'airC'>;
}
/** the autopilot's numbers. Turn `reaction` first: it is how long after green the car leaves. */
export const AUTOPILOT = {
  /** seconds after the green that the launch happens: a steady, clean, near-perfect driver, never a red light */ reaction: 0.12,
  /** the longest burnout (seconds) and the tire temperature (C) at which it stops: the tires are in their window */ burnoutMax: 1.5, burnoutTireTemp: 80,
  /** a throttle lift when the tires spin or the limiter is hit comes from the physics's own `autoThrottle` (what a driver would do) */
  /** the gear the nitro is pressed in when the tune leaves it to the driver */ nitroGear: 2,
  /** before the car is staged it creeps with this much gas, and backing up uses this much */ creepGas: 0.35, backUpGas: 0.5,
  /** how long the stage press is held to roll in (seconds) is the engine's own rollout time; this is the margin added before green so the car is on the beam at the right moment */ marginS: 0,
} as const;

/** the staging phase from what the car shows, for an engine that does not report one yet */
export function stagePhaseOf(r: Pick<Runner, 'launched' | 'rolling' | 'deepStage' | 'x' | 'burnout'>): StagePhase {
  if (r.launched) return 'launched'; if (r.rolling) return 'rolling'; if (r.burnout) return 'burnout'; return r.deepStage ? 'deepStaged' : 'staged';
}
/** steering: aim the heading back toward the lane's middle (the same control law the engine's own driver uses, from the car's own sensors) */
export function steerFor(r: Pick<Runner, 'v' | 'y' | 'psi' | 'yawRate' | 'gripLeft'>): number {
  if (r.v < 0.3) return 0;
  const grip = Math.max(0.2, Number.isFinite(r.gripLeft) ? r.gripLeft : 1);
  const psiWant = Math.max(-0.03, Math.min(0.03, -0.25 * r.y)), rateWant = (psiWant - r.psi) * 3 - r.yawRate, lock = LANE.lock / (1 + r.v / LANE.lockFall);
  return Math.max(-1, Math.min(1, Math.atan(rateWant * LANE.base / r.v) / (lock * grip)));
}

export function createAutopilot() {
  let ambersSeen = 0, greenPredicted = Infinity, burnoutDone = false, burnoutStart = -1, prevNitro = false, prevShift = false;
  /** the autopilot's whole decision for one tick */
  function decide(view: AutopilotView): DriverInput {
    const r = view.runner, t = view.t, out: DriverInput = { ...IDLE_INPUT };
    const phase = view.stagePhase ?? stagePhaseOf(r);
    // reading the tree: each amber lights half a second apart and green follows the third by the same gap, so after any amber the green's time is known
    if (view.ambers > ambersSeen) { ambersSeen = view.ambers; greenPredicted = t + (4 - view.ambers) * DRAG.amberGap; }
    out.steer = steerFor(r);
    if (phase === 'launched') return drive(r, out);
    // ---- before the launch ----
    const deep = false;      // (deep staging: the engine's `deepStage` input creeps closer to the line; the autopilot stages normally, which is always legal)
    out.deepStage = deep;
    switch (phase) {
      case 'waterBoxApproach': case 'runOut': out.throttle = AUTOPILOT.creepGas; return out;
      case 'backup': out.backUp = true; out.throttle = AUTOPILOT.backUpGas; return out;
      case 'preStage': out.throttle = AUTOPILOT.creepGas; out.launch = true; return out;      // roll in to the pre-stage beam (the engine's first launch/roll-in press)
      case 'burnout': case 'staged': case 'deepStaged': case 'rolling': break;
    }
    // a burnout warms the tires (shorter when the engine is hot), then the car stages and waits for the tree
    if (!burnoutDone && phase !== 'rolling') {
      if (burnoutStart < 0) burnoutStart = t;
      const hot = engineHotShare(r.engineTemp), limit = AUTOPILOT.burnoutMax * (1 - BOOST.aiSense * BOOST.aiBurnTrim * hot);
      if (view.ambers > 0 || t - burnoutStart >= limit || r.tireTemp >= AUTOPILOT.burnoutTireTemp) burnoutDone = true;
      else { out.throttle = 1; out.burnout = true; return out; }
    }
    out.throttle = 1;      // on the gas at the launch revs
    // roll in at the right moment: the car reaches the line `reaction` seconds after the predicted green
    const rollTime = stageRolloutTime(deep), leaveAt = greenPredicted + AUTOPILOT.reaction - rollTime + AUTOPILOT.marginS;
    out.launch = phase === 'rolling' || (view.ambers > 0 && t >= leaveAt);
    out.shiftUp = false;
    return out;
  }
  /** after the launch: gas with a lift for spin and the limiter, shifts, nitro, and the stop (brake then chute) after the line */
  function drive(r: Runner, out: DriverInput): DriverInput {
    out.deepStage = false;
    if (r.finished) { out.throttle = 0; out.brake = true; out.chute = true; prevNitro = prevShift = false; return out; }
    out.throttle = autoThrottle(r);
    // manual shifting: press shift up once as the revs reach the tune's shift point; an automatic tune shifts itself
    const top = r.gear >= r.tune.ratios.length, want = r.tune.shift === 'manual' && !top && r.shiftT <= 0 && r.shiftPenalty <= 0 && r.rpm >= r.tune.shiftRpm;
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
/** the view from a running engine (what the page passes each tick) */
export function viewOf(race: { state: { t: number; ambers: number; green: boolean; conditions: DragConditions; runners: Runner[] } }, car = 0, stagePhase?: StagePhase): AutopilotView {
  const s = race.state, runner = s.runners[car] as Runner;
  return { t: s.t, ambers: s.ambers, green: s.green, runner, stagePhase, rollout: runner.x, conditions: s.conditions };
}
