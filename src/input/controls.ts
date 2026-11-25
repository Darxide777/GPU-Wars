// What is held right now, built from drained events, and how it becomes the DragInput the simulation reads. This is the ONE place input becomes a DragInput
// (the autopilot produces a DragInput too, from src/drag/autopilot.ts, through the same shape).
import type { DragInput } from '../drag/types.ts';
import type { InputEvent } from './queue.ts';

/** a DragInput plus the two inputs the physics is growing (reverse out of the beam, and shift down); extra fields are ignored by an engine that does not know them yet */
export type DriverInput = DragInput & { backUp: boolean; shiftDown: boolean };
export const IDLE_INPUT: DriverInput = { throttle: 0, launch: false, shiftUp: false, nitro: false, burnout: false, brake: false, chute: false, deepStage: false, steer: 0, backUp: false, shiftDown: false };

export function createControlState() {
  const holders = new Map<string, Set<string>>(), taps = new Set<string>(), analog = new Map<string, number>();
  const holdersOf = (c: string): Set<string> => { let s = holders.get(c); if (!s) { s = new Set(); holders.set(c, s); } return s; };
  return {
    /** applies one event at its tick; a press that finds nothing else holding the control also counts as a tap for this tick */
    apply(e: InputEvent): void {
      if (e.kind === 'analog') { if (!Number.isFinite(e.value)) analog.delete(e.control); else analog.set(e.control, e.value); return; }
      const h = holdersOf(e.control);
      if (e.kind === 'down') { if (h.size === 0) taps.add(e.control); h.add(e.source); } else h.delete(e.source);
    },
    /** held, or pressed during this tick */
    active(control: string): boolean { return (holders.get(control)?.size ?? 0) > 0 || taps.has(control); },
    /** true only on the tick the press landed (edge) */
    tapped(control: string): boolean { return taps.has(control); },
    analogOf(channel: string): number | undefined { return analog.get(channel); },
    /** call after each tick: taps last one tick */
    endTick(): void { taps.clear(); },
    /** forget everything (race start, window blur) */
    reset(): void { holders.clear(); taps.clear(); analog.clear(); },
  };
}
export type ControlState = ReturnType<typeof createControlState>;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** turns the held controls into the simulation's input; same rules the page always had (launch also shifts up, gas + brake is a burnout) */
export function toDriverInput(c: ControlState): DriverInput {
  const go = c.active('launch');
  const gas = Math.max(c.active('gas') ? 1 : 0, c.analogOf('gasPad') ?? 0, c.analogOf('gasTouch') ?? 0), braking = c.active('brake');
  const steer = (c.active('steerRight') ? 1 : 0) - (c.active('steerLeft') ? 1 : 0) + (c.analogOf('steerTouch') ?? 0) + (c.analogOf('steerPad') ?? 0);
  return {
    throttle: clamp(gas, 0, 1), launch: go, shiftUp: go || c.active('shiftUp'), shiftDown: c.active('shiftDown'), nitro: c.active('nitro'), burnout: c.active('burnout') || (gas > 0 && braking),
    brake: braking, chute: c.active('chute'), deepStage: c.active('deepStage'), backUp: c.active('backUp'), steer: clamp(steer, -1, 1),
  };
}
