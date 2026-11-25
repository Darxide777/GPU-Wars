// A letter picker for typing your name with no keyboard (touch, gamepad): a current letter you cycle with up/down (or the arrows on its menu row), then ADD, DELETE, DONE or CANCEL.
// Pure state, no screen: the page shows it as ordinary neon menu rows. The name rules are the server's (3 to 16 characters, see profile.ts).
import { cleanPlayerName } from './profile.ts';

export const PICKER_LETTERS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.';
export const PICKER_MAX = 16;

export function createLetterPicker(initial = '') {
  let name = initial.toUpperCase().replace(/[^A-Z0-9 _\-.]/g, '').slice(0, PICKER_MAX), at = PICKER_LETTERS.indexOf('A');
  return {
    get name(): string { return name; },
    /** the letter that ADD would append */ get letter(): string { return PICKER_LETTERS[at] as string; },
    /** step to the next (+1) or previous (-1) letter, wrapping around */
    cycle(d: number): void { at = (at + (d < 0 ? -1 : 1) + PICKER_LETTERS.length) % PICKER_LETTERS.length; },
    /** append the shown letter (false when the name is already full) */
    add(): boolean { if (name.length >= PICKER_MAX) return false; name += this.letter; return true; },
    remove(): void { name = name.slice(0, -1); },
    /** the name as the server would accept it, or null when it is too short or has nothing usable */
    result(): string | null { return cleanPlayerName(name); },
  };
}
export type LetterPicker = ReturnType<typeof createLetterPicker>;
