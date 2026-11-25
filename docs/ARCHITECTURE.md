# GPU Wars: architecture

GPU Wars is a standalone drag-racing simulator and GPU benchmark. It was extracted from the drag mode of Chromium Halo: Neon and keeps only what the drag game needs.

What it is **not**: there is **no city hub, no shop, no parts, no points or currency, no rivals, no 3D camera and no other game mode**. The only view is the **top-down strip** (`src/drag/topdown.ts`). The only thing you change on the car is its **tune** (the existing tune screen and six tune slots). The car's parts are fixed at the TOP level of every part (the "stock parts"), and its power will come from the benchmark score.

## Commands

```bash
npm run build       # node build.mjs: bundles src/drag/page.ts into dist/gpuwars.js and rebuilds assets/music/library.json
npm run typecheck   # strict TypeScript (also flags unused locals)
npm run package     # builds and writes dist/gpuwars-itch.zip for itch.io (see docs/ITCH.md)
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
src/save.ts                 the ONE save: benchmark result, tune, tune slots, records, your best-pass ghost
src/browser-store.ts        localStorage that never throws, with a memory fallback (blocked itch iframes)
src/options/model.ts        settings: music volume, rebindable key binds and gamepad binds (assignKeySlot, assignPadButton), touch options, input delay, driver (manual/autopilot)
src/options/screen.ts       the OPTIONS rows and the rebinding flow (no page in it, tested)
src/input/                  the input layer: queue.ts (timestamped events), controls.ts (held/edge state -> DriverInput), keyboard.ts, pad.ts, touch.ts (layout, analog pedal and steering, pointer events), haptics.ts, constants.ts (INPUT), index.ts (createInput)
src/platform.ts             fullscreen, audio unlock on first gesture, viewport change watcher
src/drag/autopilot.ts       the deterministic driver AI (createAutopilot), category 'autopilot'
tools/package.mjs, zip.mjs  npm run package: the itch.io zip (no dependencies)
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
src/drag/spec-source.ts     WHERE THE CAR'S NUMBERS COME FROM: specForBenchmark (placeholder until the benchmark exists)
src/drag/model.ts           save rules with no screen: readyCar, tune and slots, recordRace
src/drag/physics.ts         the simulation (no drawing, no clock, deterministic)
src/drag/hud.ts, topdown.ts the drawing: tachometer and gauges, the strip from above
src/drag/tune-help.ts       the short description of every tune row
src/drag/page.ts            the page: title menu, tune screen, the race, the timeslip
tests/                      drag.test.mjs (engine, model and save), drag-topdown.test.mjs, tune-slots.test.mjs, page.test.mjs (shape of the game)
```

## The screens (`src/drag/page.ts`)

One canvas draws the strip behind a neon menu card (the Chromium Halo: Neon menu style, from `drag.html`'s CSS now in `index.html`).

- **Title menu:** BENCHMARK, CLASS, TUNE, RACE CLASS LEADER, RECORDS, OPTIONS. BENCHMARK and CLASS are stubs that say COMING SOON. TUNE, RACE CLASS LEADER, DRIVER (MANUAL or AUTOPILOT, between RACE CLASS LEADER and RECORDS), RECORDS and OPTIONS work.
- **TUNE:** the TUNING tab (shifting, launch, boost, gears, final drive, tire pressure, ballast, fuel load, suspension, wheelie bar, nitro, the six tune slots, REPLACE CLUTCH, COOL ENGINE, CLEAR STRIP, RESET TUNE, TEST RUN) and the STATS tab (the car's numbers and a predicted timeslip from a perfect-driver run). Every change is saved at once and made safe for the car (`cleanTune`).
- **RACE CLASS LEADER:** the top-down race. The first race is a solo pass; a clean pass is saved as your best-pass ghost, which every later race replays beside you. This is the **stand-in** for the class leader's ghost (see below).
- **OPTIONS** (`src/options/screen.ts`): DRIVER, MUSIC VOLUME, TOUCH CONTROLS (AUTO/ON/OFF), TOUCH SIZE, ANALOG TOUCH GAS, VIBRATION, INPUT DELAY (ms), FULLSCREEN, CONTROLS FOR (keyboard or gamepad), one row per control in `BIND_ROWS` (Enter rebinds the first key or button, Right the second, Left clears the second; a key or button does one thing, so it is taken from the other control unless that would leave it with none), RESET CONTROLS. Settings are saved at once under `gpuwars.options`.
- **Timeslip:** the result, with RUN AGAIN, NEXT RACE, TUNE and MAIN MENU.

## The simulation (`src/drag/physics.ts`)

No drawing, no clock, no `Math.random`: `createDrag({ seed, strip, entrants })` and `step()` at `DRAG.dt` (1/240 s). The same seed gives the same race. The page picks seeds with `Math.random`; nothing inside the engine does. Weather, wind and altitude come from the seed (`conditionsForSeed`). The engine models the tree and red light, staging and deep staging, launch, torque curve, flywheel, clutch heat and wear, limiter, gears and shift quality, traction with suspension pitch, wheelspin and lane steering, blower boost and engine heat, nitro, fuel burn, the run-out with brake fade and chute, and a crash at the end of the strip. `AUTO_DRIVER` is an automatic driver used by the tune screen's prediction (`predictDrag`) and the tests; it is not offered in the menu yet.

The clutch has no key: it engages automatically. Its temperature and condition are a consumable carried between races in a visit (`clutchAfterRun`); REPLACE CLUTCH on the tune screen resets it for free.

## The car and the benchmark extension point

`src/drag/data.ts` has one car (the dragster, id `streeter`) and `PARTS` (each part's top level). `STOCK_PARTS` is every part at its top level. `src/drag/spec-source.ts` is the **one place** a race or the tune screen gets the car's spec from:

```ts
specForBenchmark(benchmark: BenchmarkResult | null, clutchCondition = 1): DragSpec
```

Today it returns the stock car whatever the benchmark said. The benchmark phase changes its body so the score sets the horsepower and torque (`spec.torque`). It must stay deterministic. `readyCar(save, clutchCondition)` in `model.ts` calls it and adds the tune.

## The save (`src/save.ts`)

One small versioned record under the key `gpuwars.save`, repaired on load (`sanitizeSave`): `benchmark` (`{ score, class, benchmarkVersion, gpuId, date }` or null), `tune`, `slots` (six), `records` (totals, bests, the last ten runs) and `ghost`. Settings are kept apart (`gpuwars.options`) so erasing a save never loses your controls. All storage goes through `src/browser-store.ts`, which never throws and falls back to memory when localStorage is blocked.

## Extension points for the next phases

- **Benchmark and class:** `BenchmarkResult` and `Save.benchmark` exist; `specForBenchmark` is the spec feed; the BENCHMARK and CLASS rows in `page.ts` are `comingSoon(...)` rows to replace. The benchmark will also use the beat effects, the equalizer and the songs (`src/beat/*` and `src/neon/building-eq.ts` in Chromium Halo: Neon; they were not copied because the top-down race does not use them).
- **Class leader ghost:** `ghostToRace()` in `page.ts` returns your best pass today. The leaderboard phase returns a simulated ghost of the class leader (seeded, checked with `cleanDragGhost`).
- **Full staging sequence (physics phase):** the engine already has the tree, staging and deep staging. The reverse input is `backUp` (default key R, pad X): the input layer already sends `backUp` and `shiftDown` in every DriverInput; the engine ignores them until it reads them. `autopilot.ts` takes an optional `stagePhase` in its view (`waterBoxApproach | burnout | runOut | backup | preStage | staged | deepStaged | rolling | launched`) and works out `staged/rolling/launched` itself when it is missing; see the integration notes below.
- **Input:** `readInput()` in `page.ts` is one line: `race.setInput(0, options.driver === 'autopilot' ? autopilot.decide(viewOf(race)) : input.read())`. Keys, touch pointers and pad polls are pushed as timestamped events (`src/input/queue.ts`, browser timestamps); each fixed tick drains the events due by that tick's time (plus `INPUT.eventQueueMs` and the player's `latencyOffsetMs`), applies them in order, and builds a `DriverInput` (`toDriverInput`). A press is held for at least one tick even if it is released within it, so a very short tap still launches. Touch controls are drawn on the canvas by `input.draw()` and live in `touch.ts` (`touchLayout` is a pure function). Haptics (`haptics.ts`) buzz on the player's launch, shift, nitro, wheelspin, wheelie, chute, foul, wall and crash events.
- **Autopilot:** `createAutopilot().decide(view)` returns a `DriverInput`; it reads the tree light by light (amber times), the gauges and the lane, and uses no engine internals a driver cannot see. Runs made with it have `result.category === 'autopilot'` (`window.__drag().category`); they are not written to the player's records or best-pass ghost. The leaderboard client should send `category` with the run. Integration points for the staging sequence: `AutopilotView.stagePhase` (pass the engine's phase through `viewOf(race, 0, phase)`), and the three phase branches in `decide` (`backup` sends `backUp`, `preStage` presses `launch` to roll in, `burnout` holds gas and burnout). If the new sequence needs different presses, change only those branches.

- **Leaderboard:** a separate database (Cloudflare Workers and D1), not part of this scaffold.

## Conventions

See `CLAUDE.md`. The ones that matter most: plain-English names, a deterministic simulation (no `Math.random` in `src/drag/physics.ts` or anything it calls), numbers in named constants, and a rebindable key for every gameplay action (`DEFAULT_BINDS`).

## Known gaps

- `topdown.ts` uses `Math.random` for the look of tire smoke puffs (drawing only, not the simulation); it should move to a seeded source so replays look identical.
- `shiftDown` and `backUp` are bound and sent in every input, but the engine has no shift-down or reverse input yet.
- The input delay only delays delivery of presses; it cannot move a press earlier than the frame it arrived in.
- Per-run tire wear that the source charged points for is gone: tires start every race new (the live per-run wear inside a race is unchanged).
