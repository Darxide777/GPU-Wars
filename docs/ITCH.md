# Publishing GPU Wars on itch.io

GPU Wars is an HTML5 game. The rules are at <https://itch.io/docs/creators/html5>; this page says how the repo meets them and how to upload.

## Make the zip

```bash
npm ci
npm run package        # builds, checks, and writes dist/gpuwars-itch.zip
```

`dist/` is not committed, so neither is the zip. The command refuses to write the zip when a check fails (an external URL or absolute path in `index.html`, a file that is missing, a sourcemap in the zip, too many files or too long a path). `npm test` runs the same checks (`tests/package.test.mjs`).

The zip holds exactly: `index.html` (at the root), `dist/gpuwars.js` (the whole game, one script), `assets/music/` (the two "Simulation Theory" songs and `library.json`) and `assets/sfx/` (the engine idle and throttle loops and the four Christmas tree beeps, about 120 KB of .ogg). About 8 MB, almost all of it the songs.

## Upload

1. On itch.io choose **Upload new project** (or edit the project) and set **Kind of project** to **HTML**.
2. Upload `dist/gpuwars-itch.zip` and tick **This file will be played in the browser**.
3. **Embed options:** pick **Click to launch in fullscreen** or **Embed in page**. The game fits any size (it resizes with the window, rotation and fullscreen), so both work. For Embed in page use about 1280 x 720.
4. Tick **Mobile friendly** (there are touch controls) and leave **Click to play** on (browsers keep audio locked until the first click or touch anyway).
5. Tick **Enable fullscreen button** if you embed in the page (the game also has its own button, top right, wherever the browser allows fullscreen).
6. Save, set the project to Public, and play it once from the project page on a desktop and on a phone.

To update, upload the new zip and delete the old one.

## How the itch.io rules are met

| Rule | How |
| --- | --- |
| `index.html` at the zip root | `tools/package.mjs` puts it there and checks it |
| Relative paths only, no folders as links | `dist/gpuwars.js`, `assets/music/<file>`; the checker rejects `/...` and `https://...` |
| No external requests at load | no web fonts, CDNs, analytics or APIs (the leaderboard phase adds its own request; it must be an HTTPS call made after load, and the game must run without it) |
| Works in an iframe | one iife script, no `top`/`parent` access, storage through `src/browser-store.ts` (falls back to memory when the iframe blocks localStorage) |
| Resizes to its container | the canvas follows `innerWidth/innerHeight` on resize, rotation (`orientationchange`), `visualViewport` and fullscreen changes (`src/platform.ts`) |
| Fullscreen | the button in `index.html` (hidden when the browser has no fullscreen API, for example iPhone Safari) and OPTIONS > FULLSCREEN |
| Audio after a gesture | music and sound effects start from a key press or tap (`sfx.unlock()` makes the Web Audio context then) on the title/race (never on page load); `onFirstGesture` retries it once |
| Mobile | pointer events, `touch-action: none` on the canvas, on-screen controls, no pinch zoom, no pull-to-refresh (`overscroll-behavior: none`) |
| Size limits (1000 files, 500 MB, 240-char paths, 200 MB a file) | 11 files, about 8 MB |

## Checking it yourself

- `npm run package`, then unzip into an empty folder and serve it from a static server (`npx http-server`, not `file://`): the game must load with no console errors and no network requests besides the zip's own files.
- Phone: open the itch.io page on a phone, tap to launch, check the touch controls (GAS pedal reads your thumb height), vibration (Android only), rotation and fullscreen.
