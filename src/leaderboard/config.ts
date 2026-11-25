// The leaderboard's settings. The base URL is the ONLY place the game learns where the server is.
// It is a placeholder (empty): with no URL the game is fully playable offline and says "LEADERBOARD NOT CONNECTED".
// After deploying the Worker (backend/README.md) put its https://...workers.dev address here. It is public information, never a secret.
// The game makes no request at load: the leaderboard is only contacted when you open a board or finish a ranked run.
export const LEADERBOARD_API = {
  baseUrl: '',
  /** give up on a request after this many milliseconds, so a dead network never freezes a screen */
  timeoutMs: 6000,
  /** how many rows a board asks for (the server allows up to 100) */
  boardRows: 15,
} as const;

/** the keys this feature keeps in the browser store (apart from the save, so erasing a save keeps your name and id) */
export const LEADERBOARD_STORE_KEY = 'gpuwars.leaderboard';
