// The class leader as the game uses it: a name, the ET and splits, the trap speed, a reaction time and a seed. It comes from the server (GET /leader) or, when there is
// no server or no leader yet, from the bundled fallback list below, so the ghost works from the first run. All the numbers are plain data: nothing here runs physics.
import { CLASS_BOUNDS, CLASS_IDS, eraOf, isCategory, isClassId, type Category, type ClassId } from './classes.ts';

export interface LeaderSplits { ft60?: number; ft330?: number; eighth?: number; ft1000?: number; quarter: number }
export interface LeaderRecord {
  name: string; class: ClassId; category: Category;
  /** seconds from green to the launch */ reactionTime: number;
  /** elapsed seconds from the launch; every mark except `quarter` may be missing (the ghost makes it up) */ splits: LeaderSplits;
  /** miles per hour */ trapSpeed: number;
  seed: number;
  /** where it came from: the server's board or the bundled list */ source: 'server' | 'fallback';
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** a leader record from the server's JSON (GET /leader), or null when it is missing something the ghost needs. A bad split is dropped, not trusted. */
export function parseLeader(raw: unknown): LeaderRecord | null {
  if (!isObj(raw) || !isClassId(raw.class) || !isCategory(raw.category) || !isObj(raw.splits)) return null;
  const sp = raw.splits, quarter = sp.quarter ?? raw.quarterEt;
  if (!isNum(quarter) || quarter <= 0 || quarter > 60) return null;
  const mark = (v: unknown): number | undefined => (isNum(v) && v > 0 && v < quarter ? v : undefined);
  const name = typeof raw.playerName === 'string' ? raw.playerName.replace(/[^\x20-\x7e]/g, '').slice(0, 16) : '';
  return {
    name: name || 'LEADER', class: raw.class, category: raw.category,
    reactionTime: isNum(raw.reactionTime) ? Math.max(0, Math.min(0.5, raw.reactionTime)) : 0.07,
    splits: { ft60: mark(sp.ft60), ft330: mark(sp.ft330), eighth: mark(sp.eighth), ft1000: mark(sp.ft1000), quarter },
    trapSpeed: isNum(raw.trapSpeed) ? raw.trapSpeed : 0, seed: isNum(raw.seed) && Number.isInteger(raw.seed) && raw.seed >= 0 && raw.seed <= 0xffffffff ? raw.seed : 1, source: 'server',
  };
}

/** The bundled leader times. They are PLAUSIBLE PLACEHOLDERS (not real players): turn these first when real numbers exist.
 * `eraEt` is the quarter-mile time of the fastest car of that generation; a vendor adds or takes a little; autopilot runs are a little slower than hand-driven ones. */
export const FALLBACK_LEADERS = {
  eraEt: { integrated: 9.4, retro: 8.6, classic: 7.9, modern: 7.0, current: 5.9 } as Record<string, number>,
  vendorEt: { amd: -0.05, nvidia: -0.15, intel: 0.2, other: 0.35 } as Record<string, number>,
  autopilotExtraEt: 0.18,
  /** trap speed in mph is about this many mph-seconds divided by the ET (a faster car also crosses the line faster) */ trapMphSeconds: 1130,
  reaction: 0.064,
} as const;

/** a small stable number from a text (for the fallback seeds): FNV-1a */
export function textSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
/** the fallback leader of a class and category: only the ET, trap speed, reaction and seed are known, so the ghost generates every split */
export function fallbackLeader(cls: ClassId, category: Category = 'manual'): LeaderRecord {
  const f = FALLBACK_LEADERS, vendor = cls === 'integrated' ? '' : cls.split('-')[1] as string, bounds = CLASS_BOUNDS[cls];
  const base = (f.eraEt[eraOf(cls)] ?? 8) + (f.vendorEt[vendor] ?? 0) + (category === 'autopilot' ? f.autopilotExtraEt : 0);
  const quarter = Math.round(Math.max(bounds.minQuarterEt + 0.4, base) * 1000) / 1000;
  const trap = Math.round(Math.max(bounds.minTrapSpeed + 10, Math.min(bounds.maxTrapSpeed - 5, f.trapMphSeconds / quarter)) * 10) / 10;
  return { name: category === 'autopilot' ? 'AUTO LEADER' : 'CLASS LEADER', class: cls, category, reactionTime: f.reaction, splits: { quarter }, trapSpeed: trap, seed: textSeed(`${cls}|${category}`), source: 'fallback' };
}
/** every fallback leader, as a list (for tests and for an offline records screen) */
export const allFallbackLeaders = (): LeaderRecord[] => CLASS_IDS.flatMap(c => (['manual', 'autopilot'] as const).map(cat => fallbackLeader(c, cat)));
