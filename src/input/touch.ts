// On-screen touch controls for phones and tablets: gas pedal (analog), brake, steering slider (analog), shift up and down, launch, nitro, chute, burnout and back up, plus a MENU button.
// The layout is a pure function (testable); the pointer handling turns touches into queue events with the browser's own timestamps.
import { INPUT } from './constants.ts';
import type { InputQueue } from './queue.ts';

export interface TouchRect { id: string; label: string; x: number; y: number; w: number; h: number; kind: 'button' | 'pedal' | 'slider' }
/** the id of the MENU button (leaves the race; it is not a driving control) */
export const TOUCH_MENU = 'menu';

/** where each control sits for a screen of w by h and a size multiplier (0.7 to 1.5). Landscape puts steering bottom-left and the pedals bottom-right; portrait gives steering the whole bottom row. */
export function touchLayout(w: number, h: number, size = 1): TouchRect[] {
  const portrait = h > w, fit = portrait ? Math.min(w / 5, h / 6.8) : Math.min(w / 8, h / 5.4), u = Math.min(Math.max(36, Math.min(w, h) * 0.16) * size, fit), m = u * 0.22, out: TouchRect[] = [];      // (the cap keeps every button on a small screen, whatever the size setting)
  const add = (id: string, label: string, x: number, y: number, ww: number, hh: number, kind: TouchRect['kind'] = 'button'): TouchRect => { const r = { id, label, x, y, w: ww, h: hh, kind }; out.push(r); return r; };
  const floor = portrait ? h - m - 1.2 * u - m : h - m;      // the lowest edge of the right-hand stacks
  add('steer', 'STEER', m, h - m - 1.2 * u, portrait ? w - 2 * m : Math.max(2.2 * u, Math.min(4.4 * u, w - 4.3 * u - 5 * m)), 1.2 * u, 'slider');
  const gas = add('gas', 'GAS', w - m - 1.5 * u, floor - 3 * u, 1.5 * u, 3 * u, 'pedal');
  const brake = add('brake', 'BRAKE', gas.x - m - 1.4 * u, floor - 1.5 * u, 1.4 * u, 1.5 * u);
  const nitro = add('nitro', 'NITRO', brake.x, brake.y - m - u, 1.4 * u, u);
  add('chute', 'CHUTE', nitro.x, nitro.y - m - u, 1.4 * u, u);
  const col3 = brake.x - m - 1.4 * u;
  add('launch', 'GO', col3, floor - 1.5 * u, 1.4 * u, 1.5 * u);
  add('burnout', 'BURN', col3, floor - 1.5 * u - m - u, 1.4 * u, u);
  add('backUp', 'BACK UP', col3, floor - 1.5 * u - 2 * (m + u), 1.4 * u, u);
  if (portrait) { add('shiftUp', 'UP', col3, floor - 1.5 * u - 3 * (m + u), 1.4 * u, u); add('shiftDown', 'DOWN', col3, floor - 1.5 * u - 4 * (m + u), 1.4 * u, u); }      // (no room on the left in portrait: they continue the third column)
  else { const shiftY = h - 2 * m - 1.2 * u - u; add('shiftDown', 'DOWN', m, shiftY, 1.3 * u, u); add('shiftUp', 'UP', m + 1.3 * u + m, shiftY, 1.3 * u, u); }
  add(TOUCH_MENU, 'MENU', m, m, 1.1 * u, 0.6 * u);
  return out;
}
const inside = (r: TouchRect, x: number, y: number): boolean => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
/** the rectangle under a point, the later (higher) one first */
export function hitTest(layout: TouchRect[], x: number, y: number): TouchRect | null { for (let i = layout.length - 1; i >= 0; i--) if (inside(layout[i] as TouchRect, x, y)) return layout[i] as TouchRect; return null; }

/** the gas from where the thumb is on the pedal (its bottom is the least), or from the pressure when the screen reports a real one */
export function pedalValue(r: TouchRect, y: number, pressure: number, analog: boolean): number {
  if (!analog) return 1;
  const real = pressure > 0 && pressure < 1 && pressure !== 0.5, frac = real ? pressure : Math.max(0, Math.min(1, (r.y + r.h - y) / r.h));
  return Math.max(INPUT.touchMinGas, Math.pow(frac, INPUT.touchAnalogCurve));
}
/** the steering from where the thumb is on the slider (the middle is straight) */
export function sliderValue(r: TouchRect, x: number): number {
  const f = Math.max(-1, Math.min(1, (x - (r.x + r.w / 2)) / (r.w / 2))), a = Math.abs(f);
  if (a < INPUT.touchSteerDead) return 0;
  return Math.sign(f) * Math.pow((a - INPUT.touchSteerDead) / (1 - INPUT.touchSteerDead), INPUT.touchSteerCurve);
}

export interface TouchHooks { size: () => number; analog: () => boolean; width: () => number; height: () => number; onMenu: () => void; active: () => boolean; onTouchSeen: () => void }
export function createTouchControls(queue: InputQueue, hooks: TouchHooks) {
  const pointers = new Map<number, string>(), pressedIds = new Map<string, number>();
  let layout: TouchRect[] = [], layoutKey = '', pedal = 0, steer = 0;
  const current = (): TouchRect[] => { const key = `${hooks.width()}x${hooks.height()}x${hooks.size()}`; if (key !== layoutKey) { layout = touchLayout(hooks.width(), hooks.height(), hooks.size()); layoutKey = key; } return layout; };
  const rectOf = (id: string): TouchRect | undefined => current().find(r => r.id === id);
  function press(id: string, pointerId: number, x: number, y: number, pressure: number, t: number): void {
    pointers.set(pointerId, id); pressedIds.set(id, (pressedIds.get(id) ?? 0) + 1);
    const r = rectOf(id) as TouchRect;
    if (id === TOUCH_MENU) { hooks.onMenu(); return; }
    if (r.kind === 'slider') { steer = sliderValue(r, x); queue.push({ t, kind: 'analog', control: 'steerTouch', source: 't:' + pointerId, value: steer }); return; }
    queue.push({ t, kind: 'down', control: id, source: 't:' + pointerId, value: 1 });
    if (r.kind === 'pedal') { pedal = pedalValue(r, y, pressure, hooks.analog()); queue.push({ t, kind: 'analog', control: 'gasTouch', source: 't:' + pointerId, value: pedal }); }
  }
  function release(pointerId: number, t: number): void {
    const id = pointers.get(pointerId); if (!id) return; pointers.delete(pointerId);
    const left = (pressedIds.get(id) ?? 1) - 1; if (left <= 0) pressedIds.delete(id); else pressedIds.set(id, left);
    const r = rectOf(id); if (!r || id === TOUCH_MENU) return;
    if (r.kind === 'slider') { if (left <= 0) queue.push({ t, kind: 'analog', control: 'steerTouch', source: 't:' + pointerId, value: NaN }); return; }
    queue.push({ t, kind: 'up', control: id, source: 't:' + pointerId, value: 1 });
    if (r.kind === 'pedal' && left <= 0) queue.push({ t, kind: 'analog', control: 'gasTouch', source: 't:' + pointerId, value: NaN });
  }
  return {
    get layout(): TouchRect[] { return current(); },
    /** attach to the canvas; the canvas has touch-action none so the browser never scrolls or zooms instead */
    attach(el: HTMLElement): void {
      const at = (e: PointerEvent): { x: number; y: number } => { const b = el.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
      el.addEventListener('pointerdown', e => {
        if (e.pointerType === 'touch' || e.pointerType === 'pen') hooks.onTouchSeen();
        if (!hooks.active() || e.pointerType === 'mouse') return;
        const p = at(e), hit = hitTest(current(), p.x, p.y); if (!hit) return;
        e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
        press(hit.id, e.pointerId, p.x, p.y, e.pressure, e.timeStamp);
      });
      el.addEventListener('pointermove', e => {
        const id = pointers.get(e.pointerId); if (!id) return; const r = rectOf(id); if (!r) return; const p = at(e);
        if (r.kind === 'slider') { const v = sliderValue(r, p.x); if (v !== steer) { steer = v; queue.push({ t: e.timeStamp, kind: 'analog', control: 'steerTouch', source: 't:' + e.pointerId, value: v }); } }
        else if (r.kind === 'pedal') { const v = pedalValue(r, p.y, e.pressure, hooks.analog()); if (Math.abs(v - pedal) > 0.02) { pedal = v; queue.push({ t: e.timeStamp, kind: 'analog', control: 'gasTouch', source: 't:' + e.pointerId, value: v }); } }
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) el.addEventListener(type, e => release(e.pointerId, e.timeStamp));
    },
    /** let go of everything (leaving the race, window blur) */
    releaseAll(t: number): void { for (const id of [...pointers.keys()]) release(id, t); },
    isDown(id: string): boolean { return (pressedIds.get(id) ?? 0) > 0; },
    pedal: (): number => (pressedIds.has('gas') ? pedal : 0),
    steerValue: (): number => (pressedIds.has('steer') ? steer : 0),
    /** draws the controls in the neon style; `keyLabel` can show the bound key for a control (kept short) */
    draw(ctx: CanvasRenderingContext2D, alpha = 1): void {
      ctx.save(); ctx.globalAlpha = 0.85 * alpha; ctx.font = `bold ${Math.round(Math.max(10, current()[1]!.w * 0.14))}px 'DejaVu Sans Mono', monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const r of current()) {
        const down = pressedIds.has(r.id), col = r.id === 'gas' ? '#34ff7a' : r.id === 'brake' ? '#ff3355' : r.id === 'nitro' ? '#ffe14d' : r.id === 'launch' ? '#ff2bd6' : '#21e6ff';
        ctx.fillStyle = down ? 'rgba(33,230,255,.28)' : 'rgba(8,3,22,.55)'; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.shadowColor = col; ctx.shadowBlur = down ? 14 : 6;
        ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(r.w, r.h) * 0.22); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
        if (r.kind === 'pedal' && down) { const fh = r.h * pedal; ctx.fillStyle = 'rgba(52,255,122,.35)'; ctx.fillRect(r.x + 2, r.y + r.h - fh, r.w - 4, fh); }
        if (r.kind === 'slider') { const cx = r.x + r.w / 2, kx = cx + (pressedIds.has('steer') ? steer : 0) * r.w / 2; ctx.strokeStyle = 'rgba(189,247,255,.5)'; ctx.beginPath(); ctx.moveTo(cx, r.y + 6); ctx.lineTo(cx, r.y + r.h - 6); ctx.stroke(); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(kx, r.y + r.h / 2, r.h * 0.22, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = col; ctx.fillText(r.label, r.x + r.w / 2, r.y + r.h * (r.kind === 'slider' ? 0.2 : 0.5));
      }
      ctx.restore();
    },
  };
}
export type TouchControls = ReturnType<typeof createTouchControls>;
