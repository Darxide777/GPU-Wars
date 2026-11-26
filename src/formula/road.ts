// A road for racing, as geometry only: smoothing a handful of control points into a closed curve, the banking and hills along it, finding the nearest point of the road, the wall at its edge,
// the gates across it and the grid behind the start. Ported from Chromium Halo: Neon's src/arena/road.ts with everything Formula does not use (open roads, ramps, loops, shortcuts) left out.
import type { Gate, GridSlot, Point, Road } from './types.ts';

/** the banking of a speedway's turns: Daytona's is 31 degrees (20.6 ft of rise over 34.2 ft across) */
export const DAYTONA_BANK = (31 * Math.PI) / 180;
/** how far (m) the bank takes to build up before a turn, and again to die away after it: it rises over twice this on the straight, in a smooth S */
const BANK_RAMP = 250;

/** a closed curve through the control points (Catmull-Rom), then spaced evenly `step` metres apart along its length */
export function smoothLoop(points: readonly Point[], step = 3): Point[] {
  const n = points.length, dense: Point[] = [], perSegment = 48, at = (i: number): Point => points[((i % n) + n) % n] as Point;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let k = 0; k < perSegment; k++) {
      const t = k / perSegment, t2 = t * t, t3 = t2 * t, f = (a: number, b: number, c: number, d: number): number => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  let total = 0; const cumulative: number[] = [0];
  for (let i = 0; i < dense.length; i++) { const a = dense[i] as Point, b = dense[(i + 1) % dense.length] as Point; total += Math.hypot(b.x - a.x, b.y - a.y); cumulative.push(total); }
  const count = Math.max(8, Math.round(total / step)), out: Point[] = []; let j = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total; while (j < dense.length - 1 && (cumulative[j + 1] as number) < target) j++;
    const a = dense[j] as Point, b = dense[(j + 1) % dense.length] as Point, segment = (cumulative[j + 1] as number) - (cumulative[j] as number), share = segment > 0 ? (target - (cumulative[j] as number)) / segment : 0;
    out.push({ x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share });
  }
  return out;
}
/** the length of the closed curve */
export const loopLength = (path: readonly Point[]): number => path.reduce((sum, p, i) => { const q = path[(i + 1) % path.length] as Point; return sum + Math.hypot(q.x - p.x, q.y - p.y); }, 0);
/** the way the road runs at point i (an angle) */
export const headingAt = (path: readonly Point[], i: number): number => { const n = path.length, a = path[(i - 1 + n) % n] as Point, b = path[(i + 1) % n] as Point; return Math.atan2(b.y - a.y, b.x - a.x); };

/** the banking along a closed path: `bank` radians through the long sweeping turns (a bend with a radius under about 460 m that goes on for a while; the gentle kinks and the straights stay flat), built up
 *  smoothly on the straight before each turn and eased away after it */
export function bankProfile(path: readonly Point[], bank: number, step = 3, bendRadius = 460): number[] {
  const n = path.length, w = Math.max(2, Math.round(40 / step)), at = (i: number): number => ((i % n) + n) % n;
  // is this a hard bend? the heading change over 80 m, as a curvature
  const mask = path.map((_, i) => { const a = headingAt(path, at(i - w)), b = headingAt(path, at(i + w)); return Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))) / (2 * w * step) > 1 / bendRadius; });
  const start = mask.findIndex((m, i) => m !== mask[at(i - 1)]);
  if (start < 0) return path.map(() => (mask[0] ? bank : 0));
  const gap = Math.round(150 / step), short = Math.round(150 / step);
  // every stretch of `on` no longer than `limit` becomes the other kind
  const flipRuns = (on: boolean, limit: number): void => {
    for (let i = start, done = 0; done < n;) { let len = 0; while (len < n - done && mask[at(i + len)] === (mask[at(i)] as boolean)) len++; if (mask[at(i)] === on && len <= limit) for (let k = 0; k < len; k++) mask[at(i + k)] = !on; i += len; done += len; }
  };
  // close the small gaps inside a turn (the radius wanders as the curve is smoothed), then drop bends too short to bank
  flipRuns(false, gap); flipRuns(true, short);
  // the bank starts building on the straight before the bend, so it is at full strength as the bend begins: widen the bend by the ramp's half length each way, then ease it with a Hann window (no corners where it starts or ends)
  const r = Math.round(BANK_RAMP / step), wide = mask.map((_, i) => { for (let k = -r; k <= r; k++) if (mask[at(i + k)]) return true; return false; }), kernel: number[] = [], out: number[] = []; let total = 0;
  for (let k = -r; k <= r; k++) { const v = 0.5 + 0.5 * Math.cos((Math.PI * k) / (r + 1)); kernel.push(v); total += v; }
  for (let i = 0; i < n; i++) { let sum = 0; for (let k = -r; k <= r; k++) if (wide[at(i + k)]) sum += kernel[k + r] as number; out.push(+(bank * (sum / total)).toFixed(5)); }
  return out;
}
/** the height of the road along a closed path (m), from a few points of the lap (how far round it, 0 to 1, and the height there): between them it eases from one to the next, so every point given is a crest or a dip */
export function elevationProfile(path: readonly Point[], points: readonly (readonly [number, number])[]): number[] {
  const n = path.length, along: number[] = [0]; for (let i = 1; i < n; i++) along.push((along[i - 1] as number) + Math.hypot((path[i] as Point).x - (path[i - 1] as Point).x, (path[i] as Point).y - (path[i - 1] as Point).y));
  const total = (along[n - 1] as number) + Math.hypot((path[0] as Point).x - (path[n - 1] as Point).x, (path[0] as Point).y - (path[n - 1] as Point).y), pts = [...points].sort((a, b) => a[0] - b[0]);
  return path.map((_, i) => {
    const f = (along[i] as number) / total; let k = pts.length - 1; for (let j = 0; j < pts.length; j++) if ((pts[j] as readonly [number, number])[0] > f) { k = j - 1; break; }
    const a = pts[(k + pts.length) % pts.length] as readonly [number, number], b = pts[(k + 1 + pts.length) % pts.length] as readonly [number, number];
    const fa = a[0] - (k < 0 ? 1 : 0), fb = b[0] + (k + 1 >= pts.length ? 1 : 0), u = fb > fa ? Math.min(1, Math.max(0, (f - fa) / (fb - fa))) : 0;
    return +(a[1] + (b[1] - a[1]) * (1 - Math.cos(Math.PI * u)) / 2).toFixed(3);
  });
}
/** which side of the road is the outside of the loop: 'left' or 'right' (the roads are driven clockwise on the screen, so the outside is on the left, but this works it out) */
export function outsideOf(road: Road): 'left' | 'right' {
  let area = 0; const p = road.path; for (let i = 0; i < p.length; i++) { const a = p[i] as Point, b = p[(i + 1) % p.length] as Point; area += a.x * b.y - b.x * a.y; }
  // (the y axis points down the screen, so a clockwise loop has a positive area)
  return area > 0 ? 'left' : 'right';
}

/** a road's segments sorted into square cells, so the nearest point of the road is found by looking only round the car (a 3 mile oval would otherwise take a pass over all of it each time) */
interface Cells { cell: number; x0: number; y0: number; w: number; h: number; cells: number[][]; outside: 'left' | 'right' }
const cellsOfRoad = new WeakMap<Road, Cells>();
function cellsFor(road: Road): Cells {
  let g = cellsOfRoad.get(road); if (g) return g;
  const path = road.path, n = path.length, cell = Math.max(40, road.width * 2.5); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of path) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const w = Math.floor((x1 - x0) / cell) + 1, h = Math.floor((y1 - y0) / cell) + 1, cells: number[][] = Array.from({ length: w * h }, () => []);
  for (let i = 0; i < n; i++) {
    const a = path[i] as Point, b = path[(i + 1) % n] as Point;
    for (let cx = Math.floor((Math.min(a.x, b.x) - x0) / cell); cx <= Math.floor((Math.max(a.x, b.x) - x0) / cell); cx++) for (let cy = Math.floor((Math.min(a.y, b.y) - y0) / cell); cy <= Math.floor((Math.max(a.y, b.y) - y0) / cell); cy++) (cells[cy * w + cx] as number[]).push(i);
  }
  g = { cell, x0, y0, w, h, cells, outside: outsideOf(road) }; cellsOfRoad.set(road, g); return g;
}
/** the nearest point on the road's middle line: how far it is, the point, which stretch (i to i + 1) and how far along that stretch (0 to 1) */
export function nearestOnRoad(road: Road, x: number, y: number): { d: number; px: number; py: number; i: number; t: number } {
  const path = road.path, n = path.length; let best = Infinity, bestIndex = 0, bestT = 0, bx = 0, by = 0;
  const test = (i: number): void => {
    const a = path[i] as Point, b = path[(i + 1) % n] as Point, dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
    let t = lengthSquared > 0 ? ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = a.x + dx * t, py = a.y + dy * t, d2 = (x - px) * (x - px) + (y - py) * (y - py);
    if (d2 < best || (d2 === best && i < bestIndex)) { best = d2; bestIndex = i; bestT = t; bx = px; by = py; }
  };
  if (n < 200) { for (let i = 0; i < n; i++) test(i); return { d: Math.sqrt(best), px: bx, py: by, i: bestIndex, t: bestT }; }
  const g = cellsFor(road), cx = Math.floor((x - g.x0) / g.cell), cy = Math.floor((y - g.y0) / g.cell), reach = Math.max(g.w, g.h) + 2;
  // rings of cells round the point's own, until the best found is nearer than anything the next ring could hold
  for (let r = 0; r <= reach; r++) {
    for (let gy = cy - r; gy <= cy + r; gy++) for (let gx = cx - r; gx <= cx + r; gx++) {
      if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) !== r || gx < 0 || gy < 0 || gx >= g.w || gy >= g.h) continue;
      for (const i of g.cells[gy * g.w + gx] as number[]) test(i);
    }
    if (best < Infinity && Math.sqrt(best) <= r * g.cell) break;
  }
  return { d: Math.sqrt(best), px: bx, py: by, i: bestIndex, t: bestT };
}
/** the road's surface under a point: the banking there, how high the road is (banking and hills together), the unit vector pointing to the inside of the loop, the way the road runs (a unit vector)
 *  and its grade (rise over run in that direction); null on a flat road */
export function roadSurface(road: Road, x: number, y: number): { bank: number; height: number; ix: number; iy: number; grade: number; tx: number; ty: number } | null {
  const bank = road.bank, elev = road.elev; if (!bank && !elev) return null;
  const h = nearestOnRoad(road, x, y), n = road.path.length, ang = headingAt(road.path, h.i), nx = -Math.sin(ang), ny = Math.cos(ang), sign = cellsFor(road).outside === 'left' ? -1 : 1;
  // (nx, ny) is the driver's right; the outside is that way times `sign`
  let th = 0, height = 0, grade = 0;
  if (bank) { const a = bank[h.i] as number, b = bank[(h.i + 1) % n] as number; th = a + (b - a) * h.t; height = Math.max(0, Math.min(road.width, road.width / 2 + sign * ((x - h.px) * nx + (y - h.py) * ny))) * Math.tan(th); }
  if (elev) { const a = elev[h.i] as number, b = elev[(h.i + 1) % n] as number, p = road.path[h.i] as Point, q = road.path[(h.i + 1) % n] as Point; height += a + (b - a) * h.t; grade = (b - a) / (Math.hypot(q.x - p.x, q.y - p.y) || 1); }
  return { bank: th, height, ix: -sign * nx, iy: -sign * ny, grade, tx: Math.cos(ang), ty: Math.sin(ang) };
}
/** whether a circle (x, y, r) has gone past the edge of the road, with the way back (a unit normal pointing in toward the road) and how far past it is */
export function roadHit(road: Road, x: number, y: number, r: number): { nx: number; ny: number; depth: number } | null {
  const h = nearestOnRoad(road, x, y), depth = h.d + r - road.width / 2; if (depth <= 0 || h.d < 1e-6) return null;
  return { nx: (h.px - x) / h.d, ny: (h.py - y) / h.d, depth };
}
/** whether the move (ax, ay) to (bx, by) goes through the gate, the way the gate is driven */
export function crossesGate(gate: Gate, ax: number, ay: number, bx: number, by: number): boolean {
  const side = (px: number, py: number): number => (gate.x2 - gate.x1) * (py - gate.y1) - (gate.y2 - gate.y1) * (px - gate.x1);
  const s0 = side(ax, ay), s1 = side(bx, by); if (s0 === s1 || (s0 > 0) === (s1 > 0)) return false;
  const dx = bx - ax, dy = by - ay, ex = gate.x2 - gate.x1, ey = gate.y2 - gate.y1, den = dx * ey - dy * ex; if (Math.abs(den) < 1e-12) return false;
  // where along the gate the move crosses (0 to 1)
  const u = ((ax - gate.x1) * dy - (ay - gate.y1) * dx) / -den;
  return u >= 0 && u <= 1 && dx * Math.cos(gate.a) + dy * Math.sin(gate.a) > 0;
}
/** the gates round a road (the first is the start and finish line) and the standing start place `back` metres behind the line, `lateral` (a share of the road's width) to the side */
export function gatesAndGrid(road: Road, gateCount: number, back: number, lateral: number): { gates: Gate[]; grid: GridSlot } {
  const path = road.path, n = path.length, gates: Gate[] = [];
  for (let k = 0; k < gateCount; k++) {
    const i = k === 0 ? 0 : Math.round((k * n) / gateCount) % n, p = path[i] as Point, a = headingAt(path, i), h = road.width / 2 + 2;
    gates.push({ x1: p.x - Math.sin(a) * h, y1: p.y + Math.cos(a) * h, x2: p.x + Math.sin(a) * h, y2: p.y - Math.cos(a) * h, a, i });
  }
  const step = loopLength(path) / n, i = ((0 - Math.round(back / step)) % n + n) % n, p = path[i] as Point, a = headingAt(path, i), lat = lateral * road.width;
  return { gates, grid: { x: p.x - Math.sin(a) * lat, y: p.y + Math.cos(a) * lat, a } };
}
/** the two edges of the road: `right` is the driver's right-hand side (drawn magenta) and `left` the other (cyan); `grow` makes it wider (a kerb, a barrier) */
export function roadEdges(road: Road, grow = 0): { left: Point[]; right: Point[] } {
  const path = road.path, h = road.width / 2 + grow, left: Point[] = [], right: Point[] = [];
  path.forEach((p, i) => { const a = headingAt(path, i), nx = -Math.sin(a), ny = Math.cos(a); right.push({ x: p.x + nx * h, y: p.y + ny * h }); left.push({ x: p.x - nx * h, y: p.y - ny * h }); });
  return { left, right };
}
/** the outline of the land on the inside of the shore: the road's outer edge pushed out by `gap` metres (the sea is everything outside it) */
export function shoreLine(road: Road, gap: number): Point[] { const e = roadEdges(road, gap); return outsideOf(road) === 'left' ? e.left : e.right; }
/** the distance along the middle line to each path point (m from the start line, which is path point 0); the last entry is the lap's length */
const cumulativeOfRoad = new WeakMap<Road, number[]>();
export function cumulativeLengths(road: Road): number[] {
  let c = cumulativeOfRoad.get(road); if (c) return c;
  const path = road.path; c = [0]; for (let i = 0; i < path.length; i++) { const a = path[i] as Point, b = path[(i + 1) % path.length] as Point; c.push((c[i] as number) + Math.hypot(b.x - a.x, b.y - a.y)); }
  cumulativeOfRoad.set(road, c); return c;
}
/** how far along the lap (m from the start line) a place on stretch i, a share t of the way to the next point, is */
export const alongOf = (road: Road, i: number, t: number): number => { const c = cumulativeLengths(road); return (c[i] as number) + t * ((c[i + 1] as number) - (c[i] as number)); };
/** a place `along` metres from the start line (any number: it wraps round the lap) and `across` metres to the driver's right of the middle line: where it is and which way the road runs there */
export function pointAtAlong(road: Road, along: number, across = 0): { x: number; y: number; a: number } {
  const c = cumulativeLengths(road), n = road.path.length, total = c[n] as number, s = ((along % total) + total) % total;
  let lo = 0, hi = n - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if ((c[mid] as number) <= s) lo = mid; else hi = mid - 1; }
  const a = road.path[lo] as Point, b = road.path[(lo + 1) % n] as Point, seg = (c[lo + 1] as number) - (c[lo] as number), t = seg > 0 ? (s - (c[lo] as number)) / seg : 0, heading = Math.atan2(b.y - a.y, b.x - a.x);
  return { x: a.x + (b.x - a.x) * t - Math.sin(heading) * across, y: a.y + (b.y - a.y) * t + Math.cos(heading) * across, a: heading };
}
/** how far you can drive from (x, y) along angle a before the edge of the road, up to `max` */
export function roadRay(road: Road, x: number, y: number, a: number, max: number): number {
  const dx = Math.cos(a), dy = Math.sin(a), limit = road.width / 2 - 0.4;
  for (let s = 1; s <= max; s += 1) if (nearestOnRoad(road, x + dx * s, y + dy * s).d > limit) return s - 0.5;
  return max;
}
