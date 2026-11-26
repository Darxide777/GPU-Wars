// The music, played through the page's audio. The only song in GPU Wars is "Simulation Theory" by Chromium Halo (the owner's band), and it plays only during the benchmark.
// Races have no music.

/** the one song: its file in assets/music, its id in assets/music/analysis.json (the beat data the benchmark's effects follow), its title and its band */
export const SONG = { file: 'simulation-theory.ogg', id: 'simulation-theory', title: 'Simulation Theory', artist: 'Chromium Halo' } as const;

/** `vol.music` is shared with the options: change it and call `volumesChanged()` */
export function createMusic(vol: { music: number }) {
  let song: HTMLAudioElement | null = null;
  function play(): void {
    if (vol.music <= 0) return;
    try {
      if (song) song.pause();
      song = new Audio('assets/music/' + encodeURIComponent(SONG.file));      // (a relative path: itch.io serves the game from a folder)
      song.volume = vol.music; song.play().catch(() => { /* no sound until the page is clicked */ });
    } catch (e) { /* no audio available */ }
  }
  return {
    /** starts the song from the beginning if it is not playing */
    startMusic(): void { if (!song || song.paused) play(); },
    stopMusic(): void { if (song) { song.pause(); song = null; } },
    /** the song and how far into it, or null (not playing, or paused) */
    nowPlaying(): { name: string; time: number; title: string; artist: string } | null {
      if (!song || song.paused) return null;
      return { name: SONG.id, time: song.currentTime, title: SONG.title, artist: SONG.artist };
    },
    /** `vol.music` changed */
    volumesChanged(): void { if (song) { song.volume = vol.music; if (vol.music <= 0) song.pause(); else if (song.paused) song.play().catch(() => { /* ignore */ }); } },
  };
}
