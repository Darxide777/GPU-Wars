// A gamepad in the menus: the d-pad or stick moves, A confirms, B goes back, X changes car after a run, Y opens the upgrades. (Driving with a pad comes later.)
// It presses the matching keys, so the menus need no pad code of their own.

const KEY_FOR = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', ok: 'Enter', back: 'Escape', change: 'c', shop: 'u' } as const;
type Button = keyof typeof KEY_FOR;

/** returns a function to call once a frame; `inMenu()` says whether the game is showing a menu */
export function createPadMenu(inMenu: () => boolean): () => void {
  let prev: Partial<Record<Button, boolean>> = {};
  return () => {
    if (!inMenu()) { prev = {}; return; }
    const p = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find(Boolean); if (!p) { prev = {}; return; }
    const b = (i: number): boolean => !!(p.buttons[i] && p.buttons[i].pressed), ax = (i: number, d: number): boolean => (p.axes[i] || 0) * d > 0.6;
    const now: Record<Button, boolean> = { up: b(12) || ax(1, -1), down: b(13) || ax(1, 1), left: b(14) || ax(0, -1), right: b(15) || ax(0, 1), ok: b(0) || b(9), back: b(1), change: b(2), shop: b(3) };
    for (const k of Object.keys(now) as Button[]) if (now[k] && !prev[k]) { dispatchEvent(new KeyboardEvent('keydown', { key: KEY_FOR[k] })); dispatchEvent(new KeyboardEvent('keyup', { key: KEY_FOR[k] })); }
    prev = now;
  };
}
