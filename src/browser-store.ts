// The save store in the browser: localStorage, never throwing. Inside some itch.io iframes (and private windows) localStorage is blocked or full; then the game keeps what it
// is given in memory for this visit, so every screen still works, it just is not remembered next time.
export interface Store { get(key: string): string | null; set?(key: string, value: string): void; remove?(key: string): void }

/** a store that only lives as long as the page (the fallback, and what the tests use) */
export function memoryStore(): Required<Store> {
  const data = new Map<string, string>();
  return { get: k => data.get(k) ?? null, set: (k, v) => { data.set(k, v); }, remove: k => { data.delete(k); } };
}
/** localStorage with a memory fallback for whatever it refuses */
export function createBrowserStore(): Required<Store> {
  const memory = memoryStore();
  return {
    get: k => { try { const v = localStorage.getItem(k); if (v !== null) return v; } catch (e) { /* storage blocked */ } return memory.get(k); },
    set: (k, v) => { memory.set(k, v); try { localStorage.setItem(k, v); } catch (e) { /* storage blocked or full: the memory copy keeps this visit going */ } },
    remove: k => { memory.remove(k); try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } },
  };
}
export const browserStore: Required<Store> = createBrowserStore();
