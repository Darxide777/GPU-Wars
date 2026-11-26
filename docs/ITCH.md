# Publishing GPU Wars on itch.io

GPU Wars is an HTML5 game. The rules are at <https://itch.io/docs/creators/html5>; this page says how the repo meets them and how to upload.

## Make the zip

```bash
npm ci
npm run package        # builds, checks, and writes dist/gpuwars-itch.zip
```

`dist/` is not committed, so neither is the zip. The command refuses to write the zip when a check fails (an external URL or absolute path in `index.html`, a file that is missing, a sourcemap in the zip, too many files or too long a path). `npm test` runs the same checks (`tests/package.test.mjs`).

The zip holds exactly: `index.html` (at the root), `dist/gpuwars.js` (the whole game, one script), and `assets/music/` (the two "Simulation Theory" songs and `library.json`). About 8 MB, almost all of it the songs.

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
| Audio after a gesture | music starts from a key press or tap on the title/race (never on page load); `onFirstGesture` retries it once |
| Mobile | pointer events, `touch-action: none` on the canvas, on-screen controls, no pinch zoom, no pull-to-refresh (`overscroll-behavior: none`) |
| Size limits (1000 files, 500 MB, 240-char paths, 200 MB a file) | 5 files, about 8 MB |

## Checking it yourself

- `npm run package`, then unzip into an empty folder and serve it from a static server (`npx http-server`, not `file://`): the game must load with no console errors and no network requests besides the zip's own files.
- Phone: open the itch.io page on a phone, tap to launch, check the touch controls (GAS pedal reads your thumb height), vibration (Android only), rotation and fullscreen.

## Exiting the game

There is no QUIT row, on purpose. On itch.io the game runs inside an iframe on the project page (or in a fullscreen overlay of it), and a web page cannot close its own tab: `window.close()` only works on windows the script itself opened, and browsers ignore it otherwise. Navigating away (`location`) is blocked in a sandboxed iframe and would only strand the player on a blank page. A QUIT button that does nothing is worse than none, and players expect to leave an itch.io game by closing the tab or going back, as with every other HTML5 game there.

What a page can do is leave fullscreen (`document.exitFullscreen()`), so the title menu shows **EXIT FULLSCREEN** while the page is fullscreen. It leaves fullscreen, stays on the title menu and says "TO QUIT, CLOSE THIS TAB". The row disappears again when the page is not fullscreen (it follows `fullscreenchange`, so it also updates when the player leaves with Esc or the itch.io button). OPTIONS > FULLSCREEN and the top-right button still toggle fullscreen both ways. Esc inside a race already returns to the menu you came from, and Esc in other menus goes back or to the title.
