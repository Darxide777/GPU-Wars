// The benchmark screen: a full-window neon layer: the workload's canvas fills the window under a cheap CSS frame, grid and scanlines, with the song's title and band big in the top-left corner (pulsing with the beat), the status line, a song-progress bar and a CANCEL button (Esc does the same).
// The overlays are plain CSS drawn by the browser's compositor, so they do not change what the card is measured on (the canvas, its size and the shader are untouched).
// It starts only from the BENCHMARK row on the title menu and never by itself.
import { beatAt, demoBeat, NO_BEAT, type Analysis, type BeatState } from '../beat/clock.ts';
import { SONG } from '../sound.ts';
import analysisJson from '../../assets/music/analysis.json';
import { BENCHMARK } from './constants.ts';
import { startBenchmark, type RunHandle, type RunResult } from './runner.ts';
import type { ClassId } from '../classes.ts';

const analysis = analysisJson as unknown as Analysis;
const LATENCY = 0.04;      // seconds: the sound reaches the ear a little after the audio clock says

/** the beat to draw now: the playing song's, or a steady made-up beat when no song is playing (the benchmark must run with the sound off too) */
export function beatForScreen(playing: { name: string; time: number } | null, seconds: number): BeatState {
  if (playing) { const b = beatAt(analysis.tracks[playing.name], playing.time - LATENCY); if (b !== NO_BEAT) return b; }
  return demoBeat(seconds);
}

export interface BenchmarkScreen extends RunHandle { close(): void }

// every look of the screen lives here; `--pulse` (0 to 1, set from the song's beat) only widens the glow, never flashes
const CSS = `
#bm{position:fixed;inset:0;z-index:20;background:#05010f;overflow:hidden;font-family:inherit;color:#bdf7ff;--pulse:0}
#bm-canvas{position:absolute;inset:0}
#bm-canvas canvas{width:100%;height:100%;display:block;object-fit:cover;touch-action:none}
#bm .shade{position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(5,1,15,.82) 0,rgba(5,1,15,.25) 28%,rgba(5,1,15,.1) 60%,rgba(5,1,15,.8) 100%)}
#bm .scan{position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(180deg,rgba(0,0,0,.22) 0,rgba(0,0,0,.22) 1px,transparent 1px,transparent 3px);opacity:.6}
#bm .floor{position:absolute;left:-25%;right:-25%;bottom:0;height:34%;pointer-events:none;perspective:220px;perspective-origin:50% 0;overflow:hidden;opacity:.55;-webkit-mask-image:linear-gradient(180deg,transparent,#000 40%);mask-image:linear-gradient(180deg,transparent,#000 40%)}
#bm .floor i{position:absolute;left:0;right:0;top:0;height:200%;transform-origin:50% 0;transform:rotateX(62deg);background-image:linear-gradient(90deg,rgba(33,230,255,.85) 0,rgba(33,230,255,.85) 2px,transparent 2px),linear-gradient(180deg,rgba(255,43,214,.85) 0,rgba(255,43,214,.85) 2px,transparent 2px);background-size:64px 64px;animation:bmgrid 2.4s linear infinite}
@keyframes bmgrid{from{background-position:0 0}to{background-position:0 64px}}
#bm .frame{position:absolute;inset:8px;pointer-events:none;border:2px solid #ff2bd6;border-radius:4px;box-shadow:0 0 calc(14px + 14px*var(--pulse)) #ff2bd6,inset 0 0 calc(22px + 20px*var(--pulse)) rgba(255,43,214,.45)}
#bm .frame:before,#bm .frame:after{content:"";position:absolute;width:38px;height:38px;border:3px solid #21e6ff;box-shadow:0 0 12px #21e6ff}
#bm .frame:before{left:-5px;top:-5px;border-right:0;border-bottom:0}
#bm .frame:after{right:-5px;bottom:-5px;border-left:0;border-top:0}
#bm-song{position:absolute;top:calc(22px + env(safe-area-inset-top,0px));left:calc(24px + env(safe-area-inset-left,0px));right:24px;line-height:1.15}
#bm-title{display:block;color:#21e6ff;font-weight:bold;font-size:clamp(28px,5vw,68px);letter-spacing:.1em;text-shadow:0 0 calc(8px + 22px*var(--pulse)) #21e6ff,0 0 calc(2px + 6px*var(--pulse)) #21e6ff}
#bm-band{display:block;margin-top:6px;color:#ff2bd6;font-size:clamp(16px,2.6vw,34px);letter-spacing:.3em;text-shadow:0 0 calc(8px + 16px*var(--pulse)) #ff2bd6}
#bm-tag{display:block;margin-top:10px;color:#ff2bd6;font-size:clamp(11px,1.3vw,15px);letter-spacing:.3em;text-shadow:0 0 8px #ff2bd6;opacity:.85}
#bm-foot{position:absolute;left:calc(24px + env(safe-area-inset-left,0px));right:calc(24px + env(safe-area-inset-right,0px));bottom:calc(20px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:8px}
#bm-row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
#bm-status{color:#ffe14d;font-size:clamp(11px,1.5vw,16px);letter-spacing:.18em;text-shadow:0 0 8px rgba(255,225,77,.6)}
#bm-bar{height:5px;background:rgba(33,230,255,.18);box-shadow:0 0 8px rgba(33,230,255,.3)}
#bm-bar i{display:block;height:100%;width:0;background:#21e6ff;box-shadow:0 0 10px #21e6ff}
#bm-note{font-size:clamp(9px,1.1vw,12px);letter-spacing:.1em;color:#8a9ac0;line-height:1.5;max-width:70ch}
#bm-cancel{touch-action:manipulation;font:inherit;font-size:12px;letter-spacing:.12em;color:#21e6ff;background:rgba(5,1,15,.7);border:1px solid #21e6ff;border-radius:3px;padding:6px 12px;box-shadow:0 0 8px rgba(33,230,255,.5)}
@media (max-width:600px){#bm-song{left:20px}#bm-band{letter-spacing:.2em}#bm-note{display:none}}
@media (max-height:420px){#bm-note,#bm-tag{display:none}}
@media (prefers-reduced-motion:reduce){#bm .floor i{animation:none}}
`;

/** show the benchmark and run it; `playing` says which song is playing and where it is (null: none). Call `close()` when done with the result. */
export function openBenchmarkScreen(o: { cls: ClassId; masked?: boolean; playing: () => { name: string; time: number } | null; onFinish: (r: RunResult) => void }): BenchmarkScreen {
  const root = document.createElement('div'); root.id = 'bm';
  root.innerHTML = '<style>' + CSS + '</style><div id="bm-canvas"></div><div class="shade"></div><div class="floor"><i></i></div><div class="scan"></div><div class="frame"></div>'
    + '<div id="bm-song"><span id="bm-title">' + SONG.title.toUpperCase() + '</span><span id="bm-band">' + SONG.artist.toUpperCase() + '</span><span id="bm-tag">GPU WARS BENCHMARK</span></div>'
    + '<div id="bm-foot"><div id="bm-note">KEEP THIS PAGE IN FRONT. A SCREEN FULL OF LIGHTS AND A FEW SECONDS OF WORK, THEN THE REST OF THE SONG.<br>THE GAME CANNOT SEE AN OVERCLOCK: AFTER OVERCLOCKING OR CHANGING YOUR GPU, RUN THE BENCHMARK AGAIN YOURSELF FROM THE TITLE MENU.</div>'
    + '<div id="bm-bar"><i></i></div><div id="bm-row"><span id="bm-status">STARTING</span><button id="bm-cancel">' + BENCHMARK.hudText + '</button></div></div>';
  document.body.appendChild(root);
  const slot = root.querySelector('#bm-canvas') as HTMLElement, statusEl = root.querySelector('#bm-status') as HTMLElement, bar = root.querySelector('#bm-bar i') as HTMLElement;
  let lastText = '';
  const run = startBenchmark({
    cls: o.cls, masked: o.masked, host: slot,
    beat: seconds => { const b = beatForScreen(o.playing(), seconds); root.style.setProperty('--pulse', b.pulse.toFixed(2)); return b; },
    song: () => { const p = o.playing(); return p ? { time: p.time, duration: analysis.tracks[p.name]?.duration ?? 0 } : null; },
    onStatus: (text, progress) => { if (text !== lastText) { lastText = text; statusEl.textContent = text; } bar.style.width = `${(progress * 100).toFixed(1)}%`; },
  });
  (root.querySelector('#bm-cancel') as HTMLElement).onclick = () => run.cancel();
  void run.done.then(o.onFinish);
  return { done: run.done, cancel: run.cancel, close(): void { run.cancel(); root.remove(); } };
}
