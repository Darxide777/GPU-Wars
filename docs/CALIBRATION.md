# Calibration: how a class and a score become a quarter-mile time

One rule: **the class sets the range, the score sets the place in it, the tune is worth a few tenths.** A card in a better class is a different kind of machine, not a slightly faster one.

There are TWO classes for now, `integrated` and `discrete` (no vendor or generation split yet). The list is one file, `backend/src/classes.ts`; to add classes later see "Adding a class" in `docs/ARCHITECTURE.md`. Because the single discrete window is wide, the score does the work the old generations used to do.

| class | slowest card (score 0) | fastest card (class cap) | machine |
|---|---|---|---|
| integrated | 12.3 s | 9.4 s (score 8000; a strong iGPU such as the Radeon 8060S scores about 6100 and runs about 9.9 s, near 10) | a 400 to 650 hp street car |
| discrete | 6.9 s (a weak old card) | 4.0 s at about 340 mph (the best current cards, score 10000) | a 1,900 hp funny car up to a top fuel dragster |
| no benchmark | 12.9 s | | slower than every benchmarked car |

Times are the perfect-driver prediction (`predictDrag`) on the ranked class day with the default tune. A good tune is 0.1 to 0.5 s quicker.

## The full table (default tune, ranked class day, 22 C air, 300 m)

| class | score | peak torque Nm | 60 ft | ET default tune | trap mph | ET good tune |
|---|---|---|---|---|---|---|
| integrated | 0 | 360 | 2.27 | 12.33 | 106 | 11.77 |
| integrated | 800 | 385 | 2.18 | 11.92 | 110 | 11.39 |
| integrated | 1600 | 409 | 2.10 | 11.55 | 113 | 11.06 |
| integrated | 2400 | 436 | 2.04 | 11.24 | 116 | 10.76 |
| integrated | 3200 | 465 | 1.97 | 10.90 | 120 | 10.45 |
| integrated | 4000 | 494 | 1.91 | 10.58 | 124 | 10.14 |
| integrated | 4800 | 524 | 1.86 | 10.31 | 127 | 9.89 |
| integrated | 5600 | 553 | 1.82 | 10.07 | 130 | 9.66 |
| integrated | 6400 | 582 | 1.78 | 9.85 | 133 | 9.45 |
| integrated | 7200 | 611 | 1.73 | 9.62 | 136 | 9.24 |
| integrated | 8000 | 640 | 1.70 | 9.44 | 139 | 9.06 |
| discrete | 0 | 1400 | 1.19 | 6.94 | 184 | 6.74 |
| discrete | 1000 | 1849 | 1.05 | 6.23 | 206 | 6.06 |
| discrete | 2000 | 2298 | 0.97 | 5.74 | 224 | 5.60 |
| discrete | 3000 | 2787 | 0.91 | 5.34 | 242 | 5.24 |
| discrete | 4000 | 3318 | 0.86 | 5.01 | 259 | 4.91 |
| discrete | 5000 | 3848 | 0.84 | 4.76 | 275 | 4.66 |
| discrete | 6000 | 4378 | 0.82 | 4.56 | 289 | 4.45 |
| discrete | 7000 | 4909 | 0.81 | 4.38 | 303 | 4.29 |
| discrete | 8000 | 5439 | 0.80 | 4.24 | 314 | 4.16 |
| discrete | 9000 | 5970 | 0.80 | 4.12 | 327 | 4.05 |
| discrete | 10000 | 6500 | 0.80 | 4.03 | 338 | 3.97 |
| no benchmark (weakest) | - | 324 | 2.42 | 12.91 | 102 | - |

Real cards on the log score scale (`REFERENCE_CARDS`, `src/benchmark/reference.ts`; all rates are PLACEHOLDERS at about 5 percent of the card's fp32 peak, the same guess as the 8060S):

| card | class | rate units/s | score | ET default tune |
|---|---|---|---|---|
| AMD Radeon 8060S | integrated | 6.0e+11 | 6123 | 9.89 |
| NVIDIA GeForce GT 710 (weakest) | discrete | 1.8e+10 | 0 | 6.94 |
| NVIDIA GeForce GTX 750 Ti | discrete | 6.5e+10 | 1580 | 5.93 |
| NVIDIA GeForce GTX 1060 | discrete | 2.2e+11 | 4072 | 5.00 |
| NVIDIA GeForce RTX 3060 | discrete | 6.4e+11 | 6255 | 4.51 |
| NVIDIA GeForce RTX 4070 | discrete | 1.5e+12 | 7926 | 4.25 |
| NVIDIA GeForce RTX 4090 | discrete | 4.1e+12 | 10000 | 4.03 |



The log scale `score = 10000 x ln(rate / 3e10) / ln(4e12 / 3e10)` spreads a GT 710 to an RTX 4090 over the whole discrete window: every 500 points are worth at least 0.04 s (about 0.35 s at the bottom, 0.04 s at the top) and the order of the cards is the order of their rates (`tests/calibration.test.mjs`). The top of the discrete window is flat because grip, not torque, is the limit there (as before); the tune is what separates the top cards.

leaders (manual): integrated 9.7 s @138 mph; discrete 4.33 s @309 mph (autopilot leaders are 0.12 s slower)

## What sets the numbers, in the order to turn them

1. **`CLASS_SPEC_LIMITS`** (`src/drag/spec-source.ts`): peak torque and limiter at the bottom and top of each class. This sets each class's ET range. ET follows roughly (torque)^-1/3 up to the top of the discrete window, where grip, not torque, is the limit. Integrated is 360 to 640 Nm and 6400 to 7400 rpm, discrete 1400 to 6500 Nm and 7400 to 9400 rpm.
2. **`CLASS_SCORE_SHARE`** (`src/benchmark/constants.ts`): the highest score of each class as a share of `maxScore` (integrated 0.8, discrete 1). A score above it is capped, so a wrongly detected class cannot out-run its class.
3. **`BENCHMARK_TO_SPEC`**: how the score (as a share of the class cap) is spread over the class window.
4. **`BENCHMARK.rate`** (`src/benchmark/constants.ts`): which card scores what (the log scale from `min` to `max` work units per second). `version` stays 2: the rates and the scale of the integrated class did not change, and a saved result of an old 17-class id is re-run anyway ('class changed').
5. **`CLUTCH_MANAGER` and `TRACTION`** (`src/drag/physics.ts`): what lets the high end use its power: `gripGain` (the car's grip), `dragGain` (its drag area, which holds the trap speed at about 340 mph), `TRACTION.growth` (tires grow with speed), `TRACTION.downforceArea` (the wing), `useBase`/`useStep` (how close to the nominal grip the clutch lets the power go, set by the launch aggression in the tune), `rampTime` (how fast the power comes in), `holdTime` (the slipping clutch keeps the launch revs). The clutch heat of a top fuel launch is `CLUTCH_MANAGER.heatShare` of the plain car's.
6. **`FALLBACK_LEADERS`** (`src/leaderboard/leader.ts`): the bundled class leaders. Each is a card at 70% of its class's top score (5600 integrated, 7000 discrete) with a good tune, plus 0.04 s: a typical card with a good tune beats it, a top card beats it comfortably, a default tune does not. Trap speed is `trapMphSeconds` (1340) / ET, which is what the simulation gives (ET x trap is 1310 to 1380 mph s from the 10 s car to the 4 s car, as it is in real life).
7. **`backend/src/classes.ts`** bounds (min ET, max trap per class): a little outside what the simulation gives for the top card with a perfect tune on the thinnest, coolest, grippiest day of 80 seeds: discrete 3.96 s at up to 351 mph (bounds 3.6 s, 370 mph), integrated 8.74 s at 150 (8.5, 170). One discrete window means a weak discrete card is held only to the best card's bounds (a 7 s card could claim a 3.7 s run); the stored `benchmarkScore` makes a score-aware check possible later.

`tests/calibration.test.mjs` sweeps score x class and fails if any class leaves its ET band (integrated 9.3 to 12.8 s, discrete 3.95 to 7.2 s), if a higher score is ever slower, if the discrete window stops separating cards (500 points worth less than 0.035 s, or the reference cards out of order), if a trap speed does not fit its ET, if the 8060S placeholder leaves 10 s +/- 0.35 s, if the un-benchmarked car is not the slowest of all, if a tune stops mattering, or if a fallback leader leaves the bands or the server bounds. `PRINT_ET_TABLE=1 node --test tests/calibration.test.mjs` prints the table.

## Calibrating `BENCHMARK.rate` on real hardware (the Radeon 8060S)

The benchmark turns a measured **work rate** (shader iterations of the Julia-set workload per second, `units/s`) into a score on a log scale: `score = 10000 x ln(rate / min) / ln(max / min)`, clamped to 0..10000 and then to the class cap. The rate ranges in `BENCHMARK.rate` are placeholders until real cards are measured.

**What the owner does:**

1. Build and open the game (`npm run build`, then serve `index.html`), press **BENCHMARK** (the class is detected, never picked) and let it finish with the screen visible and no other tab busy.
2. Read the result screen. It prints one line, and the same line goes to the browser console (`[GPU Wars benchmark] ...`):

   `RAW SCORE 6123 (KEPT 6123, CLASS CAP 8000) | RATE 6.000e+11 units/s (600.0 G units/s) | webgl2 | version 2 | gpu <name> | class integrated`

3. Report the **RATE** and the **gpu** text (copy the console line). Run it three times and use the middle one: the rate is the mean of the passes that were not thermally throttled.
4. Then do what the table below says.

**Placeholder for the 8060S:** `REFERENCE_CARDS` in `src/benchmark/reference.ts` guesses 6e11 units/s (about 12 fp32 TFLOP at roughly 5% of peak on this shader). With `rate: { min: 3e10, max: 4e12 }` that scores 6123, a **9.9 s** car (about 9.6 s with a good tune), near the top of integrated (the cap is 8000). The log scale puts a 1 TFLOP iGPU near score 0 and a 4090-class card at the maximum.

**Turning the owner's number into the constants:** let `R` be the reported rate of the 8060S.

- If the 8060S should score about 6100 (a 10 s car), pick `max` (the rate a flagship card reaches; anything above is capped; 4e12 is the start) and solve for `min` so that `ln(R / min) / ln(max / min) = 0.61`, that is `min = exp((ln R - 0.61 x ln max) / 0.39)`. For R = 6e11 and max = 4e12 this gives min = 3.0e10.
- Set `BENCHMARK.rate.webgl2` and `webgl1` to `{ min, max }`, update `REFERENCE_CARDS` (set `source: 'measured'`), bump `BENCHMARK.version` (every saved score is then re-run), and run `npm test`: the 8060S test checks that `scoreFromRate(R)` gives a 10 s car.
- Other cards later: add them to `REFERENCE_CARDS` with their class and the ET they should have, so the table stays honest. A faster strong iGPU should score higher than the 8060S, which is why the placeholder sits below the integrated cap.
- If the 8060S is much slower or faster than the guess, only `rate.min`/`max` change; the physics and the class windows do not.

`canvas2d` (the fallback when WebGL is missing) has its own range and can never score above 40% of `maxScore`.

## The ghost's launch curve

The class leader's ghost (`src/leaderboard/ghost.ts`) makes the splits the leader's record does not give from `launchEnvelope`. It is tuned to the simulation: `LEADERBOARD_GHOST.launchShare` holds the simulated 60 ft as a share of the ET per ET with the default tune (0.198 at 4.0 s, 0.181 at 4.55 s, 0.173 at 5.0 s, 0.169 at 5.75 s, 0.172 at 6.9 s, 0.180 at 9.5 s), `powerByClass` is 1.6 for both classes and `trapShare` is 0.2. `tests/ghost-fx.test.mjs` compares the generated splits (60 ft, 330 ft, 1/8 mile, 1000 ft as a share of the ET) with the simulated ones for both classes at the bundled leader's ET and at six scores across each class's range, and fails beyond 5 percent. A leader with a GOOD tune launches a little harder than the default-tune physics (60 ft about 0.164 of a 9.7 s ET, 0.174 of 4.3 s, against the ghost's 0.180 and 0.187): the share table follows the default tune, so a ghost is slightly conservative off the line. After changing the physics, rerun it and move `launchShare` to the new simulated 60 ft shares.
