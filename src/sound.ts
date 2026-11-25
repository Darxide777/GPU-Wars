// The music, played through the page's audio. GPU Wars has no sound effects: only the two versions of "Simulation Theory" by Chromium Halo, one after the other.
// (The page may use Math.random to pick which song starts: that is not part of the simulation.)
import libraryJson from '../assets/music/library.json';

/** the songs in assets/music, found by the build (build.mjs, tools/music-tags.mjs) with the title and artist from each file's tags or name */
export interface Song { file: string; id: string; title: string; artist: string }
export const SONGS: Song[] = (libraryJson as { tracks: Song[] }).tracks;

/** `vol.music` is shared with the options: change it and call `volumesChanged()` */
export function createMusic(vol: { music: number }) {
  let song: HTMLAudioElement | null = null, current = '', next = Math.floor(Math.random() * Math.max(1, SONGS.length));
  function playNext(): void {
    if (vol.music <= 0 || !SONGS.length) return;
    try {
      if (song) song.pause();
      const pick = SONGS[next % SONGS.length] as Song; next = (next + 1) % SONGS.length; current = pick.id;
      song = new Audio('assets/music/' + encodeURIComponent(pick.file));      // (a relative path: itch.io serves the game from a folder)
      song.volume = vol.music; song.addEventListener('ended', playNext); song.play().catch(() => { /* no sound until the page is clicked */ });
    } catch (e) { /* no audio available */ }
  }
  return {
    /** starts a song if none is playing */
    startMusic(): void { if (!song || song.paused) playNext(); },
    stopMusic(): void { if (song) { song.pause(); song = null; current = ''; } },
    /** which song is playing and how far into it, or null (not playing, or paused) */
    nowPlaying(): { name: string; time: number; title: string; artist: string } | null {
      if (!song || song.paused) return null;
      const s = SONGS.find(t => t.id === current);
      return { name: current, time: song.currentTime, title: s ? s.title : current, artist: s ? s.artist : '' };
    },
    /** `vol.music` changed */
    volumesChanged(): void { if (song) { song.volume = vol.music; if (vol.music <= 0) song.pause(); else if (song.paused) song.play().catch(() => { /* ignore */ }); } },
  };
}
