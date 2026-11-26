// The GPU workload: a neon Julia-set shader with the song's beat pulsing it, in the game's colours, drawn at a fixed size so every card does the same work.
// Three ways to draw, tried in this order so the benchmark runs on anything that can run the game: WebGL2, WebGL1, then the 2D canvas.
// A `Workload` does a measured amount of work and waits for the card to finish it (`run(draws)` returns when the work is done), which is how the passes are timed.
import { BENCHMARK, type BackendId } from './constants.ts';
import type { BeatState } from '../beat/clock.ts';

/** what the workload draws each time: the seconds into the run and the song's beat (src/beat/clock.ts) */
export interface Frame { time: number; beat: BeatState }
export interface Workload {
  backend: BackendId;
  /** the canvas it draws on (put it on the page) */
  canvas: HTMLCanvasElement;
  /** draws `draws` frames of work, waits for the card to finish them, and returns how many work units were done */
  run(draws: number, frame: Frame): number;
  /** work units in one draw */
  unitsPerDraw: number;
  dispose(): void;
}

/** the game's colours (the menu and drag screens in index.html): background #05010f, magenta #ff2bd6, cyan #21e6ff, red, green and gold only for the HUD, so the workload uses these three, as red, green and blue from 0 to 1 */
export const PALETTE = { background: [5 / 255, 1 / 255, 15 / 255], magenta: [1, 43 / 255, 214 / 255], cyan: [33 / 255, 230 / 255, 1] } as const;
const vec3 = (c: readonly number[]): string => `vec3(${c.map(v => v.toFixed(4)).join(', ')})`;

const VERTEX = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
// ESSL 1.00 so one source runs on WebGL1 and WebGL2. The loop is a fixed count with no early exit, so every pixel costs the same on every card.
const fragment = (iterations: number): string => `precision highp float;
uniform vec2 uRes; uniform float uTime, uPulse, uBass, uMid, uHigh;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes; vec2 p = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;
  vec2 z = p * (1.15 + 0.25 * uBass); vec2 c = vec2(-0.74 + 0.05 * sin(uTime * 0.3) + 0.03 * uPulse, 0.16 + 0.05 * cos(uTime * 0.23) + 0.04 * uMid);
  float acc = 0.0;
  for (int i = 0; i < ${iterations}; i++) { z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c; z = z / max(1.0, dot(z, z) * 0.25); acc += exp(-dot(z, z)); }
  float glow = acc / ${iterations}.0;
  vec3 col = ${vec3(PALETTE.background)} + glow * ${vec3(PALETTE.magenta)} * (0.85 + 0.35 * uPulse) + glow * glow * ${vec3(PALETTE.cyan)} * (0.55 + 0.3 * uHigh);
  gl_FragColor = vec4(col, 1.0);
}`;

function createGl(canvas: HTMLCanvasElement, kind: 'webgl2' | 'webgl1'): Workload | null {
  const gl = (kind === 'webgl2' ? canvas.getContext('webgl2', { antialias: false, alpha: false }) : canvas.getContext('webgl', { antialias: false, alpha: false })) as WebGLRenderingContext | null;
  if (!gl) return null;
  const compile = (type: number, src: string): WebGLShader | null => { const s = gl.createShader(type); if (!s) return null; gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
  const vs = compile(gl.VERTEX_SHADER, VERTEX), fs = compile(gl.FRAGMENT_SHADER, fragment(BENCHMARK.shaderIterations)), program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  const u = (n: string): WebGLUniformLocation | null => gl.getUniformLocation(program, n);
  const loc = { res: u('uRes'), time: u('uTime'), pulse: u('uPulse'), bass: u('uBass'), mid: u('uMid'), high: u('uHigh') };
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(loc.res, canvas.width, canvas.height);
  const sink = new Uint8Array(4), unitsPerDraw = canvas.width * canvas.height * BENCHMARK.shaderIterations;
  return {
    backend: kind, canvas, unitsPerDraw,
    run(draws, f) {
      gl.uniform1f(loc.time, f.time); gl.uniform1f(loc.pulse, f.beat.pulse); gl.uniform1f(loc.bass, f.beat.bass); gl.uniform1f(loc.mid, f.beat.mid); gl.uniform1f(loc.high, f.beat.high);
      for (let i = 0; i < draws; i++) gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // reading one pixel back makes the browser wait until the card has finished every draw before it
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sink);
      return draws * unitsPerDraw;
    },
    dispose() { try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch (e) { /* already gone */ } },
  };
}

/** the last resort: layers of gradients on a 2D canvas. Slower and not a graphics card test (the score is limited, see BENCHMARK.canvas2dScoreShare), but it runs anywhere. */
function createCanvas2d(canvas: HTMLCanvasElement): Workload | null {
  const g = canvas.getContext('2d', { willReadFrequently: false });
  if (!g) return null;
  const layers = 24, unitsPerDraw = canvas.width * canvas.height * layers;
  return {
    backend: 'canvas2d', canvas, unitsPerDraw,
    run(draws, f) {
      const w = canvas.width, h = canvas.height;
      for (let d = 0; d < draws; d++) {
        for (let i = 0; i < layers; i++) {
          const k = i / layers, grad = g.createRadialGradient(w * (0.5 + 0.3 * Math.sin(f.time * 0.5 + i)), h * (0.5 + 0.3 * Math.cos(f.time * 0.4 + i)), 0, w / 2, h / 2, Math.max(w, h) * (0.4 + 0.4 * f.beat.pulse * k));
          grad.addColorStop(0, `rgba(${PALETTE.magenta.map(v => Math.round(v * 255)).join(',')},${0.25 + 0.15 * f.beat.pulse})`); grad.addColorStop(1, `rgba(${PALETTE.cyan.map(v => Math.round(v * 255)).join(',')},0)`); g.fillStyle = grad; g.fillRect(0, 0, w, h);
        }
      }
      g.getImageData(0, 0, 1, 1);      // (reading a pixel back waits for the drawing to finish)
      return draws * unitsPerDraw;
    },
    dispose() { /* nothing to free */ },
  };
}

/** the best workload this browser can run, or null when it can draw nothing at all (a canvas that cannot even give a 2D context) */
export function createWorkload(): Workload | null {
  const make = (): HTMLCanvasElement => { const c = document.createElement('canvas'); c.width = BENCHMARK.width; c.height = BENCHMARK.height; return c; };
  // (a canvas can only ever give one kind of context, so each way gets a new canvas)
  for (const kind of ['webgl2', 'webgl1'] as const) { try { const w = createGl(make(), kind); if (w) return w; } catch (e) { /* try the next way */ } }
  try { return createCanvas2d(make()); } catch (e) { return null; }
}
