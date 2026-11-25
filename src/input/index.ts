// The input layer's front door. The page creates one `Input`, calls `startFrame` once per animation frame and `read` once per simulation tick; `read` returns the DriverInput.
//   browser events (keys, touch pointers, pad polls)  ->  timestamped queue  ->  drained at each fixed tick  ->  held/edge state  ->  DriverInput
import { DRAG } from '../drag/physics.ts';
import type { Options } from '../options/model.ts';
import { INPUT } from './constants.ts';
import { createControlState, toDriverInput, type DriverInput } from './controls.ts';
import { pushKey } from './keyboard.ts';
import { createPadReader } from './pad.ts';
import { createInputQueue } from './queue.ts';
import { createTouchControls, TOUCH_MENU } from './touch.ts';
import type { PadState } from '../arena/view/pad.ts';

export { INPUT } from './constants.ts';
export type { DriverInput } from './controls.ts';

export interface InputHooks {
  /** the current options (read every time, so a rebind takes effect at once) */ options: () => Options;
  /** whether the race is on screen: input is ignored (and let go) otherwise */ racing: () => boolean;
  /** the window size in css pixels */ size: () => { w: number; h: number };
  /** the MENU touch button */ onMenu: () => void;
}
export function createInput(hooks: InputHooks) {
  const queue = createInputQueue(), state = createControlState(), pad = createPadReader(queue);
  let tickMs = 0, touchSeen = false, lastRacing = false;
  const delayMs = (): number => Math.max(0, Math.min(250, INPUT.eventQueueMs + hooks.options().latencyOffsetMs));
  const touch = createTouchControls(queue, { size: () => hooks.options().touch.size, analog: () => hooks.options().touch.analog, width: () => hooks.size().w, height: () => hooks.size().h, onMenu: hooks.onMenu, active: () => hooks.racing() && touchVisible(), onTouchSeen: () => { touchSeen = true; } });
  /** are the touch controls on screen? */
  const touchVisible = (): boolean => { const t = hooks.options().touch.show; return t === 'on' || (t === 'auto' && (touchSeen || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches))); };
  const letGo = (t: number): void => { touch.releaseAll(t); queue.clear(); state.reset(); pad.reset(); };
  return {
    queue, state, touch, touchVisible,
    attach(win: Window, canvas: HTMLElement): void {
      win.addEventListener('keydown', e => { if (!hooks.racing() || e.repeat) return; pushKey(queue, hooks.options().binds, e.key, true, e.timeStamp); });
      win.addEventListener('keyup', e => { pushKey(queue, hooks.options().binds, e.key, false, e.timeStamp); });
      win.addEventListener('blur', () => letGo(performance.now()));
      touch.attach(canvas);
    },
    /** call at the start of every animation frame: `simStartMs` is the page-clock time the first tick of this frame covers from */
    startFrame(simStartMs: number, padState: PadState | null, nowMs: number): void {
      const racing = hooks.racing(); if (racing !== lastRacing) { letGo(nowMs); lastRacing = racing; }
      tickMs = simStartMs; if (racing) pad.poll(padState, hooks.options().padBinds, nowMs);
    },
    /** one simulation tick: moves the tick clock on, applies every event that is due, and returns the input for this tick */
    read(): DriverInput {
      tickMs += DRAG.dt * 1000;
      for (const e of queue.drain(tickMs, delayMs())) state.apply(e);
      const input = toDriverInput(state); state.endTick(); return input;
    },
    /** for tests and the race start: forget everything pending */
    reset(t = 0): void { letGo(t); },
    /** draws the on-screen controls when they should show (touch present or switched on, in a race, driving by hand) */
    draw(ctx: CanvasRenderingContext2D, driving: boolean): void { if (hooks.racing() && driving && touchVisible()) touch.draw(ctx); },
    TOUCH_MENU,
  };
}
export type Input = ReturnType<typeof createInput>;
