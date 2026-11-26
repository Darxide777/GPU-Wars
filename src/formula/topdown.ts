// The track from above, in the neon style: the oval with its cyan left edge and magenta right edge, the yellow dashes down the middle, the banked turns shaded, the sea beyond the shore, the start line (chequered) and the sector gates,
// your car, the ghost car (see-through), and, when asked for, the racing line in green, yellow and red. The camera is on your car, always north up, and pulls back as you go faster; a small map of the whole oval is in the
// bottom left corner. It only reads the view and draws; the lap HUD (hud.ts) is drawn over it by `draw`. The only words are the HUD's. Nothing here uses Math.random (the picture is the same for the same lap).
import { C } from '../sim/constants.ts';
import { drawGearBox, drawLapPanel, drawLights, overlaps, type HudOptions, type Rect } from './hud.ts';
import type { FormulaView } from './race.ts';
import { LINE_COLOURS, type RacingLine } from './racingLine.ts';
import { roadEdges, shoreLine } from './road.ts';
import type { FormulaTrack, Point } from './types.ts';

export const CAMERA = {
  /** the metres of road the window's height shows when standing still, and how many more per m/s of speed (the view pulls back as you go faster) */ baseSpan: 46, speedSpan: 0.55,
  /** the camera looks this many seconds ahead of the car along its heading, so you see more of the road in front of you */ lookAhead: 0.3,
  /** the metres of ground shown at the closest zoom, so a phone window is not too tight */ minSpan: 30,
  /** a window narrower than this share of its height is zoomed to fit its width (see `cameraOf`) */ narrowShare: 1.4,
} as const;
const MAP = { share: 0.26, minSide: 90, maxSide: 220, margin: 8 } as const;
const GROUND = '#2a1228';
export interface DrawOptions extends HudOptions {
  /** show the racing line (the green, yellow and red driving line); `line` is the line from `racingLineFor` (nothing is drawn without it) */ showLine?: boolean; line?: RacingLine | null;
  /** seconds, for the shift lamp blink and nothing else */ time?: number;
}
interface Geometry { left: Point[]; right: Point[]; shore: Point[] }
const geometries = new WeakMap<FormulaTrack, Geometry>();
const geometryOf = (track: FormulaTrack): Geometry => { let g = geometries.get(track); if (!g) { g = { ...roadEdges(track.road), shore: shoreLine(track.road, 90) }; geometries.set(track, g); } return g; };

/** the camera for a view: where it looks (metres) and how many pixels a metre is (a pure function of the car's state, so the picture never jumps) */
export function cameraOf(view: FormulaView, W: number, H: number): { cx: number; cy: number; scale: number } {
  // (a tall narrow window shows as much road across as a wide one shows down, so the car is never tiny on a phone held upright)
  const car = view.car, span = Math.max(CAMERA.minSpan, CAMERA.baseSpan + CAMERA.speedSpan * car.speed);
  return { cx: car.x + Math.cos(car.a) * car.speed * CAMERA.lookAhead, cy: car.y + Math.sin(car.a) * car.speed * CAMERA.lookAhead, scale: Math.min(H, W * CAMERA.narrowShare) / span };
}
/** the whole picture: the track, the line, the cars, the map and the HUD */
export function draw(ctx: CanvasRenderingContext2D, W: number, H: number, view: FormulaView, options: DrawOptions = {}): { panel: Rect; gearBox: Rect; map: Rect | null } {
  const cam = cameraOf(view, W, H), sx = (x: number): number => W / 2 + (x - cam.cx) * cam.scale, sy = (y: number): number => H / 2 + (y - cam.cy) * cam.scale, k = cam.scale, S = Math.max(0.7, Math.min(1.6, H / 720));
  ctx.fillStyle = '#05010f'; ctx.fillRect(0, 0, W, H);
  drawTrack(ctx, view.track, sx, sy, k);
  if (options.showLine && options.line) drawLine(ctx, options.line, sx, sy, k);
  if (view.ghost) drawCar(ctx, sx(view.ghost.x), sy(view.ghost.y), view.ghost.a, k, C.cyan, C.vio, 0.4, false);
  drawCar(ctx, sx(view.car.x), sy(view.car.y), view.car.a, k, C.cyan, C.mag, 1, view.car.nitroT > 0);
  // (the small map sits in the bottom left, where the touch steering buttons are: it is left out when a button is in its place)
  const map = mapBox(W, H, view.track), mapShown = !(options.avoid ?? []).some(r => overlaps(map, r));
  if (mapShown) drawMap(ctx, W, H, view);
  const panel = drawLapPanel(ctx, W, H, S, view, options); drawLights(ctx, W, S, view); const gearBox = drawGearBox(ctx, W, H, S, view, options.time ?? 0, options.avoid);
  return { panel, gearBox, map: mapShown ? map : null };
}
function ring(ctx: CanvasRenderingContext2D, pts: Point[], sx: (x: number) => number, sy: (y: number) => number): void { pts.forEach((p, i) => (i ? ctx.lineTo(sx(p.x), sy(p.y)) : ctx.moveTo(sx(p.x), sy(p.y)))); ctx.closePath(); }
/** the ground, the sea, the asphalt, its neon edges, the bank, the middle dashes and the gates */
function drawTrack(ctx: CanvasRenderingContext2D, track: FormulaTrack, sx: (x: number) => number, sy: (y: number) => number, k: number): void {
  const g = geometryOf(track), road = track.road;
  ctx.fillStyle = GROUND; ctx.fillRect(sx(0), sy(0), track.w * k, track.h * k);
  // the sea beyond the shore line, with a line of foam
  const sea = ctx.createLinearGradient(0, sy(0), 0, sy(track.h)); sea.addColorStop(0, '#0a4a6e'); sea.addColorStop(1, '#021428');
  ctx.beginPath(); ctx.rect(sx(0), sy(0), track.w * k, track.h * k); ring(ctx, g.shore, sx, sy); ctx.fillStyle = sea; ctx.fill('evenodd');
  ctx.strokeStyle = 'rgba(189,247,255,0.55)'; ctx.lineWidth = Math.max(1.5, 0.35 * k); ctx.beginPath(); ring(ctx, g.shore, sx, sy); ctx.stroke();
  // the asphalt: the area between the two edges
  ctx.beginPath(); ring(ctx, g.left, sx, sy); ring(ctx, [...g.right].reverse(), sx, sy); ctx.fillStyle = '#0d0828'; ctx.fill('evenodd');
  // the banking: faint magenta bars across the road where it is banked, stronger the steeper
  if (road.bank) {
    ctx.lineWidth = Math.max(1, 0.25 * k); const n = road.path.length;
    for (let i = 0; i < n; i += 8) { const b = road.bank[i] as number; if (b < 0.05) continue; const l = g.left[i] as Point, r = g.right[i] as Point; ctx.strokeStyle = `rgba(255,43,214,${(0.1 + 0.4 * Math.min(1, b / 0.54)).toFixed(2)})`; ctx.beginPath(); ctx.moveTo(sx(l.x), sy(l.y)); ctx.lineTo(sx(r.x), sy(r.y)); ctx.stroke(); }
  }
  ctx.shadowBlur = 10; ctx.lineWidth = Math.max(2, 0.45 * k);
  for (const [pts, col] of [[g.left, C.cyan], [g.right, C.mag]] as const) { ctx.shadowColor = col; ctx.strokeStyle = col; ctx.beginPath(); ring(ctx, pts as Point[], sx, sy); ctx.stroke(); }
  ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,225,77,0.7)'; ctx.lineWidth = Math.max(1.5, 0.3 * k); ctx.setLineDash([2.5 * k, 3.5 * k]); ctx.beginPath(); ring(ctx, road.path, sx, sy); ctx.stroke(); ctx.setLineDash([]);
  // the gates: the start line is chequered, the sector gates are thin yellow lines
  track.gates.forEach((gate, i) => {
    if (i) { ctx.strokeStyle = 'rgba(255,225,77,0.55)'; ctx.lineWidth = Math.max(1, 0.25 * k); ctx.beginPath(); ctx.moveTo(sx(gate.x1), sy(gate.y1)); ctx.lineTo(sx(gate.x2), sy(gate.y2)); ctx.stroke(); return; }
    const len = Math.hypot(gate.x2 - gate.x1, gate.y2 - gate.y1), n = Math.max(2, Math.round(len / 1.5)), ux = (gate.x2 - gate.x1) / len, uy = (gate.y2 - gate.y1) / len, d = 1.5, cx = Math.cos(gate.a), cy = Math.sin(gate.a);
    for (let q = 0; q < n; q++) for (let row = 0; row < 2; row++) {
      const t = (q / n) * len, w = len / n, px = gate.x1 + ux * t - cx * (row ? 0 : d), py = gate.y1 + uy * t - cy * (row ? 0 : d);
      ctx.fillStyle = (q + row) % 2 ? '#e8f8ff' : '#150a30'; ctx.beginPath(); ctx.moveTo(sx(px), sy(py)); ctx.lineTo(sx(px + ux * w), sy(py + uy * w)); ctx.lineTo(sx(px + ux * w + cx * d), sy(py + uy * w + cy * d)); ctx.lineTo(sx(px + cx * d), sy(py + cy * d)); ctx.closePath(); ctx.fill();
    }
  });
}
/** the racing line: green where the driver accelerates, yellow where it lifts or a braking zone is coming, red where it brakes */
function drawLine(ctx: CanvasRenderingContext2D, line: RacingLine, sx: (x: number) => number, sy: (y: number) => number, k: number): void {
  const n = line.x.length; ctx.lineWidth = Math.max(2, 0.6 * k); ctx.lineCap = 'round';
  for (let kind = 0; kind < LINE_COLOURS.length; kind++) {
    ctx.strokeStyle = LINE_COLOURS[kind] as string; ctx.beginPath();
    for (let i = 0; i < n; i++) if (line.kind[i] === kind) { const j = (i + 1) % n; ctx.moveTo(sx(line.x[i] as number), sy(line.y[i] as number)); ctx.lineTo(sx(line.x[j] as number), sy(line.y[j] as number)); }
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}
/** one formula car from above at (x, y) on the screen, its nose along heading `a`: big wheels at the corners, a thin body, the rear wing; `alpha` makes the ghost see-through */
function drawCar(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, k: number, col: string, trim: string, alpha: number, nitro: boolean): void {
  const m = Math.max(k, 2.2);
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(a + Math.PI / 2); ctx.lineWidth = Math.max(1.2, 0.12 * m);
  // the car points up its own y axis (nose at the top): the rear is at +y
  if (nitro) for (const off of [-0.45, 0.45]) { ctx.fillStyle = 'rgba(255,138,31,0.85)'; ctx.beginPath(); ctx.moveTo((off - 0.18) * m, 2.5 * m); ctx.lineTo(off * m, 2.5 * m + 3 * m); ctx.lineTo((off + 0.18) * m, 2.5 * m); ctx.fill(); }
  ctx.shadowColor = col; ctx.shadowBlur = alpha < 1 ? 4 : 10;
  const wheel = (wx: number, wy: number, w: number, h: number): void => { ctx.fillStyle = '#05010f'; ctx.strokeStyle = trim; ctx.fillRect((wx - w / 2) * m, (wy - h / 2) * m, w * m, h * m); ctx.strokeRect((wx - w / 2) * m, (wy - h / 2) * m, w * m, h * m); };
  wheel(-1.0, 1.4, 0.95, 1.4); wheel(1.0, 1.4, 0.95, 1.4); wheel(-0.95, -1.5, 0.6, 1.0); wheel(0.95, -1.5, 0.6, 1.0);
  ctx.strokeStyle = col; ctx.fillStyle = '#10062e'; ctx.beginPath(); ctx.moveTo(0, -2.7 * m); ctx.lineTo(0.28 * m, -1.8 * m); ctx.lineTo(0.42 * m, 0.4 * m); ctx.lineTo(0.55 * m, 2.1 * m); ctx.lineTo(-0.55 * m, 2.1 * m); ctx.lineTo(-0.42 * m, 0.4 * m); ctx.lineTo(-0.28 * m, -1.8 * m); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = trim; ctx.strokeRect(-1.1 * m, 2.1 * m, 2.2 * m, 0.34 * m); ctx.fillRect(-1.1 * m, 2.1 * m, 2.2 * m, 0.34 * m);
  ctx.shadowBlur = 0; ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, 0.35 * m, 0.22 * m, 0.4 * m, 0, 0, 6.283); ctx.fill();
  ctx.restore();
}
/** the small map of the whole oval in the bottom left corner: the road, the start line, your dot and the ghost's */
function mapBox(W: number, H: number, track: FormulaTrack): Rect {
  const side = Math.max(MAP.minSide, Math.min(MAP.maxSide, Math.min(W, H) * MAP.share)), k = Math.min(side / track.w, side / track.h);
  return { x: MAP.margin - 4, y: H - MAP.margin - track.h * k - 4, w: track.w * k + 8, h: track.h * k + 8 };
}
function drawMap(ctx: CanvasRenderingContext2D, W: number, H: number, view: FormulaView): void {
  const track = view.track, side = Math.max(MAP.minSide, Math.min(MAP.maxSide, Math.min(W, H) * MAP.share)), k = Math.min(side / track.w, side / track.h), x0 = MAP.margin, y0 = H - MAP.margin - track.h * k;
  const mx = (x: number): number => x0 + x * k, my = (y: number): number => y0 + y * k;
  ctx.fillStyle = 'rgba(5,1,15,0.55)'; ctx.fillRect(x0 - 4, y0 - 4, track.w * k + 8, track.h * k + 8);
  ctx.strokeStyle = C.vio; ctx.lineWidth = Math.max(2, track.road.width * k); ctx.lineJoin = 'round'; ctx.beginPath(); ring(ctx, track.road.path, mx, my); ctx.stroke();
  const start = track.gates[0]; if (start) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(mx(start.x1), my(start.y1)); ctx.lineTo(mx(start.x2), my(start.y2)); ctx.stroke(); }
  const dot = (x: number, y: number, col: string, r: number): void => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(mx(x), my(y), r, 0, 6.283); ctx.fill(); };
  if (view.ghost) dot(view.ghost.x, view.ghost.y, 'rgba(33,230,255,0.6)', 3); dot(view.car.x, view.car.y, C.cyan, 4);
}
