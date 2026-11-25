// The drag car and its parts. GPU Wars has no shop, money or upgrades: the car always runs the TOP level of every part ("stock parts"), and its power comes from the benchmark.
import type { DragCarDef, PartDef, Parts } from './types.ts';

// One car, the dragster. (Its id stays 'streeter', as in the Chromium Halo: Neon source, so old tunes and ghosts read the same.)
export const DRAG_CARS: DragCarDef[] = [
  { id: 'streeter', name: 'DRAGSTER', col: '#ffe14d', trim: '#ff2bd6', mass: 1250, torque: 1625, peakRpm: 5800, idle: 1400, redline: 7800, gears: [2.4, 1.7, 1.3, 1.0], gearEff: [0.875, 0.88, 0.885, 0.89], final: 3.4, tire: 0.42, grip: 0.75, rear: 0.65, cda: 0.62, blurb: 'Long, light and hungry.' },
];
export const dragCarById = (id: string): DragCarDef => DRAG_CARS.find(c => c.id === id) ?? (DRAG_CARS[0] as DragCarDef);

/** every part and its highest level (level 0 is the bare chassis; the physics and `specFor` read these limits) */
export const PARTS: PartDef[] = [
  { id: 'turbo', name: 'BLOWER', max: 6, what: 'more torque, a higher peak and limiter, and boost that spools up with revs and dips after each shift' },
  { id: 'gearbox', name: 'GEARBOX', max: 4, what: 'quicker shifts; level 2 adds a gear' },
  { id: 'clutch', name: 'CLUTCH', max: 4, what: 'a stronger clutch: cooler launches, less wear and quicker shifts' },
  { id: 'tires', name: 'TIRES', max: 6, what: 'more grip, up to wide slicks' },
  { id: 'weight', name: 'WEIGHT', max: 6, what: '-40 kg a level' },
  { id: 'nitro', name: 'NITRO', max: 4, what: 'a bottle, then a bigger one and a bigger shot' },
  { id: 'aero', name: 'AERO', max: 4, what: 'less drag at speed' },
];
/** the stock parts of the simulation: the top level of every part */
export const STOCK_PARTS: Parts = Object.fromEntries(PARTS.map(p => [p.id, p.max])) as Parts;
