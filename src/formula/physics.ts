// THE DRIVING PHYSICS of Formula: ONE pure function, `driveStep(car, input, track, dt)`, from a car, what the driver does and a fixed time step to the car's new state. It draws nothing, reads no clock, uses no random numbers and
// never changes what it is given. The same car and inputs always give the same lap.
// It is Chromium Halo: Neon's race simulation (driveCar in src/arena/sim.ts with its `sim` flag on, plus grip.ts) taken out of the Arena engine: the tyres hold only so much (a car cannot turn tighter than its grip allows at
// its speed, so it runs wide; braking shares the same grip), downforce adds grip that grows with the square of the speed, a banked turn holds more when you turn toward the inside, a hill takes speed off going up and gives it back
// going down, the manual gearbox has its own top speed and pull in every gear, and the wall scrubs off speed. No weapons, bots, pickups or wrecks.
import { AUTO_GEARBOX, BASE, FORMULA_DT, G, GEARBOX, GEARS, GEAR_TOPS, GRIP, NITRO } from './constants.ts';
import { alongOf, cumulativeLengths, nearestOnRoad, roadHit, roadSurface } from './road.ts';
import type { CarStats, FormulaCar, FormulaInput, FormulaTrack } from './types.ts';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** an angle brought into -pi to pi */
export const wrapAngle = (a: number): number => { const turn = Math.PI * 2; a %= turn; return a > Math.PI ? a - turn : a < -Math.PI ? a + turn : a; };
/** a number from the driver, never NaN or infinite (a missing field in a test input must not poison the physics) */
const finite = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** a banked turn: the road tips toward the inside, so the tyres hold more when the car turns that way (up to a share of the flat grip, the walls and the suspension have a say) and less when it turns away from it */
export function bankedLimit(limit: number, bank: number, inward: boolean): number {
  if (bank <= 0) return limit;
  const mu = limit / G, t = Math.tan(bank);
  return inward ? Math.min(limit * 2.5, (G * (mu + t)) / Math.max(0.15, 1 - mu * t)) : Math.max(0.1 * limit, (G * (mu - t)) / (1 + mu * t));
}
/** how hard (m/s2) a car's tyres can push sideways at a speed: its grip, plus downforce */
export const gripLimit = (stats: Pick<CarStats, 'grip' | 'aero'>, speed: number): number => GRIP.lateral * (stats.grip / BASE.grip) + GRIP.aero * stats.aero * speed * speed;
/** the fastest a car can take a bend of radius r (m) */
export function cornerSpeed(stats: Pick<CarStats, 'grip' | 'aero'>, radius: number, bank = 0): number {
  let v = Math.sqrt(bankedLimit(GRIP.lateral * (stats.grip / BASE.grip), bank, true) * radius);
  for (let k = 0; k < 4; k++) v = Math.sqrt(bankedLimit(gripLimit(stats, v), bank, true) * radius);
  return v;
}
/** a gear's top speed (m/s) and how much of the engine's pull it gives at this speed: weak when the revs are low in a tall gear, best in the upper part of its range, nothing at the limiter; the low gears pull a little harder than the high ones.
 *  `rev` is the speed as a share of the gear's top. */
export function gearPull(gear: number, speed: number, vmax: number): { top: number; pull: number; rev: number } {
  const g = Math.max(1, Math.min(GEARS, Math.floor(gear))), top = (GEAR_TOPS[g - 1] as number) * vmax, rev = speed / top;
  const low = clamp((rev - GEARBOX.rev0) / GEARBOX.revSpan, 0, 1), band = GEARBOX.floor + (1 - GEARBOX.floor) * low * low * (3 - 2 * low);
  const limiter = rev <= GEARBOX.limiterStart ? 1 : Math.max(0, (1 - rev) / GEARBOX.limiterSpan);
  return { top, pull: band * limiter * (1 + (GEARS - g) * GEARBOX.lowGearBonus), rev };
}
/** the speed along the car's nose (m/s; negative is rolling backwards) */
export const forwardSpeed = (car: Pick<FormulaCar, 'vx' | 'vy' | 'a'>): number => car.vx * Math.cos(car.a) + car.vy * Math.sin(car.a);
/** the revs in the gear it is in, as a share of the gear's top (0 at a standstill, 1 at the top of the gear, where the shift light is) */
export const revOf = (car: Pick<FormulaCar, 'vx' | 'vy' | 'a' | 'gear' | 'stats'>): number => gearPull(car.gear, Math.max(0, forwardSpeed(car)), car.stats.vmax).rev;
/** whether the shift light is lit: the revs have reached the tune's shift light */
export const shiftLightOn = (car: Pick<FormulaCar, 'vx' | 'vy' | 'a' | 'gear' | 'stats'>): boolean => car.gear < GEARS && revOf(car) >= car.stats.shiftLight;

/** a car standing at a place with nothing going on: the lap's starting car (the grid is where the track says) */
export function newCar(stats: CarStats, x: number, y: number, a: number): FormulaCar {
  return { stats, x, y, a, vx: 0, vy: 0, gear: 1, nitroT: 0, nitroLeft: stats.nitroShots, nitroCd: 0, wallHit: 0, wallHits: 0, throttle: 0, brake: 0, steer: 0 };
}

/** one step of driving. Returns the new car; `car` and `input` are left as they were. */
export function driveStep(car: FormulaCar, input: Partial<FormulaInput>, track: FormulaTrack, dt: number = FORMULA_DT): FormulaCar {
  const st = car.stats, road = track.road;
  const steer = clamp(finite(input.steer), -1, 1), gas = clamp(finite(input.throttle), 0, 1), braking = clamp(finite(input.brake), 0, 1);
  // gas and brake are one pedal axis to the physics (brake wins when both are down)
  const thr = braking > 0 ? -braking : gas;
  let { x, y, a, vx, vy, gear, nitroT, nitroLeft, nitroCd } = car;
  nitroT = Math.max(0, nitroT - dt); nitroCd = Math.max(0, nitroCd - dt);
  if (input.nitro && nitroT <= 0 && nitroCd <= 0 && nitroLeft > 0) { nitroT = NITRO.seconds; nitroCd = NITRO.cooldown; nitroLeft--; }
  const boost = nitroT > 0, vmax = st.vmax * (boost ? NITRO.top : 1), accel = st.accel * (boost ? NITRO.pull : 1);
  let fx = Math.cos(a), fy = Math.sin(a), vf = vx * fx + vy * fy;
  // the gearbox: a shift is taken once; each gear has its top speed, the engine pulls best high in its range, and cuts out at the limiter
  if (st.gearbox === 'auto') {
    const rev = gearPull(gear, Math.max(0, vf), st.vmax).rev;
    if (rev >= st.shiftLight && gear < GEARS) gear++; else if (rev < AUTO_GEARBOX.downRev && gear > 1) gear--;
  } else if (input.shiftUp || input.shiftDown) gear = clamp(gear + (input.shiftUp ? 1 : 0) - (input.shiftDown ? 1 : 0), 1, GEARS);
  const gp = gearPull(gear, Math.max(0, vf), st.vmax), accelGear = accel * gp.pull, gearTop = gp.top;
  const speedShare = clamp(Math.abs(vf) / st.vmax, 0, 1.5), speed = Math.hypot(vx, vy), surface = roadSurface(road, x, y);
  // the wheel: turns the car less as it gets fast, and not at all when it is not moving
  let yaw = steer * st.turn * (1 - BASE.turnFade * Math.min(1, speedShare)) * clamp(Math.abs(vf) / 4, 0, 1) * Math.sign(vf || 1);
  let brakeForce: number = BASE.brake;
  if (speed > 2) {
    // the tyres hold only so much: no tighter a turn than the grip allows at this speed (it runs wide), and braking shares the same grip
    let limit = gripLimit(st, speed);
    if (surface) limit = bankedLimit(limit, surface.bank, yaw * (surface.ix * -fy + surface.iy * fx) >= 0);
    const used = Math.min(limit, Math.abs(yaw) * speed); yaw = clamp(yaw, -limit / speed, limit / speed);
    brakeForce = Math.min(GRIP.brake, Math.sqrt(Math.max(0, limit * limit - used * used)) + 4);
  }
  a = wrapAngle(a + yaw * dt);
  fx = Math.cos(a); fy = Math.sin(a); const lx = -fy, ly = fx;
  vf = vx * fx + vy * fy; let vl = vx * lx + vy * ly;
  if (thr > 0) vf += thr * (vf < 0 ? brakeForce : accelGear) * dt; else if (thr < 0) vf += thr * (vf > 0 ? brakeForce : accel * 0.7) * dt;
  else vf -= Math.sign(vf) * Math.min(Math.abs(vf), BASE.coast * dt);
  // a hill: uphill takes speed off, downhill gives it back
  if (surface && surface.grade) vf -= G * surface.grade * (fx * surface.tx + fy * surface.ty) * dt;
  vf *= 1 - BASE.drag * dt;
  // past the top of the gear the engine holds it back (a downshift too far slows the car); never faster than the top speed, and after a nitro burst it settles back down over a second or so
  if (vf > gearTop) vf = Math.max(gearTop, vf - GEARBOX.overTopSlow * dt);
  if (vf > vmax) vf = Math.max(vmax, vf - (accel + 8) * dt);
  vf = Math.max(vf, -st.vmax * BASE.reverse);
  vl *= Math.exp(-st.grip * (1 - BASE.driftSlip * Math.abs(steer) * Math.min(1, speedShare)) * dt);
  vx = fx * vf + lx * vl; vy = fy * vf + ly * vl; x += vx * dt; y += vy * dt;
  // the edge of the road is a wall: pushed back in, and running into it scrubs off speed
  let wallHit = 0, wallHits = car.wallHits;
  const hit = roadHit(road, x, y, st.radius);
  if (hit) {
    x += hit.nx * hit.depth; y += hit.ny * hit.depth;
    const vn = vx * hit.nx + vy * hit.ny;
    if (vn < -GRIP.wallScrub) { vx *= GRIP.wallKeep; vy *= GRIP.wallKeep; wallHits++; }
    if (vn < 0) { vx -= (1 + BASE.wallRestitution) * vn * hit.nx; vy -= (1 + BASE.wallRestitution) * vn * hit.ny; wallHit = -vn; }
  }
  return { stats: st, x, y, a, vx, vy, gear, nitroT, nitroLeft, nitroCd, wallHit, wallHits, throttle: gas, brake: braking, steer };
}
/** how far along the lap (m from the start line) and how far from the middle of the road (m, positive to the driver's right) a place is, for the ghost and the lap trace. The path point 0 is the start line, so a place just behind it is a
 *  small negative distance; give `near` (where the car was a moment ago) and the answer is the one closest to it, so the distance keeps counting up across the line instead of jumping by a lap. */
export function placeOnTrack(track: FormulaTrack, x: number, y: number, near?: number): { along: number; across: number } {
  const h = nearestOnRoad(track.road, x, y), n = track.road.path.length, a = track.road.path[h.i] as { x: number; y: number }, b = track.road.path[(h.i + 1) % n] as { x: number; y: number }, total = cumulativeLengths(track.road)[n] as number;
  const heading = Math.atan2(b.y - a.y, b.x - a.x), across = (x - h.px) * -Math.sin(heading) + (y - h.py) * Math.cos(heading), raw = alongOf(track.road, h.i, h.t);
  const along = near === undefined ? (raw > total / 2 ? raw - total : raw) : raw + total * Math.round((near - raw) / total);
  return { along, across };
}
