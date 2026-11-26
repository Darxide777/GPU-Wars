// The BENCHMARK and CLASS rows of the title menu (the rules are in rules.ts; the page hands in what it holds through `BenchmarkContext`, which keeps the page's own edits small).
// The CLASS row only SHOWS the class the game detected from the graphics card. It has no arrows and no ENTER action: a class cannot be picked or locked.
import type { MenuItem } from '../arena/view/menu.ts';
import type { Save } from '../save.ts';
import { classLabel, classNote, type ClassId } from '../classes.ts';
import { rerunReason } from './rules.ts';
import { MASKED_NOTE, type GpuIdentity } from './gpu.ts';

export interface BenchmarkContext {
  save: () => Save; gpu: () => GpuIdentity;
  /** put a line under the title */ say: (text: string) => void;
  /** start the benchmark for this class */ start: (cls: ClassId, masked: boolean) => void;
  /** redraw the menu */ refresh: () => void;
}

/** the line under the title menu's name: the class and the score, or what is missing */
export function benchmarkLine(c: BenchmarkContext): string {
  const s = c.save(), g = c.gpu(), why = rerunReason(s.benchmark, g.gpuId, undefined, g.ready ? g.gpuClass : null, g.masked);
  if (!s.benchmark) return `NO BENCHMARK YET: RUN IT FROM THE BENCHMARK ROW. UNTIL THEN THE CAR HAS STOCK NUMBERS. YOUR CLASS: ${g.ready ? (g.masked ? 'SET FROM MEASURED SPEED (GPU NAME HIDDEN)' : classLabel(g.gpuClass)) : 'CHECKING'}`;
  const cls = classLabel(s.benchmark.class as ClassId);
  return why ? `${cls}  SCORE ${s.benchmark.score}  RE-RUN NEEDED: ${why.toUpperCase()}` : `${cls}  SCORE ${s.benchmark.score}`;
}

export function benchmarkItem(c: BenchmarkContext): MenuItem {
  return {
    id: 'benchmark', label: 'BENCHMARK',
    value: () => { const s = c.save(), g = c.gpu(), why = rerunReason(s.benchmark, g.gpuId, undefined, g.ready ? g.gpuClass : null, g.masked); return !s.benchmark ? 'NOT RUN' : why ? 'RE-RUN' : `SCORE ${s.benchmark.score}`; },
    hint: () => 'Scores your graphics card with a few seconds of neon, lights and music, and sets your car\'s horsepower and torque from the score. It runs only from here, never by itself, and needs to be run again only if your graphics card, its detected class or the benchmark itself changes. Keep this page in front while it runs.',
    enter: () => {
      const g = c.gpu();
      if (!g.ready) { c.say('STILL CHECKING YOUR GRAPHICS CARD: TRY AGAIN IN A MOMENT'); c.refresh(); return; }
      c.start(g.gpuClass, g.masked);
    },
  };
}

/** read-only: the class the game detected. ENTER, LEFT and RIGHT do nothing (the row has no handlers) (there is no way to pick a class) */
export function classItem(c: BenchmarkContext): MenuItem {
  return {
    id: 'class', label: 'CLASS',
    value: () => { const g = c.gpu(), b = c.save().benchmark; return !g.ready ? 'CHECKING...' : g.masked ? (b?.classFromSpeed ? `${classLabel(b.class as ClassId)} (FROM MEASURED SPEED)` : `${classLabel(g.gpuClass)} (UNTIL BENCHMARKED)`) : `${classLabel(g.gpuClass)} (DETECTED)`; },
    hint: () => { const g = c.gpu(); return g.ready ? `Detected from "${g.gpuId.slice(0, 60)}": ${g.why.toLowerCase()}. ${classNote(g.gpuClass)}. The class is worked out by the game and cannot be picked or changed.${g.masked ? ' ' + MASKED_NOTE.charAt(0) + MASKED_NOTE.slice(1).toLowerCase() + '.' : ''}` : 'The game is reading what your browser says about your graphics card.'; },
  };
}
