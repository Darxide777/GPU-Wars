// The Formula tracks, as DATA. A track is a handful of control points (smoothed into a closed road and scaled to a lap length), a width, its banking and hills and where the start line and the grid are.
// To add a track: add a `TrackSpec` to `TRACK_SPECS` (the first is the one Formula starts with). Nothing else needs to change: the car, the racing line, the autopilot, the ghost and the picture all read the built track.
// BEACH is a plain banked oval (the source game's was a tri-oval with a kink; this one is just a stadium shape you can drive flat out); that game's city (MONACO) and mountain (the Nurburgring-style ring) tracks can be added back the same way.
import { DAYTONA_BANK, bankProfile, elevationProfile, gatesAndGrid, loopLength, smoothLoop } from './road.ts';
import type { FormulaTrack, Point, Road } from './types.ts';

export interface TrackSpec {
  id: string; name: string; theme: 'speedway'; /** the road's width, metres */ width: number;
  /** the lap's length in metres: the control points are scaled to it */ length: number;
  /** metres of ground round the road, for the scenery */ margin: number;
  /** control points, in any size, driven clockwise on the screen from the first (the start line is the first point's stretch) */ points: [number, number][];
  /** how many gates go round the lap (the first is the start line, the rest are the sector splits) */ gates: number;
  /** banking in the turns, in radians (a speedway); missing is flat */ bank?: number;
  /** a bend with a radius under this many metres is banked (the default is 460 m: only tight bends) */ bankRadius?: number;
  /** the hills: how far round the lap (0 to 1) and how high the road is there (m); missing is flat */ elevation?: [number, number][];
  /** the standing start: metres behind the line, and how far to the side (a share of the road's width, negative is the driver's left) */ gridBack: number; gridSide: number;
}

/** the scale that makes a loop of these points this long (the smoothing barely changes with size, so three goes get it to within a metre) */
function scaleFor(points: [number, number][], length: number): number {
  let k = 1; for (let i = 0; i < 3; i++) k *= length / loopLength(smoothLoop(points.map(([x, y]) => ({ x: x * k, y: y * k })), 3)); return k;
}
/** a spec turned into a track the simulation uses */
export function buildTrack(spec: TrackSpec): FormulaTrack {
  const k = scaleFor(spec.points, spec.length), raw = smoothLoop(spec.points.map(([x, y]): Point => ({ x: x * k, y: y * k })), 3), pad = spec.width / 2 + spec.margin;
  const minX = Math.min(...raw.map(p => p.x)) - pad, minY = Math.min(...raw.map(p => p.y)) - pad, maxX = Math.max(...raw.map(p => p.x)) + pad, maxY = Math.max(...raw.map(p => p.y)) + pad;
  const path = raw.map((p): Point => ({ x: +(p.x - minX).toFixed(2), y: +(p.y - minY).toFixed(2) }));
  const road: Road = { path, width: spec.width, ...(spec.bank ? { bank: bankProfile(path, spec.bank, 3, spec.bankRadius) } : {}), ...(spec.elevation ? { elev: elevationProfile(path, spec.elevation) } : {}) };
  const { gates, grid } = gatesAndGrid(road, spec.gates, spec.gridBack, spec.gridSide);
  return { id: spec.id, name: spec.name, theme: spec.theme, w: Math.ceil(maxX - minX), h: Math.ceil(maxY - minY), road, gates, grid, length: loopLength(path) };
}

/** the control points of a plain oval (a stadium): two straights joined by two half circles, driven clockwise on the screen, starting in the middle of the top straight so the start line has a long straight on each side */
export function ovalPoints(straight: number, radius: number, pointsPerTurn = 14): [number, number][] {
  const half = straight / 2, out: [number, number][] = [[0, 0], [half, 0]];
  for (let i = 1; i < pointsPerTurn; i++) { const a = -Math.PI / 2 + (Math.PI * i) / pointsPerTurn; out.push([half + radius * Math.cos(a), radius + radius * Math.sin(a)]); }
  out.push([half, 2 * radius], [0, 2 * radius], [-half, 2 * radius]);
  for (let i = 1; i < pointsPerTurn; i++) { const a = Math.PI / 2 + (Math.PI * i) / pointsPerTurn; out.push([-half + radius * Math.cos(a), radius + radius * Math.sin(a)]); }
  out.push([-half, 0]);
  return out.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]);
}

export const TRACK_SPECS: TrackSpec[] = [
  {
    // a plain 3 mile oval: two 843 m straights and two banked half circles of 500 m radius (31 degrees, like Daytona's turns), a track you can drive flat out all the way round; the start line is in the middle of a straight with the grid behind it; the beach is outside
    id: 'beach', name: 'BEACH', theme: 'speedway', width: 24, length: 4828, margin: 140, gates: 7, bank: DAYTONA_BANK, bankRadius: 800, gridBack: 5, gridSide: -0.2,
    points: ovalPoints(843, 500),
  },
];
/** every track, built (the first is the default) */
export const FORMULA_TRACKS: FormulaTrack[] = TRACK_SPECS.map(buildTrack);
export const trackById = (id: string): FormulaTrack => FORMULA_TRACKS.find(t => t.id === id) ?? (FORMULA_TRACKS[0] as FormulaTrack);
