// Keyboard events into queue events, using the rebindable binds (never a literal key in gameplay code; Enter also launches, as the menus' confirm key).
import type { Binds } from '../options/model.ts';
import type { InputQueue } from './queue.ts';

/** the actions a key is bound to (a key can be bound to more than one only in a damaged save; all are returned) */
export function actionsForKey(binds: Binds, key: string): string[] {
  const k = key.toLowerCase(), out = Object.keys(binds).filter(id => (binds[id] ?? []).some(b => !!b && b.toLowerCase() === k));
  if (k === 'enter' && !out.includes('launch')) out.push('launch');
  return out;
}
/** queue the press or release of a key at the event's own time */
export function pushKey(queue: InputQueue, binds: Binds, key: string, down: boolean, t: number): void {
  for (const control of actionsForKey(binds, key)) queue.push({ t, kind: down ? 'down' : 'up', control, source: 'k:' + key.toLowerCase(), value: 1 });
}
