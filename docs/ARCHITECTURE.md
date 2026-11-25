# GPU Wars: architecture

GPU Wars is a standalone drag-racing simulator and GPU benchmark. It was extracted from the drag mode of Chromium Halo: Neon and keeps only what the drag game needs.

What it is **not**: there is **no city hub, no shop, no parts, no points or currency, no rivals, no 3D camera and no other game mode**. The only view is the **top-down strip** (`src/drag/topdown.ts`). The only thing you change on the car is its **tune** (the existing tune screen and six tune slots). The car's parts are fixed at the TOP level of every part (the "stock parts"), and its power comes from the benchmark score.

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
src/classes.ts              re-exports the ONE class list (backend/src/classes.ts, shared with the server) and adds the names shown on screen
src/benchmark/              constants.ts (BENCHMARK tunables), workload.ts (WebGL2 / WebGL1 / 2D canvas), runner.ts (warm-up, passes), score.ts (discard throttled passes, plausibility, caps),
                            gpu.ts (what the card is, and the class only when the text says it plainly), rules.ts (re-run and class-lock rules), menu.ts (BENCHMARK and CLASS rows),
                            screen.ts (the running screen), dyno.ts (torque/hp curve and the SVG graph)
src/beat/, src/neon/building-eq.ts  the beat clock and the equalizer from Chromium Halo: Neon (building-eq without Three.js); assets/music/analysis.json is trimmed to the two songs
src/save.ts                 the ONE save: benchmark result, class lock, tune, tune slots and records (no ghost of your own: the only ghost is the class leader's)
src/browser-store.ts        localStorage that never throws, with a memory fallback (blocked itch iframes)
src/options/model.ts        settings: music volume, rebindable key binds and gamepad binds (assignKeySlot, assignPadButton), touch options, input delay, driver (manual/autopilot)
src/options/screen.ts       the OPTIONS rows and the rebinding flow (no page in it, tested)
src/input/                  the input layer: queue.ts (timestamped events), controls.ts (held/edge state -> DriverInput), keyboard.ts, pad.ts, touch.ts (layout, analog pedal and steering, pointer events), haptics.ts, constants.ts (INPUT), index.ts (createInput)
src/platform.ts             fullscreen, audio unlock on first gesture, viewport change watcher
src/drag/autopilot.ts       the deterministic driver AI (createAutopilot), category 'autopilot'; drives the engine's own staging phases with player inputs
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
src/drag/spec-source.ts     WHERE THE CAR'S NUMBERS COME FROM: specForBenchmark, BENCHMARK_TO_SPEC, the class windows (CLASS_SPEC_LIMITS), the default final drive and the two curve shapes
src/benchmark/reference.ts  REFERENCE_CARDS: the work rate of real cards (the 8060S placeholder) that the calibration test lands near 10 s; docs/CALIBRATION.md
src/drag/model.ts           save rules with no screen: readyCar, tune and slots, recordRace
src/drag/physics.ts         the simulation (no drawing, no clock, deterministic)
src/drag/hud.ts, topdown.ts the drawing: tachometer and gauges, the strip from above
src/drag/tune-help.ts       the short description of every tune row
src/leaderboard/            the leaderboard client, class-leader ghost, ranked class day and their screens' logic (see below)
src/drag/page.ts            the page: title menu, tune screen, the race, the timeslip
tests/                      calibration.test.mjs (ET bands per class across every score, trap speeds, the 8060S, leaders and server bounds), drag.test.mjs (engine, model and save), drag-staging.test.mjs (staging sequence and the P1 physics), drag-topdown.test.mjs, tune-slots.test.mjs, page.test.mjs (shape of the game)
```

## The screens (`src/drag/page.ts`)

One canvas draws the strip behind a neon menu card (the Chromium Halo: Neon menu style, from `drag.html`'s CSS now in `index.html`).

- **Title menu:** BENCHMARK, CLASS, TUNE, RACE CLASS LEADER, DRIVER (MANUAL or AUTOPILOT), RECORDS, OPTIONS. All rows work.
- **TUNE:** the TUNING tab (shifting, launch, boost, gears, final drive, tire pressure, ballast, fuel load, suspension, wheelie bar, nitro, the six tune slots, REPLACE CLUTCH, COOL ENGINE, CLEAR STRIP, RESET TUNE, TEST RUN) and the STATS tab (the car's numbers, the dyno graph and a predicted timeslip from a perfect-driver run). Every change is saved at once and made safe for the car (`cleanTune`).
- **RACE CLASS LEADER:** a ranked run: the fixed class day (see below) against the ghost of your class leader. A clean pass with a benchmark is sent to the leaderboard when it ends.
- **OPTIONS** (`src/options/screen.ts`): DRIVER, MUSIC VOLUME, TOUCH CONTROLS (AUTO/ON/OFF), TOUCH SIZE, ANALOG TOUCH GAS, VIBRATION, INPUT DELAY (ms), FULLSCREEN, CONTROLS FOR (keyboard or gamepad), one row per control in `BIND_ROWS` (Enter rebinds the first key or button, Right the second, Left clears the second; a key or button does one thing, so it is taken from the other control unless that would leave it with none), RESET CONTROLS. Settings are saved at once under `gpuwars.options`.
- **Timeslip:** the result, with RUN AGAIN, NEXT RACE, TUNE and MAIN MENU.

## The simulation (`src/drag/physics.ts`)

No drawing, no clock, no `Math.random`: `createDrag({ seed, strip, entrants })` and `step()` at `DRAG.dt` (1/240 s). The same seed gives the same race. The page picks seeds with `Math.random`; nothing inside the engine does. Weather, wind and altitude come from the seed (`conditionsForSeed`). The engine models the full staging sequence (below), the tree and red light, launch, torque curve, flywheel, clutch heat and wear, limiter, gears and shift quality, traction with suspension pitch, wheelspin and lane steering, blower boost and engine heat, nitro, fuel burn, the run-out with brake fade and chute, and a crash at the end of the strip. `AUTO_DRIVER` is an automatic driver (it also drives the whole staging sequence); the tune screen's prediction (`predictDrag`) and most tests start with `createDrag({ quickStart: true })`, which puts every car in final stage with the tree armed (the old behaviour).

### The staging sequence (`STAGE` in `physics.ts`)

`Runner.stage` (`StagePhase`) goes `waterBoxApproach` -> `burnout` -> `runOut` -> `backup` -> `preStage` -> `staged` / `deepStaged` -> `rolling` -> `launched`. Positions are metres along the strip, 0 being the final beam (the start line); the car starts at `STAGE.startX` and nothing teleports: the gas, brake, burnout and `backUp` inputs move it through a small speed model (`stagingStep`).

- **Water box** (`waterBoxStart..End`): wets the slicks (`Runner.wet`, less grip at the launch until they dry, a wet burnout heats little and lays no rubber).
- **Burnout:** hold gas + burnout (or gas + brake) past the box start: the car rolls at `burnoutSpeed` with the rears spinning. Heat is `heatPerSlipMetre` per metre of slip, rubber is `rubberPerMetre` per metre on the dry strip (x > 0 only), and it dries the slicks.
- **Run-out and back up:** after the burnout the car runs out past the tree, brakes to a stop, and BACK UP (new rebindable `backUp` action, default R) reverses at most `backupSpeed` with `Runner.reversing` (the reverse light). The HUD shows the rollback speed and the distance to the pre-stage beam.
- **Beams:** pre-stage `STAGE.preStageRollout`, stage `DRAG.stageRollout`, deep stage `DRAG.deepStageRollout` behind the final beam (three distinct places), and `STAGE.overstageLimit`. Gas creeps the car; in stage (`catchSpeed` or slower) the trans-brake holds it, so gas only revs. A held `deepStage` creeps from pre-stage/stage to the deep beam and stops. Creeping into the over-stage zone resets the stage bulb (`Runner.overstaged`, label OVER-STAGED) until the car backs out past the stage beam.
- **The tree** (`state.armed`, `armedAt`, `greenAt`, `treeDelay`): dark (`greenAt` is Infinity) until every live car has held still in stage for `armHold` seconds (a ghost counts when its canned path is done). Then the seed's `treeDelay` runs to the green. A live car leaving stage before the green puts the tree out and redraws the delay. Crossing the final beam before the green (or with a dark tree, reaction -1) is a red light; crossing it during the run-out is not.
- **Auto driver / ghost:** `stagingPlanFor(seed, lane, skill)` is the deterministic plan (dry burnout metres, run-out stop, back up stop, deep stage) and `aiStagingInput` drives it. For the ghost's looks, `ghostStagingPath(seed, lane, deepStage)` returns a `StagingPath` (`duration`, samples every `GHOST.step` with `x, y, v, stage, burnout, reversing`) made by running the auto driver's real staging; `stagingPoseAt(path, t)` reads it. The physics already plays it for ghost runners before the green; their ET still starts at the green. A saved ghost keeps the last `STAGE.ghostLead` seconds before the green.

### Top-fuel traction (`CLUTCH_MANAGER`, `TRACTION`)

A car with `spec.topFuel` (every GPU Wars car; the plain `specFor` car the engine tests use is not) makes far more power than its tires can hold, so the power is managed:

- **Automatic clutch manager:** the force through the clutch is capped at `use` x the grip a NOMINAL track would give (`nominalGrip`: it knows the load, the wing and tire growth but not a cold, wet, worn or badly inflated tire or a poor strip, so those still spin the car). `use = useBase + useStep x launch aggression`, and the cap ramps in from `rampStart` over `rampTime` (longer at a gentle aggression). What is held back is `Runner.managedShed`; the engine revs `managedSlip` rpm above the wheels (up to `slipRpmMax`) and the clutch heats a little (`managedHeatPerJoule`).
- **Launch rpm hold:** for `holdTime` s the slipping clutch keeps the engine near the tune's launch rpm, so a modest car launches in its power band.
- **Tire growth and the wing:** grip grows by `TRACTION.growth` by `growthSpeed`, and `TRACTION.downforceArea` presses the rear down with speed squared.
- The tune stays meaningful: launch aggression, launch rpm, final drive, tire pressure, suspension and wheelie bar all change the ET by 0.1 to 0.5 s (`tests/calibration.test.mjs`). Turn `CLUTCH_MANAGER.gripGain` and `dragGain` first (see docs/CALIBRATION.md).

### Realism (P1 of `drag-mode.txt`)

- **Air density:** `densityTorqueShare` scales engine torque by `(rho / rhoRef)^ENGINE.densityTorqueExp`; a blower with charge makes up `BOOST.densityCompensation` of the shortfall and soaks `BOOST.chargeHeatPerComp` heat for it. `densityAltitudeOf(rho)` is shown as `DA nnnM` in `conditionsText`.
- **Trap speed:** average over the last `DRAG.trapWindow` (66 ft) from the `trapStart` mark (`DRAG.marks.trapStart`) to the finish.
- **Tire pressure:** `pressureGrip(hotPsi)` has a flat peak at `TIRE.optimalHotPsi` (under it grip falls fast and the tire heats, over it falls slowly); `hotPressure(cold, tireC, airC)` adds `TIRE.psiPerC`. The HUD shows hot and cold, and `Timeslip.hotPsi` the hot one.
- **Weight transfer:** the rear share gains `a x cgHeight / (g x wheelbase)` (`SUSP.transferGain`); anti-squat (`SUSP.antiSquatBase` + `antiSquatPerStep` per stiffness step) is the share the links deliver at once, the rest follows the springs over `transferTau`.
- **Shift down:** `DragInput.shiftDown` (manual shifting only) drops a gear, refused if it would pass the redline. The clutch stays automatic; nitro is automatic by gear or the nitro button.

The clutch has no key: it engages automatically. Its temperature and condition are a consumable carried between races in a visit (`clutchAfterRun`); REPLACE CLUTCH on the tune screen resets it for free.

## The benchmark, the class and the car's numbers

**BENCHMARK** (title row, never automatic) opens `src/benchmark/screen.ts`: a full-window layer with the workload's canvas, the equalizer and the pass counter (Esc or CANCEL stops it). `workload.ts` draws a fixed 1280x720 Julia-set shader with the beat and equalizer in it; it tries WebGL2, then WebGL1, then a 2D canvas (whose score is limited, `canvas2dScoreShare`). `runner.ts` does a warm-up, then `passes` timed passes, syncing with a one-pixel read-back so the card has really finished. `score.ts` throws away passes slower than the median by `throttleDrop` (or faster by `spikeRise`), refuses a run whose passes took an implausible time or that was hidden, turns the mean rate into a log-scale score (0 to `maxScore`) and caps it by class. All tunables are the one `BENCHMARK` object in `constants.ts` (`warmupMs`, `passes`, `throttleDrop`, `version`, and the `rate` ranges to calibrate on real cards). Change `version` whenever the workload or scoring changes. The result screen and the console print the CALIBRATION LINE (`calibrationLine` in `score.ts`: raw score, kept score, class cap, mean work rate in units/s); `docs/CALIBRATION.md` says how to turn it into `BENCHMARK.rate` numbers.

**The card and the class** (`gpu.ts`, `rules.ts`, `menu.ts`): the card's id is WebGL's unmasked renderer text (WebGPU's adapter info when there is no WebGL). A class is *detected* only when that text plainly names the card (GeForce/Radeon RX with a model number, Intel UHD/Iris/Arc A-series, Apple/Adreno); anything else (masked names, "Arc Graphics", Quadro, software renderers) leaves it to the player, who picks on the CLASS row and presses ENTER to lock it to that `gpuId`. A detected class cannot be changed; a hand-picked one is locked until the `gpuId` changes. The result `{ score, class, benchmarkVersion, gpuId, date, sustain? }` is re-run only when `gpuId` or `benchmarkVersion` changes (`rerunReason`). The ids are in `src/classes.ts`, a copy of `backend/src/classes.ts`.

**The car's numbers.** `src/drag/spec-source.ts` is the one place a race or the tune screen gets the car's spec:

```ts
specForBenchmark(benchmark: BenchmarkResult | null, clutchCondition = 1): DragSpec
```

With no result it is the WEAKEST spec (integrated, score 0, and 10% less torque than that card, so it is slower than every benchmarked car, about 13 s). With one, the spec is made in two steps so each class has a lot of room and the score still matters inside it: the score is taken as a share of the class's top score (`classScoreCap`), and `BENCHMARK_TO_SPEC` turns that share into where in the class's window (`CLASS_SPEC_LIMITS`: peak torque and limiter at the bottom and top of the class) the engine sits. The windows are what separate the classes: integrated 360-575 Nm (a 12.3 to 9.9 s car), retro 1400-2000, classic 1950-2850, modern 2800-4200, current 4650-6500 Nm (a 4.5 to 4.0 s top fuel car). The result's `sustain` picks the torque curve between `CURVE_BURST` and `CURVE_SUSTAINED`. `finalDriveFor(torque)` is the default final drive (short for a weak engine, tall for a strong one) and `readyCar` builds the default tune from it and from `LAUNCH_RPM_SHARE`. The curve lives on the spec (`spec.curve`, used by `torqueShape`). `stockSpec()` is a top-fuel-style car (`spec.topFuel`, see below): the stock car's grip and drag area times `CLUTCH_MANAGER.gripGain` and `dragGain`. `src/benchmark/dyno.ts` draws the same curve (hp = Nm x rpm / 7127, at the flywheel before the blower's boost) as the graph on the STATS tab, with the shift point and the power peak; the timeslip shows hp. It is a pure function of the saved result. `readyCar(save, clutchCondition)` in `model.ts` calls it and adds the tune (the default tune is built from the engine's own revs).

## The save (`src/save.ts`)

One small versioned record under the key `gpuwars.save`, repaired on load (`sanitizeSave`): `benchmark` (`{ score, class, benchmarkVersion, gpuId, date, sustain? }` or null), `classLock` (`{ class, gpuId, date }` or null: the hand-picked class), `tune`, `slots` (six) and `records` (totals, bests, the last ten runs; plain records, no ghost of your own). Settings are kept apart (`gpuwars.options`) so erasing a save never loses your controls. All storage goes through `src/browser-store.ts`, which never throws and falls back to memory when localStorage is blocked.

## The leaderboard (`src/leaderboard/`)

- The class list is ONE file, `backend/src/classes.ts`, re-exported by `src/classes.ts` (no copy; a test checks it). `config.ts` holds the one placeholder `baseUrl` (empty: offline) and the timeout. Nothing is requested at load: the leader is fetched after the first key or tap, the boards when RECORDS opens, a score when a ranked run ends.
- `client.ts` never throws: no URL, no network, CORS, timeout, 4xx/5xx all become `{ ok: false, kind, message }`; `leader()` always returns a record (the server's, or `fallbackLeader` from `leader.ts`, whose bundled times are placeholders in `FALLBACK_LEADERS`). `X-Client-Id` is generated once (`profile.ts`, stored apart from the save with your name and ONE unsent run that is retried later).
- `payload.ts` builds the `POST /scores` body (feet, mph, tune flattened to numbers, optional compact ghost). `tests/leaderboard.test.mjs` runs it through the backend's own `validateSubmission`. A run is ranked only if it is clean and a benchmark gave a valid class; `category` is `manual` unless the autopilot phase calls `ui.setCategory('autopilot')`.
- `ghost.ts`: the class-leader ghost is a smooth monotone curve through the leader's marks to the trap speed, not a physics car and not a replay. Missing splits come from `launchEnvelope`: a power-limited pull (`powerByEra`, mixed with the trap speed) blended with a traction-limited start that fades out by 330 ft, set so the 60 ft lands on `launchShareFor(ET)` (real cars: 22 percent of the ET for a 3.7 s top fuel car, 16.5 percent at 10 s, 15 percent at 14 s; the 330 ft, eighth and 1000 ft come out near 42, 63 and 83 percent). The leader's own splits are never moved. Lane drift is seeded; the staging path is canned. It goes through `cleanDragGhost` and plays in `physics.ts` as any ghost. Turn `LEADERBOARD_GHOST.launchShare` first for the launch, `powerByEra` for the pull.
- Ghost looks (`playGhost` in `physics.ts`, `topdown.ts`): before the green a ghost follows the canned staging path (burnout with smoke, run-out, back up with the reverse light, pre-stage, stage; its pre-stage and stage bulbs light in its own tree column); its ET still starts at the green and only the ET is compared. At the finish line ANY ghost entrant takes over as a braking car: it keeps its position and speed at the line, opens its chute and brakes through the same `shutdownStep` as the player's car (with `ghostBrakeScale`, extra braking only when a fast ghost would otherwise leave the strip), so it rolls out and stops inside the run-out. In the top-down view only YOUR car has the clutch, boost, tire and fuel readouts (beside the car, away from the other lane, or under it on a narrow screen); the ghost shows its name, stage and ET to the outer side of its lane.
- `ranked.ts`: `RANKED.seed` and `RANKED.conditions` are the one class day (calm wind, flat weather front, 22C air, 300 m, 36C track); `rankedStrip()` is a fresh strip and `rankedStart()` a new clutch, full tank and cool engine, so earlier races never change a ranked run. `densityAltitudeFt` is shown on the race banner. Free play (TEST RUN) keeps random weather.
- Autopilot runs race on the same class day as manual ones (only the category differs). Rubber from the player's own burnout lays on the fresh strip and raises their grip (tested).
- `letter-picker.ts`: name entry with no keyboard (up/down or tap cycles letters; ADD, DELETE, DONE, CANCEL) on the NAME screen, in the neon menu style.
- `delta.ts`: ghost delta (you minus the leader) drawn on the race HUD and listed on the timeslip. `ui.ts` is the one object `page.ts` calls.

## Extension points for the next phases

- **Input:** `readInput()` in `page.ts` is one line: `race.setInput(0, options.driver === 'autopilot' ? autopilot.decide(viewOf(race, 0, phase)) : input.read())`. Keys, touch pointers and pad polls are pushed as timestamped events (`src/input/queue.ts`); each fixed tick drains the events due by that tick's time and builds a `DriverInput`. Touch controls are drawn on the canvas by `input.draw()` (`touch.ts`). Haptics buzz on launch, shift, nitro, wheelspin, wheelie, chute, foul, wall and crash.
- **Autopilot** (`src/drag/autopilot.ts`): `decide(viewOf(race, 0, runner.stage))` returns a `DriverInput`. It never works out the staging itself: the page passes the engine's `StagePhase`, and each phase gets what a player would press. `waterBoxApproach` and `burnout`: gas to the water box, then gas + burnout (shorter when the engine is hot, until the tires reach `burnoutTireTemp`), then gas on. `runOut`: gas until the car would stop past the tree, brake, then back up. `backup`: back up to just behind the pre-stage beam, brake, then creep (`creepGas`). `preStage`: creep into stage (the engine holds a slow car there). `staged`: full gas, and `launch` (roll out) at the moment that puts the car on the final beam `AUTOPILOT.reaction` seconds after the predicted green, read from the ambers. After `launched`: `autoThrottle`, shifts, nitro and the chute. It pays the full staging (about 30 s of the race clock) but the ET starts at the launch, so that does not change it. `page.ts` sets the leaderboard category with `lb.setCategory` (`syncCategory`), so autopilot runs race the autopilot leader on the same ranked class day, and they skip local records.
- **Leaderboard server:** `backend/` (Cloudflare Workers and D1); set `LEADERBOARD_API.baseUrl` after deploying it.

## Conventions

See `CLAUDE.md`. The ones that matter most: plain-English names, a deterministic simulation (no `Math.random` in `src/drag/physics.ts` or anything it calls), numbers in named constants, and a rebindable key for every gameplay action (`DEFAULT_BINDS`).

## Known gaps

- The tune screen's STATS tab shows the density altitude and the hot tire pressure, but the prediction still starts staged, with warm tires and no burnout.
- The race screen draws a readout under every car; with two cars close together (the ranked race) the two readouts overlap.
- Staging uses the speed model in `stagingStep`, not the drivetrain: the clutch and engine temperature only see the revs and the heat from the gas, as before.
- `topdown.ts` uses `Math.random` for the look of tire smoke puffs (drawing only, not the simulation); it should move to a seeded source so replays look identical.
- The input delay only delays delivery of presses; it cannot move a press earlier than the frame it arrived in.
- Per-run tire wear that the source charged points for is gone: tires start every race new (the live per-run wear inside a race is unchanged).
