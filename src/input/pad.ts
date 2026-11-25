// The gamepad in the race: polled once per frame, turned into the same queue events as keys (edges at the poll time), with the triggers as an analog gas.
import { INPUT } from './constants.ts';
import type { PadBinds } from '../options/model.ts';
import type { InputQueue } from './queue.ts';
import type { PadState } from '../arena/view/pad.ts';

const dead = (v: number): number => { const a = Math.abs(v); return a < INPUT.padStickDead ? 0 : Math.sign(v) * Math.min(1, (a - INPUT.padStickDead) / (1 - INPUT.padStickDead)); };
export function createPadReader(queue: InputQueue) {
  let down = new Set<string>(), lastGas = -1, lastSteer = 0;
  return {
    /** call once a frame with the pad (or null) and the time */
    poll(pad: PadState | null, binds: PadBinds, t: number): void {
      const now = new Set<string>(); let gas = 0;
      if (pad) {
        for (const control of Object.keys(binds)) for (const b of binds[control] ?? []) {
          if (b < 0) continue;
          const btn = pad.buttons[b]; if (!btn) continue;
          const on = btn.pressed || btn.value > INPUT.padPressed;
          if (on && (control !== 'gas' || btn.value >= 1 || btn.value === 0)) now.add(control + '|p:' + b);      // (a half-pulled trigger is half gas, not a held button)
          if (control === 'gas') gas = Math.max(gas, btn.value > 0 ? btn.value : btn.pressed ? 1 : 0);
        }
        // the stick up and down also drive and brake; the d-pad and left stick steer
        const up = -dead(pad.axes[1] ?? 0); if (up > 0.5) now.add('gas|p:stickUp'); if (up < -0.5) now.add('brake|p:stickDown');
        gas = Math.max(gas, Math.max(0, up));
      }
      for (const id of now) if (!down.has(id)) { const [control, source] = id.split('|') as [string, string]; queue.push({ t, kind: 'down', control, source, value: 1 }); }
      for (const id of down) if (!now.has(id)) { const [control, source] = id.split('|') as [string, string]; queue.push({ t, kind: 'up', control, source, value: 1 }); }
      down = now;
      const g = pad ? Math.round(gas * 100) / 100 : -1; if (g !== lastGas) { queue.push({ t, kind: 'analog', control: 'gasPad', source: 'p', value: g > 0 ? g : NaN }); lastGas = g; }
      const steer = pad ? Math.max(-1, Math.min(1, dead(pad.axes[0] ?? 0) + ((pad.buttons[15]?.pressed ? 1 : 0) - (pad.buttons[14]?.pressed ? 1 : 0)))) : 0;
      if (steer !== lastSteer) { queue.push({ t, kind: 'analog', control: 'steerPad', source: 'p', value: steer === 0 ? NaN : steer }); lastSteer = steer; }
    },
    reset(): void { down = new Set(); lastGas = -1; lastSteer = 0; },
  };
}
