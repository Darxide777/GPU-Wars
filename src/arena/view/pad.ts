// Driving the arena with a gamepad (the standard layout): left stick or d-pad steers, the right trigger is the gas and the left trigger the brake (the stick up and down also work),
// A or RB fires, X or LB launches a missile, B is nitro, Y is your car's special, the right stick aims and Start pauses. The menus use the same pad through the game's menu pad (src/gamepad.ts).
export interface PadState { buttons: readonly { pressed: boolean; value: number }[]; axes: readonly number[] }
export interface PadInput { throttle: number; steer: number; fire: boolean; missile: boolean; nitro: boolean; special: boolean; pause: boolean; /** the right stick, sideways and up-down (-1 to 1): where to aim */ aimX: number; aimY: number }

const DEAD = 0.18;
/** a stick value with the small wobble near the middle ignored, and the rest stretched to the full range */
export const deadzone = (v: number): number => { const a = Math.abs(v); return a < DEAD ? 0 : Math.sign(v) * Math.min(1, (a - DEAD) / (1 - DEAD)); };
/** what the pad asks of the car, or null when there is no pad */
export function padToInput(p: PadState | null | undefined): PadInput | null {
  if (!p) return null;
  const b = (i: number): boolean => !!p.buttons[i]?.pressed, v = (i: number): number => p.buttons[i]?.value ?? (b(i) ? 1 : 0), ax = (i: number): number => p.axes[i] ?? 0;
  const stick = deadzone(ax(0)), dpad = (b(15) ? 1 : 0) - (b(14) ? 1 : 0), gas = v(7) - v(6), updown = -deadzone(ax(1)) + (b(12) ? 1 : 0) - (b(13) ? 1 : 0);
  const pick = (a: number, c: number): number => (Math.abs(a) >= Math.abs(c) ? a : c);
  return { steer: Math.max(-1, Math.min(1, pick(stick, dpad))), throttle: Math.max(-1, Math.min(1, pick(gas, updown))), fire: b(0) || b(5), missile: b(2) || b(4), nitro: b(1), special: b(3), pause: b(9), aimX: deadzone(ax(2)), aimY: deadzone(ax(3)) };
}
/** the first pad that is plugged in */
export function firstPad(): PadState | null { const pads = navigator.getGamepads ? [...navigator.getGamepads()] : []; return (pads.find(p => !!p) as PadState | undefined) ?? null; }
