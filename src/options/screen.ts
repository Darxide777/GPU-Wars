// The OPTIONS screen's rows and the rebinding flow, with no page in it (the page draws the rows, like every other menu, and forwards keys and pad buttons here).
// Rows: DRIVER, MUSIC, the touch controls, input delay, fullscreen, then every control with its keyboard keys or gamepad buttons, RESET CONTROLS and BACK.
import type { MenuItem } from '../arena/view/menu.ts';
import { BIND_ROWS, LATENCY_MAX_MS, assignKeySlot, assignPadButton, clearSecondKey, keyLabel, padLabel, resetControls, type DriverKind, type Options, type TouchShow } from './model.ts';
import type { PadState } from '../arena/view/pad.ts';

export interface OptionsHost {
  /** the live options object: the screen changes it in place, so everything holding it sees the change */ options: Options;
  /** keep the options (call after every change) */ save(): void;
  /** something a system outside the menu must apply (the music volume) */ apply(what: 'music' | 'touch' | 'driver' | 'latency'): void;
  /** a line shown for a moment (conflicts, resets) */ say(text: string): void;
  /** redraw the screen */ refresh(): void; fullscreen(): void; back(): void;
}
export type Device = 'keyboard' | 'gamepad';
const step = (v: number, d: number, lo: number, hi: number, by: number): number => Math.max(lo, Math.min(hi, Math.round((v + d * by) * 1000) / 1000));
const TOUCH_SHOWS: TouchShow[] = ['auto', 'on', 'off'];

/** a key as it is stored: letters in lower case, named keys (ArrowUp, Shift) as the browser names them */
export const normalizeKey = (key: string): string => (key.length === 1 ? key.toLowerCase() : key);

/** the rebinding flow: pick an action and slot, then the next key (or pad button) is the new binding. Escape cancels. */
export function createRebinder(host: OptionsHost) {
  let pending: { action: string; slot: 0 | 1; device: Device } | null = null, padHeld = new Set<number>(), armed = false;
  const nameOf = (id: string): string => BIND_ROWS.find(r => r[0] === id)?.[1] ?? id.toUpperCase();
  const told = (took: string[]): string => (took.length ? `TAKEN FROM ${took.map(nameOf).join(', ')}` : '');
  return {
    get pending() { return pending; },
    begin(action: string, slot: 0 | 1, device: Device): void { pending = { action, slot, device }; padHeld = new Set(); armed = false; host.say(device === 'keyboard' ? 'PRESS THE NEW KEY (ESC CANCELS)' : 'PRESS THE NEW BUTTON (START OR ESC CANCELS)'); },
    /** offer a key press while rebinding; returns true when it was used */
    key(rawKey: string): boolean {
      if (!pending) return false;
      const p = pending; if (rawKey === 'Escape') { pending = null; host.say('CANCELLED'); host.refresh(); return true; }
      if (p.device !== 'keyboard') return true;
      const r = assignKeySlot(host.options.binds, p.action, normalizeKey(rawKey), p.slot);
      if (!r.ok) { host.say(r.why ?? 'CANNOT USE THAT KEY'); host.refresh(); return true; }
      host.options.binds = r.binds; pending = null; host.save(); host.say(`${nameOf(p.action)} = ${keyLabel(normalizeKey(rawKey))}  ${told(r.tookFrom)}`.trim()); host.refresh(); return true;
    },
    /** call every frame while the options screen is up, with the pad: a new press while rebinding a gamepad control becomes the binding */
    pad(state: PadState | null): void {
      if (!pending || pending.device !== 'gamepad' || !state) { return; }
      const p = pending, down = new Set<number>(); state.buttons.forEach((b, i) => { if (b.pressed) down.add(i); });
      if (!armed) { armed = true; padHeld = down; return; }      // buttons already down (the one that started this) do not count
      for (const i of down) {
        if (padHeld.has(i)) continue;
        if (i === 9) { pending = null; host.say('CANCELLED'); host.refresh(); return; }
        const r = assignPadButton(host.options.padBinds, p.action, i, p.slot);
        if (!r.ok) { host.say(r.why ?? 'CANNOT USE THAT BUTTON'); host.refresh(); }
        else { host.options.padBinds = r.pad; pending = null; host.save(); host.say(`${nameOf(p.action)} = ${padLabel(i)}  ${told(r.tookFrom)}`.trim()); host.refresh(); return; }
      }
      padHeld = down;
    },
    cancel(): void { pending = null; },
  };
}
export type Rebinder = ReturnType<typeof createRebinder>;

export function optionsItems(host: OptionsHost, rebinder: Rebinder, device: { get(): Device; set(d: Device): void }): MenuItem[] {
  const o = host.options, change = (what: Parameters<OptionsHost['apply']>[0]): void => { host.save(); host.apply(what); };
  const bindRow = ([id, label]: [string, string]): MenuItem => {
    const pend = (): boolean => rebinder.pending?.action === id;
    const keys = (): string[] => device.get() === 'keyboard' ? (o.binds[id] ?? []).map(keyLabel) : (o.padBinds[id] ?? []).map(padLabel);
    return {
      id: 'bind:' + id, label,
      value: () => (pend() ? 'PRESS...' : keys().join('  /  ')),
      hint: () => 'ENTER: REBIND THE FIRST ' + (device.get() === 'keyboard' ? 'KEY' : 'BUTTON') + '.  RIGHT: REBIND THE SECOND.  LEFT: CLEAR THE SECOND. A ' + (device.get() === 'keyboard' ? 'KEY' : 'BUTTON') + ' DOES ONE THING: GIVING IT HERE TAKES IT FROM THE OTHER CONTROL.',
      enter: () => rebinder.begin(id, 0, device.get()),
      right: () => rebinder.begin(id, 1, device.get()),
      left: () => { if (device.get() === 'keyboard') o.binds = clearSecondKey(o.binds, id); else o.padBinds = { ...o.padBinds, [id]: [(o.padBinds[id] ?? [-1])[0] ?? -1, -1] }; host.save(); host.refresh(); },
    };
  };
  return [
    { id: 'driver', label: 'DRIVER', value: () => (o.driver === 'autopilot' ? 'AUTOPILOT' : 'MANUAL'), hint: () => 'MANUAL: you drive. AUTOPILOT: the car drives itself through the same controls (it stages, launches, shifts, steers and drops the chute). Autopilot runs count in their own leaderboard category.', left: () => { o.driver = o.driver === 'manual' ? 'autopilot' : 'manual' as DriverKind; change('driver'); host.refresh(); }, right: () => { o.driver = o.driver === 'manual' ? 'autopilot' : 'manual'; change('driver'); host.refresh(); } },
    { id: 'music', label: 'MUSIC VOLUME', value: () => `${Math.round(o.music * 100)}%`, hint: () => 'The volume of Simulation Theory, the song that plays during the benchmark.', left: () => { o.music = step(o.music, -1, 0, 1, 0.05); change('music'); }, right: () => { o.music = step(o.music, 1, 0, 1, 0.05); change('music'); } },
    { id: 'touchShow', label: 'TOUCH CONTROLS', value: () => o.touch.show.toUpperCase(), hint: () => 'On-screen buttons for phones and tablets. AUTO shows them once you touch the screen.', left: () => { o.touch.show = TOUCH_SHOWS[(TOUCH_SHOWS.indexOf(o.touch.show) + 2) % 3] as TouchShow; change('touch'); }, right: () => { o.touch.show = TOUCH_SHOWS[(TOUCH_SHOWS.indexOf(o.touch.show) + 1) % 3] as TouchShow; change('touch'); } },
    { id: 'touchSize', label: 'TOUCH SIZE', value: () => `${Math.round(o.touch.size * 100)}%`, hint: () => 'How big the on-screen buttons are.', left: () => { o.touch.size = step(o.touch.size, -1, 0.7, 1.5, 0.1); change('touch'); }, right: () => { o.touch.size = step(o.touch.size, 1, 0.7, 1.5, 0.1); change('touch'); } },
    { id: 'touchAnalog', label: 'ANALOG TOUCH GAS', value: () => (o.touch.analog ? 'ON' : 'OFF'), hint: () => 'ON: the gas follows where your thumb is on the pedal (low is gentle, high is full), or the screen\'s pressure where it has one. OFF: any touch is full gas.', left: () => { o.touch.analog = !o.touch.analog; change('touch'); }, right: () => { o.touch.analog = !o.touch.analog; change('touch'); } },
    { id: 'haptics', label: 'VIBRATION', value: () => (o.touch.haptics ? 'ON' : 'OFF'), hint: () => 'Buzz on launch, shifts, wheelspin, the chute and a crash (phones that support it).', left: () => { o.touch.haptics = !o.touch.haptics; change('touch'); }, right: () => { o.touch.haptics = !o.touch.haptics; change('touch'); } },
    { id: 'latency', label: 'INPUT DELAY', value: () => `${o.latencyOffsetMs} MS`, hint: () => 'Calibration. A press waits this long before the car sees it, which evens out screens and Bluetooth pads that show the tree late. Leave it at 0 unless your starts feel early.', left: () => { o.latencyOffsetMs = step(o.latencyOffsetMs, -1, 0, LATENCY_MAX_MS, 5); change('latency'); }, right: () => { o.latencyOffsetMs = step(o.latencyOffsetMs, 1, 0, LATENCY_MAX_MS, 5); change('latency'); } },
    { id: 'fullscreen', label: 'FULLSCREEN', value: () => 'TOGGLE', hint: () => 'Fullscreen on or off.', enter: () => host.fullscreen() },
    { id: 'device', label: 'CONTROLS FOR', value: () => device.get().toUpperCase(), hint: () => 'Switch between the keyboard keys and the gamepad buttons you are rebinding.', left: () => { device.set(device.get() === 'keyboard' ? 'gamepad' : 'keyboard'); host.refresh(); }, right: () => { device.set(device.get() === 'keyboard' ? 'gamepad' : 'keyboard'); host.refresh(); }, enter: () => { device.set(device.get() === 'keyboard' ? 'gamepad' : 'keyboard'); host.refresh(); } },
    ...BIND_ROWS.map(bindRow),
    { id: 'reset', label: 'RESET CONTROLS', hint: () => 'Puts every key and gamepad button back to its default.', enter: () => { const r = resetControls(o); o.binds = r.binds; o.padBinds = r.padBinds; host.save(); host.say('CONTROLS RESET'); host.refresh(); } },
    { id: 'back', label: 'BACK', enter: () => host.back() },
  ];
}
