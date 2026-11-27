// The AUTOPILOT: a driver that laps for you. It has no powers the player lacks: every tick it reads what a driver can see (the lights, the car, the road ahead) and returns a `FormulaInput`, the same shape the keyboard, pad and touch
// controls produce, which the page hands to `race.step` exactly like a manual input. Its steering and speed control are the ACE BOT of Chromium Halo: Neon (src/arena/raceBot.ts, the race simulation branch): follow the middle line of the
// road aiming a few points ahead, look down the road and be slow enough for each bend by the time it comes (braking a little short of the car's best), keep off the wall. On top of that it does what a person does: reacts to the green,
// shifts the manual gearbox, and opens a nitro bottle on a straight. Fully deterministic: no random numbers, no clock; the same car, tune and track give the same lap. Autopilot laps carry `category: 'autopilot'` so the leaderboard
// keeps them apart from manual laps.
import { FORMULA_DT, GEARS, GRIP, LAP, LIGHTS } from './constants.ts';
import { cornerSpeed, wrapAngle } from './physics.ts';
import { nearestOnRoad, roadRay } from './road.ts';
import { createFormulaRace, type FormulaRace, type FormulaRaceOptions, type FormulaView } from './race.ts';
import { IDLE_FORMULA_INPUT, type CarStats, type FormulaInput, type FormulaTrack, type Point } from './types.ts';

/** the leaderboard category of a lap: autopilot laps are never mixed with manual laps */
export type RunCategory = 'manual' | 'autopilot';
export const AUTOPILOT_CATEGORY: RunCategory = 'autopilot';

/** the autopilot's numbers. Turn `reaction` first: it is how long after the green the car leaves. */
export const AUTOPILOT = {
  /** seconds after the green that the gas goes down: a steady, clean, near-perfect driver, never a jump start */ reaction: 0.12,
  /** how it follows the line: the path points it aims ahead of its waypoint, the metres of the bend it looks at for the heading, and the metres it keeps to the side of the middle line (positive is the driver's right) */ aim: 4, bendLook: 26, lane: 0,
  /** the speed it aims for on a clear road, as a multiple of the car's top speed: a little over 1, so the gas stays pinned at the top speed instead of easing off and braking when the car is already there (that sounded like lifting on a plain oval you can drive flat out) */ topSpeedAim: 1.06,
  /** how much it slows for the bend coming up in the next few metres (0: none, the cars take every bend at their limit), how much it slows for being off its line, and how hard it holds the gas */ cornerSlow: 0, errSlow: 0.1, gas: 3,
  /** looking down the road for bends: how many path points ahead, how close to the car's cornering limit it takes one, and how much of its braking it counts on */ brakeLook: 60, cornerMargin: 1.0, brakeMargin: 0.85,
  /** how hard it steers for each radian of error, and the metres from the wall at which it starts to move away from it and the slowing it gives for a wall close ahead */ steerGain: 2.6, wallLook: 9, wallSlow: 0.25,
  /** the gears: it shifts up at this share of the gear's revs (a little under the limiter) and down below this share */ shiftUpAt: 0.93, shiftDownAt: 0.3,
  /** the nitro: it opens a bottle on a straight (heading within `nitroErr` radians of the line, the bend ahead within `nitroTurn`) once the car is under this share of its top speed */ nitroErr: 0.1, nitroTurn: 0.2, nitroBelow: 0.85,
  /** stuck (under 1.5 m/s with the gas down for this long): back out for this long, the steering alternating each time */ stuckAfter: 0.7, backOut: 0.9,
} as const;

/** what the autopilot may look at: the same things a driver sees (the view the page draws from) */
export type AutopilotView = Pick<FormulaView, 'phase' | 'raceTime' | 'car'>;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** the autopilot for a car on a track: it knows its own car's limits (top speed, grip, downforce, gearbox), as a driver does */
export function createFormulaAutopilot(track: FormulaTrack, stats: Pick<CarStats, 'vmax' | 'grip' | 'aero' | 'gearbox' | 'nitroShots'>) {
  const path = track.road.path, n = path.length, bank = track.road.bank, spacing = Math.hypot((path[1] as Point).x - (path[0] as Point).x, (path[1] as Point).y - (path[0] as Point).y) || 3;
  let waypoint = -1, stuckFor = 0, backOutFor = 0, backOutSteer = 1, lastTime = 0;
  /** the autopilot's whole decision for one tick */
  function decide(view: AutopilotView): FormulaInput {
    const out: FormulaInput = { ...IDLE_FORMULA_INPUT }, car = view.car, dt = Math.max(0, Math.min(0.1, view.raceTime - lastTime)); lastTime = view.raceTime;
    // before the green, and for its reaction time after it, the pedals stay up; after the finish it brakes
    if (view.phase === 'lights' || view.raceTime < AUTOPILOT.reaction) return out;
    if (view.phase !== 'racing') { out.brake = 0.6; return out; }
    const x = car.x, y = car.y, vf = car.forward;
    // the waypoint: the next path point ahead of the car (found from the whole path the first time, then moved on as the car passes it)
    if (waypoint < 0 || waypoint >= n) { let best = 0, bd = Infinity; path.forEach((p, i) => { const d = Math.hypot(x - p.x, y - p.y); if (d < bd) { bd = d; best = i; } }); waypoint = (best + 1) % n; }
    const near = nearestOnRoad(track.road, x, y).i; if ((near - waypoint + n) % n < n / 2) waypoint = (near + 1) % n;
    for (let k = 0; k < 4 && Math.hypot(x - (path[waypoint] as Point).x, y - (path[waypoint] as Point).y) < 6; k++) waypoint = (waypoint + 1) % n;
    const K = Math.max(2, Math.round(AUTOPILOT.bendLook / spacing)), at = (k: number): Point => path[(((waypoint + k) % n) + n) % n] as Point;
    const seg = Math.atan2(at(1).y - at(0).y, at(1).x - at(0).x), far = Math.atan2(at(K).y - at(K - 2).y, at(K).x - at(K - 2).x), aim = at(AUTOPILOT.aim), turnAhead = Math.abs(wrapAngle(far - seg));
    // (the lane: positive is the driver's right, the way the normal of a heading points)
    const goalX = aim.x - Math.sin(seg) * AUTOPILOT.lane, goalY = aim.y + Math.cos(seg) * AUTOPILOT.lane;
    let target = stats.vmax * AUTOPILOT.topSpeedAim * (1 - clamp(turnAhead / 1.1, 0, 1) * AUTOPILOT.cornerSlow);
    // look down the road and be slow enough for each bend by the time it comes (braking a little short of the car's best)
    for (let k = 1; k <= AUTOPILOT.brakeLook; k++) {
      const p0 = at(k - 2), p1 = at(k), p2 = at(k + 2), a = Math.hypot(p1.x - p0.x, p1.y - p0.y), b = Math.hypot(p2.x - p1.x, p2.y - p1.y), c = Math.hypot(p2.x - p0.x, p2.y - p0.y), area = Math.abs((p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y)) / 2;
      const radius = area > 1e-6 ? (a * b * c) / (4 * area) : 1e6, can = cornerSpeed(stats, radius, bank?.[(waypoint + k + n * 4) % n] ?? 0) * AUTOPILOT.cornerMargin;
      target = Math.min(target, Math.sqrt(can * can + 2 * GRIP.brake * AUTOPILOT.brakeMargin * k * spacing));
    }
    const err = wrapAngle(Math.atan2(goalY - y, goalX - x) - car.a);
    let steer = clamp(err * AUTOPILOT.steerGain, -1, 1);
    target *= 1 - AUTOPILOT.errSlow * clamp(Math.abs(err) / 1.4, 0, 1);
    // the wall: look ahead and a little to each side, and steer away and slow down when it is close
    const ahead = roadRay(track.road, x, y, car.a, AUTOPILOT.wallLook), left = roadRay(track.road, x, y, car.a - 0.6, 7), right = roadRay(track.road, x, y, car.a + 0.6, 7);
    if (ahead < 8) { const k = ahead / 8, away = left > right ? -1 : 1; steer = clamp(steer * k + away * (1 - k) * 1.6, -1, 1); target = Math.min(target, stats.vmax * (AUTOPILOT.wallSlow + (1 - AUTOPILOT.wallSlow) * k)); }
    let pedal = clamp((target - vf) * AUTOPILOT.gas, -1, 1);
    // stuck against something: back out, steering one way and then the other
    if (car.speed < 1.5 && Math.abs(pedal) > 0.3) stuckFor += dt; else stuckFor = 0;
    if (stuckFor > AUTOPILOT.stuckAfter) { backOutFor = AUTOPILOT.backOut; backOutSteer = -backOutSteer; stuckFor = 0; waypoint = -1; }
    if (backOutFor > 0) { backOutFor -= dt; pedal = -1; steer = backOutSteer; }
    out.steer = steer; out.throttle = pedal > 0 ? pedal : 0; out.brake = pedal < 0 ? -pedal : 0;
    // the gearbox: up before the limiter, down when the revs have fallen (an automatic gearbox does this itself)
    if (stats.gearbox === 'manual') { if (car.rev >= AUTOPILOT.shiftUpAt && car.gear < GEARS && out.throttle > 0) out.shiftUp = true; else if (car.rev < AUTOPILOT.shiftDownAt && car.gear > 1) out.shiftDown = true; }
    // the nitro: on a straight, with the line ahead, while the car still has speed to gain
    if (stats.nitroShots > 0 && car.nitroLeft > 0 && car.nitroT <= 0 && Math.abs(err) < AUTOPILOT.nitroErr && turnAhead < AUTOPILOT.nitroTurn && out.throttle > 0.9 && car.speed < stats.vmax * AUTOPILOT.nitroBelow) out.nitro = true;
    return out;
  }
  return { decide };
}

/** a whole lap driven by the autopilot with the given car and tune (what the page would do in a loop): the finished race, for the timeslip, the racing line and the leaderboard's autopilot category */
export function driveAutopilotLap(options: FormulaRaceOptions): FormulaRace {
  const race = createFormulaRace(options), driver = createFormulaAutopilot(race.track, race.state.car.stats);
  for (let i = 0; i < Math.ceil((LIGHTS.go + LAP.maxSeconds) / FORMULA_DT) + 600 && !race.over; i++) race.step(driver.decide(race.view()));
  return race;
}
