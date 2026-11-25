// The menu logic for the arena's set-up, pause and results screens, with no page in it: rows you move between with the arrow keys (or W and S), change with left and right
// (or A and D) and choose with Enter. Rows can be switched off and are skipped. The page draws the rows and sends the keys here.
export interface MenuItem {
  id: string; label: string;
  /** the value shown on the right (a mode name, a number) */
  value?: () => string;
  /** a line shown under the menu while this row is selected */
  hint?: () => string;
  disabled?: () => boolean;
  left?: () => void; right?: () => void; enter?: () => void;
}
export function createMenu(items: MenuItem[], start = 0) {
  const off = (i: number): boolean => { const it = items[i]; return !it || !!it.disabled?.(); };
  let sel = Math.max(0, Math.min(items.length - 1, start)); if (off(sel)) sel = Math.max(0, items.findIndex((_, i) => !off(i)));
  const move = (d: number): void => { for (let n = 0; n < items.length; n++) { sel = (sel + d + items.length) % items.length; if (!off(sel)) return; } };
  return {
    items,
    get sel(): number { return sel; },
    set sel(i: number) { if (i >= 0 && i < items.length && !off(i)) sel = i; },
    /** a key press (as `KeyboardEvent.key`, lower case for letters); returns whether the menu used it */
    key(k: string): boolean {
      const it = items[sel];
      if (k === 'arrowup' || k === 'w') { move(-1); return true; }
      if (k === 'arrowdown' || k === 's') { move(1); return true; }
      if (k === 'arrowleft' || k === 'a') { if (it?.left) { it.left(); return true; } return false; }
      if (k === 'arrowright' || k === 'd') { if (it?.right) { it.right(); return true; } return false; }
      if (k === 'enter' || k === ' ') { if (it?.enter) { it.enter(); return true; } if (it?.right) { it.right(); return true; } return false; }
      return false;
    },
  };
}
export type Menu = ReturnType<typeof createMenu>;
