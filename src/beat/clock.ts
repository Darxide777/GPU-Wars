// The beat clock: from a song's analysis (tools/analyze-music.mjs) and where the song is now, how strong the beat pulse is, where in the beat we are, how intense the song is
// and how much bass, mid and high there is. Pure: the same inputs always give the same answer, and with no music everything is zero, so effects built on it do nothing.

export interface TrackAnalysis {
  bpm: number; duration: number;
  /** the beat times, in seconds, in order */
  beats: number[];
  /** how intense the song is each second, 0 to 100 */
  intensity: number[];
  /** bass, mid and high energy `rate` times a second, 0 to 99 */
  bands: { rate: number; bass: number[]; mid: number[]; high: number[] };
}
export interface Analysis { version: number; tracks: Record<string, TrackAnalysis> }

export interface BeatState {
  /** 1 on the beat, easing to 0 before the next one; and the same for twice a beat and every other beat */
  pulse: number; pulse2: number; pulseHalf: number;
  /** how far from one beat to the next, 0 to 1 */
  phase: number;
  /** which beat this is (0 for the first beat of the song) */
  index: number;
  /** how intense the song is right now, 0 to 1 */
  intensity: number;
  /** bass, mid and high energy right now, 0 to 1 */
  bass: number; mid: number; high: number;
  /** false when there is no music, or no analysis for it */
  on: boolean;
}
export const NO_BEAT: BeatState = { pulse: 0, pulse2: 0, pulseHalf: 0, phase: 1, index: 0, intensity: 0, bass: 0, mid: 0, high: 0, on: false };

/** a hit: 1 at the start of the beat and a fast fall to 0 (cubic), like a drum */
const hit = (phase: number): number => { const k = 1 - Math.min(1, Math.max(0, phase)); return k * k * k; };

/** the index of the last beat at or before t (-1 if t is before the first), by binary search */
export function beatBefore(beats: readonly number[], t: number): number {
  let lo = 0, hi = beats.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if ((beats[m] as number) <= t) lo = m + 1; else hi = m; }
  return lo - 1;
}

/** a value from an evenly spaced list at time t seconds, blended between the two nearest entries; `scale` turns the stored numbers into 0 to 1 */
function sample(list: readonly number[], rate: number, t: number, scale: number): number {
  if (!list.length) return 0;
  const f = Math.max(0, t * rate), i = Math.floor(f), a = list[Math.min(i, list.length - 1)] as number, b = list[Math.min(i + 1, list.length - 1)] as number;
  return (a + (b - a) * (f - i)) / scale;
}

/** the beat state at `time` seconds into the song; `track` is undefined when there is no analysis (the result is NO_BEAT) */
export function beatAt(track: TrackAnalysis | undefined, time: number): BeatState {
  if (!track || !Number.isFinite(time) || track.beats.length < 4) return NO_BEAT;
  const t = Math.max(0, time), i = beatBefore(track.beats, t), last = track.beats.length - 1;
  const state: BeatState = { ...NO_BEAT, on: true };
  state.intensity = Math.min(1, Math.max(0, sample(track.intensity, 1, t, 100)));
  const b = track.bands;
  state.bass = sample(b.bass, b.rate, t, 99); state.mid = sample(b.mid, b.rate, t, 99); state.high = sample(b.high, b.rate, t, 99);
  if (i < 0 || i >= last) return state;       // before the first beat or after the last: no pulse
  const t0 = track.beats[i] as number, t1 = track.beats[i + 1] as number;
  const phase = Math.min(1, (t - t0) / Math.max(0.2, t1 - t0));
  state.phase = phase; state.index = i;
  state.pulse = hit(phase); state.pulse2 = hit((phase * 2) % 1); state.pulseHalf = hit(((i & 1) + phase) / 2);
  return state;
}

/** a made-up steady beat for trying the effects without music: 120 bpm, with a slow swell */
export function demoBeat(seconds: number): BeatState {
  const phase = (seconds * 2) % 1, swell = 0.5 + 0.5 * Math.sin(seconds * 0.4);
  return { pulse: hit(phase), pulse2: hit((phase * 2) % 1), pulseHalf: hit((((Math.floor(seconds * 2)) & 1) + phase) / 2), phase, index: Math.floor(seconds * 2), intensity: swell, bass: hit(phase) * 0.8, mid: swell * 0.6, high: 0.4 + 0.4 * Math.sin(seconds * 7), on: true };
}
