# GPU Wars: architecture

GPU Wars is a standalone drag-racing simulator and GPU benchmark. It was extracted from the drag mode of Chromium Halo: Neon and keeps only what the drag game needs.

What it is **not**: there is **no city hub, no shop, no parts, no points or currency, no rivals, no 3D camera and no other game mode**. The only view is the **top-down strip** (`src/drag/topdown.ts`). The only thing you change on the car is its **tune** (the existing tune screen and six tune slots). The car's parts are fixed at the TOP level of every part (the "stock parts"), and its power comes from the benchmark score.

## Commands

```bash
npm run build       # node build.mjs: bundles src/drag/page.ts into dist/gpuwars.js and rebuilds assets/music/library.json
npm run typecheck   # strict TypeScript (also flags unused locals)
npm test            # builds, then runs every test in tests/ (a few seconds, CPU only)
node --test tests/<file>.test.mjs   # one test file (Node runs the TypeScript directly)
```

Play it by opening `index.html` from any static server (or the itch.io zip). `dist/` is not committed.

## File layout

```
index.html                  the one page (itch.io: relative paths, no external requests, touch-action none on the canvas)
build.mjs                   esbuild: src/drag/page.ts -> dist/gpuwars.js (one iife script, works in an iframe)
tools/music-tags.mjs        reads the song titles and artists for assets/music/library.json
assets/music/               the two versions of "Simulation Theory" by Chromium Halo (and the generated library.json)
types/globals.d.ts          the debug hook the page leaves on window (window.__drag)
src/classes.ts              the class ids (COPY of backend/src/classes.ts: keep them identical) and their labels
src/benchmark/              constants.ts (BENCHMARK tunables), workload.ts (WebGL2 / WebGL1 / 2D canvas), runner.ts (warm-up, passes), score.ts (discard throttled passes, plausibility, caps),
                            gpu.ts (what the card is, and the class only when the text says it plainly), rules.ts (re-run and class-lock rules), menu.ts (BENCHMARK and CLASS rows),
                            screen.ts (the running screen), dyno.ts (torque/hp curve and the SVG graph)
src/beat/, src/neon/building-eq.ts  the beat clock and the equalizer from Chromium Halo: Neon (building-eq without Three.js); assets/music/analysis.json is trimmed to the two songs
src/save.ts                 the ONE save: benchmark result, class lock, tune, tune slots, records, your best-pass ghost
src/browser-store.ts        localStorage that never throws, with a memory fallback (blocked itch iframes)
src/options/model.ts        settings (music volume, rebindable key binds); the OPTIONS screen is a later phase
src/sound.ts                music only, from the two songs
src/tune-slots.ts           the six named tune slots (pure functions)
src/tune-slots-menu.ts      the menu rows for them
src/gamepad.ts              the pad pressing menu keys
src/arena/rng.ts            the seeded random source the physics uses
src/arena/view/menu.ts      the neon menu logic (rows, arrow keys, enter)
src/arena/view/pad.ts       the pad's driving input
src/sim/constants.ts        the neon colours (C)
src/drag/types.ts           the data shapes: car, parts, tune, runner, timeslip, ghost
src/drag/data.ts            the dragster, PARTS (top level of each part) and STOCK_PARTS
src/drag/tune.ts            specFor (car + parts -> spec), the tune's defaults and limits, cleanTune
src/drag/spec-source.ts     WHERE THE CAR'S NUMBERS COME FROM: specForBenchmark, BENCHMARK_TO_SPEC, the class limits and the two curve shapes
src/drag/model.ts           save rules with no screen: readyCar, tune and slots, recordRace
src/drag/physics.ts         the simulation (no drawing, no clock, deterministic)
src/drag/hud.ts, topdown.ts the drawing: tachometer and gauges, the strip from above
src/drag/tune-help.ts       the short description of every tune row
src/drag/page.ts            the page: title menu, tune screen, the race, the timeslip
tests/                      drag.test.mjs (engine, model and save), drag-topdown.test.mjs, tune-slots.test.mjs, page.test.mjs (shape of the game)
```

## The screens (`src/drag/page.ts`)

One canvas draws the strip behind a neon menu card (the Chromium Halo: Neon menu style, from `drag.html`'s CSS now in `index.html`).

- **Title menu:** BENCHMARK, CLASS, TUNE, RACE CLASS LEADER, RECORDS, OPTIONS. OPTIONS is still a stub that says COMING SOON; the rest work.
- **TUNE:** the TUNING tab (shifting, launch, boost, gears, final drive, tire pressure, ballast, fuel load, suspension, wheelie bar, nitro, the six tune slots, REPLACE CLUTCH, COOL ENGINE, CLEAR STRIP, RESET TUNE, TEST RUN) and the STATS tab (the car's numbers, the dyno graph and a predicted timeslip from a perfect-driver run). Every change is saved at once and made safe for the car (`cleanTune`).
- **RACE CLASS LEADER:** the top-down race. The first race is a solo pass; a clean pass is saved as your best-pass ghost, which every later race replays beside you. This is the **stand-in** for the class leader's ghost (see below).
- **Timeslip:** the result, with RUN AGAIN, NEXT RACE, TUNE and MAIN MENU.

## The simulation (`src/drag/physics.ts`)

No drawing, no clock, no `Math.random`: `createDrag({ seed, strip, entrants })` and `step()` at `DRAG.dt` (1/240 s). The same seed gives the same race. The page picks seeds with `Math.random`; nothing inside the engine does. Weather, wind and altitude come from the seed (`conditionsForSeed`). The engine models the tree and red light, staging and deep staging, launch, torque curve, flywheel, clutch heat and wear, limiter, gears and shift quality, traction with suspension pitch, wheelspin and lane steering, blower boost and engine heat, nitro, fuel burn, the run-out with brake fade and chute, and a crash at the end of the strip. `AUTO_DRIVER` is an automatic driver used by the tune screen's prediction (`predictDrag`) and the tests; it is not offered in the menu yet.

The clutch has no key: it engages automatically. Its temperature and condition are a consumable carried between races in a visit (`clutchAfterRun`); REPLACE CLUTCH on the tune screen resets it for free.

## The benchmark, the class and the car's numbers

**BENCHMARK** (title row, never automatic) opens `src/benchmark/screen.ts`: a full-window layer with the workload's canvas, the equalizer and the pass counter (Esc or CANCEL stops it). `workload.ts` draws a fixed 1280x720 Julia-set shader with the beat and equalizer in it; it tries WebGL2, then WebGL1, then a 2D canvas (whose score is limited, `canvas2dScoreShare`). `runner.ts` does a warm-up, then `passes` timed passes, syncing with a one-pixel read-back so the card has really finished. `score.ts` throws away passes slower than the median by `throttleDrop` (or faster by `spikeRise`), refuses a run whose passes took an implausible time or that was hidden, turns the mean rate into a log-scale score (0 to `maxScore`) and caps it by class. All tunables are the one `BENCHMARK` object in `constants.ts` (`warmupMs`, `passes`, `throttleDrop`, `version`, and the `rate` ranges to calibrate on real cards). Change `version` whenever the workload or scoring changes.

**The card and the class** (`gpu.ts`, `rules.ts`, `menu.ts`): the card's id is WebGL's unmasked renderer text (WebGPU's adapter info when there is no WebGL). A class is *detected* only when that text plainly names the card (GeForce/Radeon RX with a model number, Intel UHD/Iris/Arc A-series, Apple/Adreno); anything else (masked names, "Arc Graphics", Quadro, software renderers) leaves it to the player, who picks on the CLASS row and presses ENTER to lock it to that `gpuId`. A detected class cannot be changed; a hand-picked one is locked until the `gpuId` changes. The result `{ score, class, benchmarkVersion, gpuId, date, sustain? }` is re-run only when `gpuId` or `benchmarkVersion` changes (`rerunReason`). The ids are in `src/classes.ts`, a copy of `backend/src/classes.ts`.

**The car's numbers.** `src/drag/spec-source.ts` is the one place a race or the tune screen gets the car's spec:

```ts
specForBenchmark(benchmark: BenchmarkResult | null, clutchCondition = 1): DragSpec
```

With no result it is the WEAKEST spec (integrated, score 0), so skipping the benchmark never pays. With one, `BENCHMARK_TO_SPEC` (score -> peak torque, peak rpm, limiter, blended in a straight line) sets the engine, `CLASS_SPEC_LIMITS` clamp it, and the result's `sustain` (how steady the card was across the passes; the class's usual when missing) picks the torque curve between `CURVE_BURST` (punchy low/mid revs) and `CURVE_SUSTAINED` (broad, high revs). The curve lives on the spec (`spec.curve`, used by `torqueShape`), so every engine has its own map and the shared `ENGINE.map` is only the stock dragster's. The torque range stops near 1500 Nm on purpose: past that the dragster's grip is the limit and the default tune only gains wheelspin (a test checks that a higher score is never meaningfully slower). `src/benchmark/dyno.ts` draws the same curve (hp = Nm x rpm / 7127, at the flywheel before the blower's boost) as the graph on the STATS tab, with the shift point and the power peak; the timeslip shows hp. It is a pure function of the saved result. `readyCar(save, clutchCondition)` in `model.ts` calls it and adds the tune (the default tune is built from the engine's own revs).

## The save (`src/save.ts`)

One small versioned record under the key `gpuwars.save`, repaired on load (`sanitizeSave`): `benchmark` (`{ score, class, benchmarkVersion, gpuId, date, sustain? }` or null), `classLock` (`{ class, gpuId, date }` or null: the hand-picked class), `tune`, `slots` (six), `records` (totals, bests, the last ten runs) and `ghost`. Settings are kept apart (`gpuwars.options`) so erasing a save never loses your controls. All storage goes through `src/browser-store.ts`, which never throws and falls back to memory when localStorage is blocked.

## Extension points for the next phases

- **Class leader ghost:** `ghostToRace()` in `page.ts` returns your best pass today. The leaderboard phase returns a simulated ghost of the class leader (seeded, checked with `cleanDragGhost`).
- **Full staging sequence, reverse input, touch input, autopilot as a separate leaderboard category:** the physics already has the tree, staging and deep staging; `backUp` is noted in `DEFAULT_BINDS`; `readInput()` in `page.ts` is the one place input is turned into a `DragInput`.
- **OPTIONS:** `src/options/model.ts` already holds the volume and binds, with `assignKey`.
- **Leaderboard:** a separate database (Cloudflare Workers and D1), not part of this scaffold.

## Conventions

See `CLAUDE.md`. The ones that matter most: plain-English names, a deterministic simulation (no `Math.random` in `src/drag/physics.ts` or anything it calls), numbers in named constants, and a rebindable key for every gameplay action (`DEFAULT_BINDS`).

## Known gaps

- `topdown.ts` uses `Math.random` for the look of tire smoke puffs (drawing only, not the simulation); it should move to a seeded source so replays look identical.
- `shiftDown` is a bound key but the engine has no shift-down input yet.
- Per-run tire wear that the source charged points for is gone: tires start every race new (the live per-run wear inside a race is unchanged).
