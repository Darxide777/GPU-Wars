// Tune slots in Formula, Drag and Rocket: six named places for a tune each, kept in the save, loaded back as the tune in use; the menu rows that drive them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SLOT_COUNT, cleanSlots, clearSlot, cycle, emptySlots, putSlot, slotName, SLOT_CONDITIONS } from '../src/tune-slots.ts';
import { newSlotState, slotRows } from '../src/tune-slots-menu.ts';
import { emptySave, sanitizeSave } from '../src/save.ts';
import { clearSaveSlot, loadFromSlot, readyCar, saveToSlot, tuneSlots } from '../src/drag/model.ts';

test('slots: six, empty to start; put, clear and clean never change what they are given and keep names short and printable', () => {
  const e = emptySlots(); assert.equal(e.length, SLOT_COUNT); assert.ok(e.every(s => s === null));
  const a = putSlot(e, 2, 'city wet', { x: 1 }); assert.equal(a[2].name, 'CITY WET'); assert.deepEqual(a[2].tune, { x: 1 }); assert.ok(e.every(s => s === null), 'the old one is untouched');
  assert.equal(putSlot(a, 0, '  ', { y: 2 })[0].name, 'SLOT 1', 'no name: SLOT n'); assert.equal(putSlot(a, 9, 'x', {}), a, 'a slot that does not exist changes nothing');
  assert.equal(clearSlot(a, 2)[2], null); assert.equal(slotName('CITY', 'WET'), 'CITY WET'); assert.equal(slotName('', 'WET'), 'WET'); assert.equal(slotName('', ''), '');
  const messy = cleanSlots([{ name: 'a\u0007b'.repeat(40), tune: { z: 1 } }, 'junk', { name: 'x' }, null, { name: 'ok', tune: [1] }, { tune: { q: 1 } }, { name: 'extra', tune: {} }], t => t);
  assert.equal(messy.length, SLOT_COUNT); assert.ok(messy[0].name.length <= 30 && !/[\u0007]/.test(messy[0].name)); assert.equal(messy[1], null); assert.equal(messy[2], null); assert.equal(messy[4], null); assert.equal(messy[5].name, 'SLOT 6');
  assert.deepEqual(cleanSlots('nope', t => t), emptySlots()); assert.equal(cycle(['a', 'b', 'c'], 'c', 1), 'a'); assert.equal(cycle(['a', 'b', 'c'], 'a', -1), 'c'); assert.equal(cycle(['a', 'b'], 'zzz', 1), 'b');
});

test('the menu rows: SLOT picks (and shows a full slot\'s name), SLOT FOR and CONDITIONS build the name, SAVE keeps it, LOAD and CLEAR need a full slot', () => {
  let slots = emptySlots(), msgs = [], loaded = -1, st = newSlotState();
  const rows = () => slotRows({ slots: () => slots, places: () => ['', 'OVAL', 'CITY'], place: () => 'OVAL', save: (i, n) => { slots = putSlot(slots, i, n, { v: i }); }, load: i => { loaded = i; }, clear: i => { slots = clearSlot(slots, i); }, refresh: (id, m) => msgs.push([id, m]) }, st);
  const r = Object.fromEntries(rows().map(x => [x.id, x])); assert.equal(r.slot.value(), '1: EMPTY'); assert.equal(r.slotFor.value(), 'OVAL'); assert.ok(r.slotLoad.disabled() && r.slotClear.disabled());
  r.slotFor.right(); assert.equal(rows()[1].value(), 'CITY'); r.slotCond.right(); r.slotCond.right(); assert.equal(rows()[2].value(), SLOT_CONDITIONS[2]); r.slotSave.enter(); assert.equal(slots[0].name, `CITY ${SLOT_CONDITIONS[2]}`); assert.deepEqual(msgs.at(-1), ['slotSave', 'SAVED TO SLOT 1']);
  assert.equal(rows()[0].value(), `1: CITY ${SLOT_CONDITIONS[2]}`); assert.ok(!rows()[4].disabled()); rows()[4].enter(); assert.equal(loaded, 0); r.slot.right(); assert.equal(rows()[0].value(), '2: EMPTY'); r.slot.left(); assert.equal(rows()[1].value(), 'CITY', 'back on a full slot the name shows its halves'); rows()[5].enter(); assert.equal(slots[0], null);
});

test('GPU Wars: a tune is saved to a slot, loading it makes it the tune (made safe), slots survive a save and a damaged one is repaired', () => {
  let save = emptySave(); const t0 = readyCar(save).tune, t1 = { ...t0, pressure: t0.pressure + 3 };
  assert.equal(tuneSlots(save).length, SLOT_COUNT); assert.ok(tuneSlots(save).every(s => s === null));
  save = saveToSlot(save, 0, 'WET', t1); assert.equal(tuneSlots(save)[0].name, 'WET');
  const loaded = loadFromSlot(save, 0); assert.equal(readyCar(loaded).tune.pressure, t1.pressure); assert.equal(loadFromSlot(save, 3), save, 'an empty slot changes nothing'); assert.equal(tuneSlots(clearSaveSlot(save, 0))[0], null);
  const round = sanitizeSave(JSON.parse(JSON.stringify(save))); assert.equal(tuneSlots(round)[0].name, 'WET');
  const hurt = JSON.parse(JSON.stringify(save)); hurt.slots[0].tune = { pressure: 999, evil: 1 }; assert.equal(readyCar(loadFromSlot(sanitizeSave(hurt), 0)).tune.pressure, 40, 'made safe when loaded');
  hurt.slots = 'garbage'; assert.equal(tuneSlots(sanitizeSave(hurt)).filter(Boolean).length, 0);
});
