// The BENCHMARK and CLASS rows of the title menu (the rules are in rules.ts; the page hands in what it holds through `BenchmarkContext`, which keeps the page's own edits small).
import type { MenuItem } from '../arena/view/menu.ts';
import type { Save } from '../save.ts';
import { classLabel, classNote, isClassId, type ClassId } from '../classes.ts';
import { classState, lockClass, rerunReason, stepClass, type ClassState } from './rules.ts';
import type { GpuIdentity } from './gpu.ts';

export interface BenchmarkContext {
  save: () => Save; commit: (next: Save) => void; gpu: () => GpuIdentity;
  /** the class being picked by hand now (not yet locked), kept by the page between visits to the menu */
  pick: { value: ClassId | null };
  /** put a line under the title */ say: (text: string) => void;
  /** start the benchmark for this class */ start: (cls: ClassId) => void;
  /** redraw the menu */ refresh: () => void; now: () => number;
}
export const classStateOf = (c: BenchmarkContext): ClassState => classState(c.gpu(), c.save().classLock, c.save().benchmark);

/** the line under the title menu's name: the class and the score, or what is missing */
export function benchmarkLine(c: BenchmarkContext): string {
  const s = c.save(), why = rerunReason(s.benchmark, c.gpu().gpuId);
  if (!s.benchmark) return 'NO BENCHMARK YET: RUN IT FROM THE BENCHMARK ROW. UNTIL THEN THE CAR HAS STOCK NUMBERS';
  const cls = isClassId(s.benchmark.class) ? classLabel(s.benchmark.class) : s.benchmark.class;
  return why ? `${cls}  SCORE ${s.benchmark.score}  RE-RUN NEEDED: ${why.toUpperCase()}` : `${cls}  SCORE ${s.benchmark.score}`;
}

export function benchmarkItem(c: BenchmarkContext): MenuItem {
  return {
    id: 'benchmark', label: 'BENCHMARK',
    value: () => { const s = c.save(), why = rerunReason(s.benchmark, c.gpu().gpuId); return !s.benchmark ? 'NOT RUN' : why ? 'RE-RUN' : `SCORE ${s.benchmark.score}`; },
    hint: () => 'Scores your graphics card with a few seconds of neon, lights and music, and sets your car\'s horsepower and torque from the score. It runs only from here, never by itself, and needs to be run again only if your graphics card or the benchmark itself changes. Keep this page in front while it runs.',
    enter: () => {
      const st = classStateOf(c);
      if (!st.locked) { c.say('PICK YOUR CLASS FIRST (THE CLASS ROW) AND PRESS ENTER TO LOCK IT'); c.refresh(); return; }
      c.start(st.locked);
    },
  };
}

export function classItem(c: BenchmarkContext): MenuItem {
  const shown = (): ClassId | null => { const st = classStateOf(c); return st.locked ?? c.pick.value; };
  return {
    id: 'class', label: 'CLASS',
    value: () => { const st = classStateOf(c), cls = shown(); return cls ? `${classLabel(cls)}${st.locked ? ' (LOCKED)' : ''}` : 'PICK YOURS'; },
    hint: () => {
      const st = classStateOf(c), g = c.gpu(), cls = shown();
      if (st.how === 'detected') return `Named by your browser from "${g.gpuId.slice(0, 60)}": ${g.why.toLowerCase()}. It cannot be changed.`;
      if (st.how === 'manual') return 'You picked this class for this graphics card and it is locked. It unlocks only if the game sees a different graphics card.';
      return `${g.why.toLowerCase()}. Pick the class with LEFT and RIGHT${cls ? ` (${classNote(cls)})` : ''} and press ENTER to lock it for this graphics card. Choose honestly: it cannot be changed afterwards.`;
    },
    left: () => { if (classStateOf(c).canChange) { c.pick.value = stepClass(c.pick.value, -1); c.refresh(); } },
    right: () => { if (classStateOf(c).canChange) { c.pick.value = stepClass(c.pick.value, 1); c.refresh(); } },
    enter: () => {
      const st = classStateOf(c);
      if (!st.canChange) { c.say(st.how === 'detected' ? 'NAMED BY YOUR BROWSER: CANNOT BE CHANGED' : 'ALREADY LOCKED FOR THIS GRAPHICS CARD'); c.refresh(); return; }
      if (!c.pick.value) { c.pick.value = stepClass(null, 1); c.say('PICKED. USE LEFT AND RIGHT TO CHANGE IT, ENTER TO LOCK'); c.refresh(); return; }
      const lock = lockClass(st, c.gpu().gpuId, c.pick.value, c.now());
      if (lock) { c.commit({ ...c.save(), classLock: lock }); c.say(`${classLabel(c.pick.value)} LOCKED`); }
      c.refresh();
    },
  };
}
