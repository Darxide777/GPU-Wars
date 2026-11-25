// The timestamped event queue. The page's event handlers push events with the time the browser gave them; the fixed-step loop drains the queue once per simulation tick, so a press
// is applied at the tick that covers the moment it happened (not "whenever the frame ran"), in the order it happened, however many ticks one frame runs.
import { INPUT } from './constants.ts';

export type InputKind = 'down' | 'up' | 'analog';
export interface InputEvent {
  /** milliseconds on the page's clock (performance.now / event.timeStamp) */ t: number;
  kind: InputKind;
  /** the control id from DEFAULT_BINDS (gas, launch, ...), or an analog channel (gasPad, gasTouch, steerTouch, steerPad) */ control: string;
  /** who is holding it: 'k:w' (a key), 't:3' (a touch pointer), 'p:7' (a pad button). A control stays held while any holder remains. */ source: string;
  /** for analog events: the value (-1 to 1 for steering, 0 to 1 for gas); NaN means "no analog value now" */ value: number;
  /** arrival order, to keep events with the same time in the order they came */ seq: number;
}
export function createInputQueue() {
  let events: InputEvent[] = [], seq = 0;
  return {
    push(e: Omit<InputEvent, 'seq'>): void {
      if (!Number.isFinite(e.t)) return;
      if (events.length >= INPUT.maxQueued) events.shift();
      events.push({ ...e, seq: seq++ });
    },
    /**
     * Takes every event that is due at `tickMs` (its time plus `delayMs` is not after the tick), oldest first. A release that follows a press of the same thing in the same
     * batch stays queued for the next tick, so a very short tap is still seen as held for one tick.
     */
    drain(tickMs: number, delayMs = 0): InputEvent[] {
      events.sort((a, b) => a.t - b.t || a.seq - b.seq);
      const due: InputEvent[] = [], later: InputEvent[] = [], pressed = new Set<string>(), blocked = new Set<string>();
      for (const e of events) {
        const id = e.control + '|' + e.source;
        if (e.t + delayMs > tickMs || blocked.has(id)) { later.push(e); if (e.kind !== 'analog') blocked.add(id); continue; }
        if (e.kind === 'up' && pressed.has(id)) { later.push(e); blocked.add(id); continue; }
        if (e.kind === 'down') pressed.add(id);
        due.push(e);
      }
      events = later; return due;
    },
    clear(): void { events = []; },
    get size(): number { return events.length; },
  };
}
export type InputQueue = ReturnType<typeof createInputQueue>;
