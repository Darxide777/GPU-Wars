// The sound effects, played with Web Audio: the engine (an idle loop and a throttle loop that crossfade) and the Christmas tree's beeps.
// Browsers keep audio locked until the first key or touch, so nothing starts until `unlock()` is called from that gesture.
// The files are in assets/sfx. The two engine loops have their seam crossfaded into the file, so a loop never clicks.

/** the files, relative to index.html (itch.io serves the game from a folder). `tree` is one beep per light: three ambers, then the green. */
export const SFX_FILES = { idle: 'assets/sfx/idle.ogg', throttle: 'assets/sfx/throttle.ogg', tree: ['assets/sfx/tree-1.ogg', 'assets/sfx/tree-2.ogg', 'assets/sfx/tree-3.ogg', 'assets/sfx/tree-4.ogg'] } as const;

/** how fast the engine sound follows the pedal (seconds): the crossfade between the idle and throttle loops */
export const ENGINE_FADE = 0.12;

/** how loud the idle and throttle loops are for a pedal position: an equal-power crossfade, the idle on its way out as the throttle comes in. `racing` false is silence. */
export function engineMix(throttle: number, racing: boolean): { idle: number; throttle: number } {
  if (!racing) return { idle: 0, throttle: 0 };
  const pedal = Number.isFinite(throttle) ? Math.max(0, Math.min(1, throttle)) : 0;
  return { idle: Math.cos(pedal * Math.PI / 2), throttle: Math.sin(pedal * Math.PI / 2) };
}
/** which tree file a light uses: ambers are 1, 2, 3 and the green is 4 (a longer beep) */
export const treeFileFor = (light: 'amber' | 'green', n = 1): number => (light === 'green' ? 3 : Math.max(0, Math.min(2, Math.round(n) - 1)));

type Ctx = AudioContext;
/** `vol.sfx` is shared with the options: change it and call `volumesChanged()`. 0 is mute. */
export function createSfx(vol: { sfx: number }) {
  let ctx: Ctx | null = null, master: GainNode | null = null, idleGain: GainNode | null = null, throttleGain: GainNode | null = null, started = false;
  const buffers: Record<string, AudioBuffer> = {};
  let wantedThrottle = 0, wantedRacing = false;
  async function load(file: string): Promise<void> {
    try { const response = await fetch(file); buffers[file] = await (ctx as Ctx).decodeAudioData(await response.arrayBuffer()); } catch (e) { /* this sound is simply missing */ }
  }
  function loop(file: string, gain: GainNode): void {
    const buffer = buffers[file]; if (!buffer || !ctx) return;
    const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true; source.connect(gain); source.start();
  }
  function applyEngine(): void {
    if (!ctx || !idleGain || !throttleGain) return;
    const mix = engineMix(wantedThrottle, wantedRacing), now = ctx.currentTime;
    idleGain.gain.setTargetAtTime(mix.idle, now, ENGINE_FADE / 3); throttleGain.gain.setTargetAtTime(mix.throttle, now, ENGINE_FADE / 3);
  }
  return {
    /** call from the first key press or touch: makes the audio context, loads the files and starts the (silent) loops */
    unlock(): void {
      try {
        if (!ctx) {
          const AudioCtor = window.AudioContext ?? (window as any).webkitAudioContext; if (!AudioCtor) return;
          ctx = new AudioCtor() as Ctx; master = ctx.createGain(); master.gain.value = vol.sfx; master.connect(ctx.destination);
          idleGain = ctx.createGain(); throttleGain = ctx.createGain(); idleGain.gain.value = 0; throttleGain.gain.value = 0; idleGain.connect(master); throttleGain.connect(master);
        }
        if (ctx.state === 'suspended') void ctx.resume();
        if (started) return; started = true;
        void Promise.all([load(SFX_FILES.idle), load(SFX_FILES.throttle), ...SFX_FILES.tree.map(load)]).then(() => { loop(SFX_FILES.idle, idleGain as GainNode); loop(SFX_FILES.throttle, throttleGain as GainNode); applyEngine(); });
      } catch (e) { /* no audio available */ }
    },
    /** every frame: the pedal (0 to 1) and whether a race is on screen; the engine crossfades between idle (off the gas) and throttle (on it) */
    engine(throttle: number, racing: boolean): void { wantedThrottle = throttle; wantedRacing = racing; applyEngine(); },
    /** one beep for a tree light: `n` is the amber's number (1 to 3), or the green */
    treeLight(light: 'amber' | 'green', n = 1): void {
      try {
        const buffer = buffers[SFX_FILES.tree[treeFileFor(light, n)] as string]; if (!ctx || !master || !buffer) return;
        const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(master); source.start();
      } catch (e) { /* ignore */ }
    },
    /** `vol.sfx` changed */
    volumesChanged(): void { if (master && ctx) master.gain.setTargetAtTime(vol.sfx, ctx.currentTime, 0.02); },
  };
}
