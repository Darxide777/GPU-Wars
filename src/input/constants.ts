// The numbers of the input layer. Turn these first when input feels late, twitchy or wrong on a phone.
export const INPUT = {
  /** milliseconds an event waits in the queue before the simulation may see it (smooths jitter between event timestamps and frames); 0 delivers at the first tick that covers the event */
  eventQueueMs: 0,
  /** the touch gas pedal: 1 is straight, above 1 gives finer control near the bottom of the pedal (value = position ^ curve) */
  touchAnalogCurve: 1.6,
  /** the least gas a touch on the pedal gives, so a touch always does something */
  touchMinGas: 0.2,
  /** most events kept waiting (a stuck loop must not grow memory without limit) */
  maxQueued: 512,
  /** gamepad stick ignores this much around the middle, and a trigger counts as pressed above this */
  padStickDead: 0.18, padPressed: 0.5,
} as const;
