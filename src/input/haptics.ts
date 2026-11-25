// Vibration tied to simulation events (launch, shifts, wheelspin, chute, a hit): navigator.vibrate where the browser has it (Android; iOS has none), nothing otherwise.
import type { DragEvent } from '../drag/types.ts';

/** the vibration pattern (milliseconds, on/off/on...) for an event of the player's car, or null for none */
export function hapticPattern(e: DragEvent, car = 0): number[] | null {
  if (e.t === 'green') return [10];
  if (!('car' in e) || e.car !== car) return null;
  switch (e.t) {
    case 'launch': return [35]; case 'shift': return [14]; case 'nitro': return [26, 20, 26]; case 'spin': return [18]; case 'wheelie': return [22];
    case 'chute': return [20, 30, 45]; case 'foul': case 'abort': return [60, 40, 60]; case 'wall': return [50]; case 'crash': return [90, 40, 140]; case 'finish': return [30, 30, 30];
    default: return null;
  }
}
export function createHaptics(enabled: () => boolean, vibrate: ((p: number[]) => boolean) | null = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' ? p => (navigator.userActivation && !navigator.userActivation.hasBeenActive ? false : navigator.vibrate(p)) : null)      // (browsers refuse to vibrate before the first tap)
{
  return {
    /** call with the events of one simulation step */
    onEvents(events: readonly DragEvent[]): void { if (!vibrate || !enabled()) return; for (const e of events) { const p = hapticPattern(e); if (p) { try { vibrate(p); } catch (err) { /* no vibration */ } } } },
    stop(): void { try { vibrate?.([0]); } catch (err) { /* no vibration */ } },
  };
}
