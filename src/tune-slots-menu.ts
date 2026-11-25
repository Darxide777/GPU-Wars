// The rows every tune screen shows for its slots (Formula's TUNE, Drag's TUNE, Rocket's FLIGHT PLAN): which slot (left and right), what to call it (a place and a condition, chosen from lists: there is no text box), SAVE to it, LOAD it
// and CLEAR it. The page gives it the game's own way of reading and writing the slots and the tune, so nothing here knows about a game.
import type { MenuItem } from './arena/view/menu.ts';
import { SLOT_CONDITIONS, SLOT_COUNT, cycle, slotName, type TuneSlots } from './tune-slots.ts';

export interface SlotHooks {
  /** the slots of the car or track now being tuned */ slots(): TuneSlots;
  /** the choices for the first half of a name (a track, a car, a flight target; '' first) */ places(): string[];
  /** the place to start from (the track or car now) */ place(): string;
  save(i: number, name: string): void; load(i: number): void; clear(i: number): void;
  /** redraw the screen with the row `id` selected, and say something under the title */ refresh(id: string, msg?: string): void;
}
/** what the rows remember between redraws (the page keeps one): the slot, and the two halves of the name being made (`place` null: the page's own to start) */
export interface SlotState { at: number; place: string | null; cond: string }
export const newSlotState = (): SlotState => ({ at: 0, place: null, cond: '' });
export function slotRows(h: SlotHooks, st: SlotState): MenuItem[] {
  const cur = (): string => st.place ?? h.place();
  const text = (i: number): string => { const s = h.slots()[i]; return `${i + 1}: ${s ? s.name : 'EMPTY'}`; };
  const pick = (d: number): void => { st.at = (st.at + d + SLOT_COUNT) % SLOT_COUNT; const s = h.slots()[st.at]; if (s) { st.place = h.places().filter(Boolean).find(p => s.name === p || s.name.startsWith(`${p} `)) ?? ''; st.cond = SLOT_CONDITIONS.find(c => c && s.name.endsWith(c)) ?? ''; } h.refresh('slot'); };      // (picking a slot with something in it shows its name's two halves, so saving over it keeps the name)
  return [
    { id: 'slot', label: 'TUNE SLOT', value: () => text(st.at), hint: () => 'Six places to keep a tune: one for each track, car or kind of weather. Left and right pick a slot.', left: () => pick(-1), right: () => pick(1) },
    { id: 'slotFor', label: 'SLOT FOR', value: () => cur() || 'ANY', hint: () => 'What the slot is for, as the name it is saved under.', left: () => { st.place = cycle(h.places(), cur(), -1); h.refresh('slotFor'); }, right: () => { st.place = cycle(h.places(), cur(), 1); h.refresh('slotFor'); } },
    { id: 'slotCond', label: 'CONDITIONS', value: () => st.cond || 'ANY', hint: () => 'DRY, WET, HOT, COLD, NIGHT and so on: the rest of the name.', left: () => { st.cond = cycle(SLOT_CONDITIONS, st.cond, -1); h.refresh('slotCond'); }, right: () => { st.cond = cycle(SLOT_CONDITIONS, st.cond, 1); h.refresh('slotCond'); } },
    { id: 'slotSave', label: 'SAVE TO SLOT', hint: () => 'Keep the tune you have now in this slot (it replaces what was there).', enter: () => { h.save(st.at, slotName(cur(), st.cond)); h.refresh('slotSave', `SAVED TO SLOT ${st.at + 1}`); } },
    { id: 'slotLoad', label: 'LOAD SLOT', disabled: () => !h.slots()[st.at], hint: () => 'Use the tune in this slot now.', enter: () => { h.load(st.at); h.refresh('slotLoad', `LOADED SLOT ${st.at + 1}`); } },
    { id: 'slotClear', label: 'CLEAR SLOT', disabled: () => !h.slots()[st.at], hint: () => 'Erase the tune kept in this slot.', enter: () => { h.clear(st.at); h.refresh('slotClear', `CLEARED SLOT ${st.at + 1}`); } },
  ];
}
