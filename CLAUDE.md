# Working on GPU Wars

GPU Wars is a standalone top-down drag-racing simulator and GPU benchmark, extracted from the drag mode of Chromium Halo: Neon. The structure, file layout and extension points are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); read the section for the area you change, and update it in the same commit. `README` and `Roadmap` hold the owner's plan.

## Commands

```bash
npm run build       # bundles src/drag/page.ts into dist/gpuwars.js
npm run typecheck   # strict TypeScript
npm run package     # dist/gpuwars-itch.zip for itch.io (docs/ITCH.md)
npm test            # builds, then runs every test
node --test tests/<file>.test.mjs
```

## Rules of the repo

- **Top-down only.** No 3D camera, no city hub, no shop, parts, points or currency, no rivals, no other game modes. The only thing a player changes on the car is its tune. The car's parts are the top level of every part (`STOCK_PARTS`).
- **Two classes, one list.** The classes are `integrated` and `discrete`, and only `backend/src/classes.ts` lists them (the game and the server both import it; never copy it). The class is detected, never picked. To add a class see "Adding a class" in `docs/ARCHITECTURE.md`; a changed database needs a new migration in `backend/migrations/`.
- **Plain-English names and comments.** A new reader should follow the code. Name things for what they are (`clutchCondition`, not `cc`); explain the why in a short comment on its own line. **Never put a `//` comment in the middle of a line before code**: many lines hold several statements and it swallows the rest of the line.
- **A deterministic simulation.** Everything in `src/drag/physics.ts` (and what it calls) takes its randomness from the seeded `createRng`, never `Math.random`. The same seed must give the same race. The page may use `Math.random` only to pick a seed or a song.
- **Rebindable controls.** Every gameplay key is an action in `DEFAULT_BINDS` (`src/options/model.ts`), read in the page through `held(id)` / `isBound(id, k)`. Never test a literal key in gameplay code (menus keep Esc, Enter, Tab). All driving input goes through `src/input/` (one `DriverInput`); the autopilot returns the same shape. A key does one thing: a new action needs a default no other action has. There is no clutch key: the clutch is automatic.
- **Numbers in named constants** (`DRAG`, `BOOST`, `CLUTCH`, `TRACTION`, ...). When you hand something over, say which constant to turn first.
- **Storage must never throw.** All reads and writes go through `src/browser-store.ts` (itch.io iframes can block localStorage). The save is versioned and repaired on load.
- **itch.io:** one `index.html`, relative paths, no external requests at load, works in an iframe, resizes with the window.
- **Music:** only the two versions of "Simulation Theory" by Chromium Halo (the owner's band) are in `assets/music`. Do not add other songs.
- Test inputs must be complete: `setInput({ throttle, ... })` with a missing field becomes `NaN` in the physics; spread a full idle input.
- Update `docs/ARCHITECTURE.md` in the same commit as the code it describes.

## Workflow

- Work on a feature branch (`feature/<name>`) and open a pull request against `main`. **Never push to `main`.**
- Run `npm run build`, `npm run typecheck` and `npm test` before you push; all three must pass.
- Commit messages and pull request descriptions end with the attribution lines the session gives you.
- **No secrets.** The repo is public: never commit tokens, API keys, `.env` files, credentials or database ids. The leaderboard's Cloudflare secrets live in the platform's secret store, not in the repo.
- After a change, say what you did, what the tests showed, and what you have NOT seen on screen (most gameplay feel is only judged by the owner in a browser).
