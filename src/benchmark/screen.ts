// The benchmark screen: a full-window layer over the page with the workload's canvas, the song's equalizer in it, the pass counter and a CANCEL button (Esc does the same).
// It starts only from the BENCHMARK row on the title menu and never by itself.
import { beatAt, demoBeat, NO_BEAT, type Analysis, type BeatState } from '../beat/clock.ts';
import { eqNow } from '../beat/eq.ts';
import analysisJson from '../../assets/music/analysis.json';
import { BENCHMARK } from './constants.ts';
import { startBenchmark, type RunHandle, type RunResult } from './runner.ts';
import type { ClassId } from '../classes.ts';

const analysis = analysisJson as unknown as Analysis;
const LATENCY = 0.04;      // seconds: the sound reaches the ear a little after the audio clock says

/** the beat to draw now: the playing song's, or a steady made-up beat when no song is playing (the benchmark must run with the sound off too) */
export function beatForScreen(playing: { name: string; time: number } | null, seconds: number): BeatState {
  if (playing) { const b = beatAt(analysis.tracks[playing.name], playing.time - LATENCY); if (b !== NO_BEAT) return { ...b, eq: eqNow(playing, true) }; }
  return demoBeat(seconds);
}

export interface BenchmarkScreen extends RunHandle { close(): void }
/** show the benchmark and run it; `playing` says which song is playing and where it is (null: none). Call `close()` when done with the result. */
export function openBenchmarkScreen(o: { cls: ClassId; playing: () => { name: string; time: number } | null; onFinish: (r: RunResult) => void }): BenchmarkScreen {
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;inset:0;z-index:20;background:#05010f;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:inherit;color:#bdf7ff;';
  root.innerHTML = '<div style="width:min(92vw,1100px);display:flex;flex-direction:column;gap:10px"><div style="display:flex;justify-content:space-between;align-items:baseline;letter-spacing:.2em"><b style="color:#ff2bd6;font-size:18px">BENCHMARK</b><span id="bm-status" style="color:#ffe14d">STARTING</span></div><div id="bm-canvas" style="width:100%;aspect-ratio:16/9;background:#000;border:2px solid #ff2bd6;box-shadow:0 0 24px rgba(255,43,214,.4)"></div><div style="height:8px;background:#1a0a3a"><div id="bm-bar" style="height:100%;width:0;background:#21e6ff"></div></div><div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;letter-spacing:.1em;color:#8a9ac0"><span>KEEP THIS PAGE IN FRONT. A SCREEN FULL OF LIGHTS AND A FEW SECONDS OF WORK.<br>THE GAME CANNOT SEE AN OVERCLOCK: AFTER OVERCLOCKING OR CHANGING YOUR GPU, RUN THE BENCHMARK AGAIN YOURSELF FROM THE TITLE MENU.</span><button id="bm-cancel" style="touch-action:manipulation">' + BENCHMARK.hudText + '</button></div></div>';
  document.body.appendChild(root);
  const slot = root.querySelector('#bm-canvas') as HTMLElement, statusEl = root.querySelector('#bm-status') as HTMLElement, bar = root.querySelector('#bm-bar') as HTMLElement;
  // the workload's canvas is added to `slot` by the runner and made to fill it
  const style = document.createElement('style'); style.textContent = '#bm-canvas canvas{width:100%;height:100%;display:block;touch-action:none}'; root.appendChild(style);
  const run = startBenchmark({
    cls: o.cls, host: slot, beat: seconds => beatForScreen(o.playing(), seconds),
    onStatus: (text, progress) => { statusEl.textContent = text; bar.style.width = `${Math.round(progress * 100)}%`; },
  });
  (root.querySelector('#bm-cancel') as HTMLElement).onclick = () => run.cancel();
  void run.done.then(o.onFinish);
  return { done: run.done, cancel: run.cancel, close(): void { run.cancel(); root.remove(); } };
}
