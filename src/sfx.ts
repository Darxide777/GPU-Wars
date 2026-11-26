// The sound effects, played with <audio> elements (like the benchmark song): the engine (an idle loop and a throttle loop that crossfade) and the Christmas tree's beeps.
// Browsers keep audio locked until the first key or touch, so nothing starts until `unlock()` is called from a gesture. Plain <audio> elements, like the song.
// The files are in assets/sfx. The two engine loops have their seam crossfaded into the file, so a loop never clicks.

/** the files, relative to index.html (itch.io serves the game from a folder). `tree` is one beep per light: three ambers, then the green. */
export const SFX_FILES = { idle: 'assets/sfx/idle.ogg', throttle: 'assets/sfx/throttle.ogg', tree: ['assets/sfx/tree-1.ogg', 'assets/sfx/tree-2.ogg', 'assets/sfx/tree-3.ogg', 'assets/sfx/tree-4.ogg'] } as const;

/** how fast the engine sound follows the pedal (seconds): the crossfade between the idle and throttle loops */
export const ENGINE_FADE = 0.12;

/** how loud the idle and throttle loops are for a pedal position (the throttle sound is allowed in the burnout and after the green; the rest of the staging is idle only): an equal-power crossfade, the idle on its way out as the throttle comes in. `racing` false is silence. */
export function engineMix(throttle: number, racing: boolean, throttleAllowed = true): { idle: number; throttle: number } {
  if (!racing) return { idle: 0, throttle: 0 };
  if (!throttleAllowed) return { idle: 1, throttle: 0 };      // staging after the burnout (run-out, back up, stage): only the idle sound, whatever the gas does
  const pedal = Number.isFinite(throttle) ? Math.max(0, Math.min(1, throttle)) : 0;
  return { idle: Math.cos(pedal * Math.PI / 2), throttle: Math.sin(pedal * Math.PI / 2) };
}
/** which tree file a light uses: ambers are 1, 2, 3 and the green is 4 (a longer beep) */
export const treeFileFor = (light: 'amber' | 'green', n = 1): number => (light === 'green' ? 3 : Math.max(0, Math.min(2, Math.round(n) - 1)));

/** `vol.sfx` is shared with the options: change it and call `volumesChanged()`. 0 is mute.
 *  These are plain <audio> elements, the same way the benchmark's song plays (that is known to work on itch.io in every browser;
 *  a Web Audio context stayed locked for some players and the effects were silent). */
export function createSfx(vol: { sfx: number }) {
  let engineIdle: HTMLAudioElement | null = null, engineThrottle: HTMLAudioElement | null = null, beeps: HTMLAudioElement[] = [], started = false;
  let wantedThrottle = 0, wantedRacing = false, shownIdle = 0, shownThrottle = 0, lastFrame = 0;
  const loopOf = (file: string): HTMLAudioElement => { const a = new Audio(file); a.loop = true; a.preload = 'auto'; a.volume = 0; return a; };
  const play = (a: HTMLAudioElement): void => { a.play().catch(() => { /* locked until the next key or tap: unlock() tries again then */ }); };
  const level = (x: number): number => Math.max(0, Math.min(1, x * vol.sfx));
  return {
    /** call from every key press or touch (safe to repeat): makes the elements once, and keeps trying to start the loops until the browser lets them play */
    unlock(): void {
      try {
        if (!started) {
          started = true;
          engineIdle = loopOf(SFX_FILES.idle); engineThrottle = loopOf(SFX_FILES.throttle);
          beeps = SFX_FILES.tree.map(file => { const a = new Audio(file); a.preload = 'auto'; return a; });
        }
        for (const a of [engineIdle, engineThrottle]) if (a && a.paused) play(a);      // (silent at volume 0 until a race is on screen)
      } catch (e) { console.warn('[GPU Wars] sound effects unavailable', e); }
    },
    /** every frame: the pedal (0 to 1) and whether a race is on screen; the engine crossfades between idle (off the gas) and throttle (on it) */
    engine(throttle: number, racing: boolean, throttleAllowed: boolean): void {
      wantedThrottle = throttle; wantedRacing = racing;
      if (!engineIdle || !engineThrottle) return;
      const now = performance.now(), dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000)); lastFrame = now;
      const mix = engineMix(wantedThrottle, wantedRacing, throttleAllowed), follow = 1 - Math.exp(-dt / (ENGINE_FADE / 3));
      shownIdle += (mix.idle - shownIdle) * follow; shownThrottle += (mix.throttle - shownThrottle) * follow;
      engineIdle.volume = level(shownIdle); engineThrottle.volume = level(shownThrottle);
      if (racing) for (const a of [engineIdle, engineThrottle]) if (a.paused) play(a);
    },
    /** one beep for a tree light: `n` is the amber's number (1 to 3), or the green */
    treeLight(light: 'amber' | 'green', n = 1): void {
      try { const a = beeps[treeFileFor(light, n)]; if (!a) return; a.currentTime = 0; a.volume = level(1); play(a); } catch (e) { /* ignore */ }
    },
    /** `vol.sfx` changed */
    volumesChanged(): void { if (engineIdle && engineThrottle) { engineIdle.volume = level(shownIdle); engineThrottle.volume = level(shownThrottle); } },
  };
}
