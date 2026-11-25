// The music's equalizer right now, for the 3D scenes that show it (the neon Arena's walls, the city's buildings): each band 0 to 1, or an empty list with no music (or the equalizer switched off in Options).
import { beatAt, type Analysis } from './clock.ts';
import analysisJson from '../../assets/music/analysis.json';

const analysis = analysisJson as unknown as Analysis;
const LATENCY = 0.04;      // seconds: the sound reaches the ear a little after the audio clock says
export function eqNow(playing: { name: string; time: number } | null, enabled: boolean): readonly number[] {
  return enabled && playing ? beatAt(analysis.tracks[playing.name], playing.time - LATENCY).eq : [];
}
