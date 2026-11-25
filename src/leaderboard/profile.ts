// What the leaderboard remembers about this browser: a random client id (sent as X-Client-Id so the server can rate limit fairly), the player name, and ONE run
// that could not be sent yet (offline), so it can be sent the next time. Everything goes through the never-throwing store.
import type { Store } from '../browser-store.ts';
import { LEADERBOARD_STORE_KEY } from './config.ts';
import type { ScorePayload } from './payload.ts';

export interface Profile { clientId: string; playerName: string; pending: ScorePayload | null }

/** the name rules of the server (backend validate.ts sanitizeName): letters, digits, space, _ - . and 3 to 16 characters */
export function cleanPlayerName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.normalize('NFKC').replace(/[^\p{L}\p{N} _\-.]/gu, '').replace(/\s+/g, ' ').trim();
  return cleaned.length >= 3 && cleaned.length <= 16 ? cleaned : null;
}
/** a new random id: crypto when the browser has it, otherwise the time and a counter (only needs to differ between browsers, it is not a secret) */
let idCounter = 0;
export function makeClientId(): string {
  try {
    const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
    return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    idCounter++;
    return `t${Date.now().toString(16)}c${idCounter.toString(16)}`.slice(0, 32);
  }
}
const defaultName = (id: string): string => `PLAYER ${id.replace(/[^0-9a-f]/gi, '').slice(0, 4).toUpperCase() || '0000'}`;

export function loadIdentity(store: Store): Profile {
  let raw: Record<string, unknown> = {};
  try { const parsed = JSON.parse(store.get(LEADERBOARD_STORE_KEY) || 'null'); if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>; } catch (e) { /* damaged: start fresh */ }
  const clientId = typeof raw.clientId === 'string' && /^[\w-]{8,64}$/.test(raw.clientId) ? raw.clientId : makeClientId();
  const playerName = cleanPlayerName(raw.playerName) ?? defaultName(clientId);
  const pending = raw.pending && typeof raw.pending === 'object' && !Array.isArray(raw.pending) ? (raw.pending as ScorePayload) : null;
  return { clientId, playerName, pending };
}
export function saveIdentity(store: Store, profile: Profile): void {
  try { store.set?.(LEADERBOARD_STORE_KEY, JSON.stringify(profile)); } catch (e) { /* cannot be kept: the game goes on */ }
}
