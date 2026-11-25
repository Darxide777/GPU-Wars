# Calibration: how a class and a score become a quarter-mile time

One rule: **the class sets the range, the score sets the place in it, the tune is worth a few tenths.** A card in a better class is a different kind of machine, not a slightly faster one.

| class | slowest card (score 0) | fastest card (class cap) | machine |
|---|---|---|---|
| integrated | 12.3 s | 9.9 s (strong iGPU such as the Radeon 8060S: about 10 s) | a 400 to 600 hp street car |
| discrete retro | 6.9 s | 6.0 s | a 1,900 to 2,800 hp funny car |
| discrete classic | 6.1 s | 5.3 s | |
| discrete modern | 5.4 s | 4.6 s | |
| discrete current | 4.5 s | 4.0 s at about 340 mph | a top fuel dragster |
| no benchmark | 12.9 s | | slower than every benchmarked car |

Times are the perfect-driver prediction (`predictDrag`) on the ranked class day with the default tune. A good tune is 0.1 to 0.5 s quicker.

## The full table (default tune, ranked class day, 22 C air, 300 m)

| class (any vendor) | score | peak torque Nm | 60 ft | ET default tune | trap mph | ET good tune |
|---|---|---|---|---|---|---|
| integrated | 0 | 360 | 2.27 | 12.33 | 106 | 11.77 |
| integrated | 1750 | 407 | 2.11 | 11.55 | 113 | 11.05 |
| integrated | 3500 | 463 | 1.97 | 10.85 | 121 | 10.38 |
| integrated | 5250 | 519 | 1.88 | 10.32 | 127 | 9.87 |
| integrated | 7000 | 575 | 1.79 | 9.85 | 133 | 9.43 |
| discrete retro | 0 | 1400 | 1.19 | 6.94 | 184 | 6.74 |
| discrete retro | 1875 | 1532 | 1.15 | 6.68 | 192 | 6.48 |
| discrete retro | 3750 | 1688 | 1.10 | 6.41 | 200 | 6.22 |
| discrete retro | 5625 | 1844 | 1.06 | 6.19 | 208 | 6.01 |
| discrete retro | 7500 | 2000 | 1.03 | 6.00 | 215 | 5.82 |
| discrete classic | 0 | 1950 | 1.03 | 6.13 | 209 | 5.98 |
| discrete classic | 2125 | 2148 | 0.99 | 5.88 | 219 | 5.73 |
| discrete classic | 4250 | 2382 | 0.96 | 5.63 | 229 | 5.49 |
| discrete classic | 6375 | 2616 | 0.94 | 5.42 | 238 | 5.27 |
| discrete classic | 8500 | 2850 | 0.91 | 5.25 | 247 | 5.11 |
| discrete modern | 0 | 2800 | 0.90 | 5.37 | 240 | 5.27 |
| discrete modern | 2375 | 3108 | 0.88 | 5.15 | 252 | 5.05 |
| discrete modern | 4750 | 3472 | 0.86 | 4.92 | 264 | 4.82 |
| discrete modern | 7125 | 3836 | 0.84 | 4.75 | 276 | 4.64 |
| discrete modern | 9500 | 4200 | 0.83 | 4.59 | 286 | 4.49 |
| discrete current | 0 | 4650 | 0.82 | 4.54 | 289 | 4.45 |
| discrete current | 2500 | 5057 | 0.81 | 4.39 | 301 | 4.30 |
| discrete current | 5000 | 5538 | 0.80 | 4.24 | 315 | 4.16 |
| discrete current | 7500 | 6019 | 0.80 | 4.12 | 327 | 4.04 |
| discrete current | 10000 | 6500 | 0.80 | 4.03 | 338 | 3.97 |
| 8060S placeholder (rate 6e11) | 6000 | 543 | 1.82 | 10.09 | 130 | 9.66 |
| no benchmark (weakest) | - | 324 | 2.42 | 12.91 | 102 | - |

leaders (manual): integrated 10s @134mph; discrete-amd-retro 6.09s @220mph; discrete-nvidia-classic 5.34s @250.9mph; discrete-nvidia-modern 4.7s @285.1mph; discrete-nvidia-current 4.09s @327.6mph

## What sets the numbers, in the order to turn them

1. **`CLASS_SPEC_LIMITS`** (`src/drag/spec-source.ts`): peak torque and limiter at the bottom and top of each class. This sets each class's ET range. ET follows roughly (torque)^-1/3 up to a class where grip, not torque, is the limit (`current`).
2. **`CLASS_SCORE_SHARE`** (`src/benchmark/constants.ts`): the highest score of each class as a share of `maxScore` (integrated 0.7, retro 0.75, classic 0.85, modern 0.95, current 1). A score above it is capped, so a wrongly detected class cannot out-run its class.
3. **`BENCHMARK_TO_SPEC`**: how the score (as a share of the class cap) is spread over the class window.
4. **`BENCHMARK.rate`** (`src/benchmark/constants.ts`): which card scores what (the log scale from `min` to `max` work units per second). `version` is 2: it was 1 before this recalibration, so old saved results are re-run.
5. **`CLUTCH_MANAGER` and `TRACTION`** (`src/drag/physics.ts`): what lets the high end use its power: `gripGain` (the car's grip), `dragGain` (its drag area, which holds the trap speed at about 340 mph), `TRACTION.growth` (tires grow with speed), `TRACTION.downforceArea` (the wing), `useBase`/`useStep` (how close to the nominal grip the clutch lets the power go, set by the launch aggression in the tune), `rampTime` (how fast the power comes in), `holdTime` (the slipping clutch keeps the launch revs). The clutch heat of a top fuel launch is `CLUTCH_MANAGER.heatShare` of the plain car's.
6. **`FALLBACK_LEADERS`** (`src/leaderboard/leader.ts`): the bundled class leaders. Each is a card at 70% of its class's top score with a good tune, plus 0.04 s: a typical card with a good tune beats it, a top card beats it comfortably, a default tune does not. Trap speed is `trapMphSeconds` (1340) / ET, which is what the simulation gives (ET x trap is 1310 to 1380 mph s from the 10 s car to the 4 s car, as it is in real life).
7. **`backend/src/classes.ts`** bounds (min ET, max trap per class): a little outside what the simulation gives for the top card with a perfect tune on the thinnest, coolest, grippiest day of 80 seeds: current 3.9 s at up to 351 mph (bounds 3.6 s, 370 mph), modern 4.4 at 300 (4.1, 320), classic 4.98 at 260 (4.6, 280), retro 5.68 at 228 (5.3, 245), integrated 9.07 at 145 (8.5, 170).

`tests/calibration.test.mjs` sweeps score x class and fails if any class leaves its ET band, if a higher score is ever slower, if a trap speed does not fit its ET, if the 8060S placeholder leaves 10 s +/- 0.35 s, if the un-benchmarked car is not the slowest of all, if a tune stops mattering, or if a fallback leader leaves the bands or the server bounds. `PRINT_ET_TABLE=1 node --test tests/calibration.test.mjs` prints the table.

## Calibrating `BENCHMARK.rate` on real hardware (the Radeon 8060S)

The benchmark turns a measured **work rate** (shader iterations of the Julia-set workload per second, `units/s`) into a score on a log scale: `score = 10000 x ln(rate / min) / ln(max / min)`, clamped to 0..10000 and then to the class cap. The rate ranges in `BENCHMARK.rate` are placeholders until real cards are measured.

**What the owner does:**

1. Build and open the game (`npm run build`, then serve `index.html`), choose the class **INTEGRATED** if the card is not detected, press **BENCHMARK** and let it finish with the screen visible and no other tab busy.
2. Read the result screen. It prints one line, and the same line goes to the browser console (`[GPU Wars benchmark] ...`):

   `RAW SCORE 6123 (KEPT 6123, CLASS CAP 7000) | RATE 6.000e+11 units/s (600.0 G units/s) | webgl2 | version 2 | gpu <name> | class integrated`

3. Report the **RATE** and the **gpu** text (copy the console line). Run it three times and use the middle one: the rate is the mean of the passes that were not thermally throttled.
4. Then do what the table below says.

**Placeholder for the 8060S:** `REFERENCE_CARDS` in `src/benchmark/reference.ts` guesses 6e11 units/s (about 12 fp32 TFLOP at roughly 5% of peak on this shader). With `rate: { min: 3e10, max: 4e12 }` that scores 6123, a **10.0 s** car (about 9.7 s with a good tune), near the top of integrated (the cap is 7000). The log scale puts a 1 TFLOP iGPU near score 0 and a 4090-class card at the maximum.

**Turning the owner's number into the constants:** let `R` be the reported rate of the 8060S.

- If the 8060S should score about 6100 (a 10 s car), pick `max` (the rate a flagship card reaches; anything above is capped; 4e12 is the start) and solve for `min` so that `ln(R / min) / ln(max / min) = 0.61`, that is `min = exp((ln R - 0.61 x ln max) / 0.39)`. For R = 6e11 and max = 4e12 this gives min = 3.0e10.
- Set `BENCHMARK.rate.webgl2` and `webgl1` to `{ min, max }`, update `REFERENCE_CARDS` (set `source: 'measured'`), bump `BENCHMARK.version` (every saved score is then re-run), and run `npm test`: the 8060S test checks that `scoreFromRate(R)` gives a 10 s car.
- Other cards later: add them to `REFERENCE_CARDS` with their class and the ET they should have, so the table stays honest. A faster strong iGPU should score higher than the 8060S, which is why the placeholder sits below the integrated cap.
- If the 8060S is much slower or faster than the guess, only `rate.min`/`max` change; the physics and the class windows do not.

`canvas2d` (the fallback when WebGL is missing) has its own range and can never score above 40% of `maxScore`.

## The ghost's launch curve

The class leader's ghost (`src/leaderboard/ghost.ts`) makes the splits the leader's record does not give from `launchEnvelope`. It is tuned to the simulation: `LEADERBOARD_GHOST.launchShare` holds the simulated 60 ft as a share of the ET per class ET (0.193 at 4.1 s, 0.176 at 4.8 s, 0.170 at 5.5 s, 0.171 at 6.25 s, 0.182 at 10.4 s), `powerByEra` is 1.6 for every class and `trapShare` is 0.2. `tests/ghost-fx.test.mjs` compares the generated splits (60 ft, 330 ft, 1/8 mile, 1000 ft as a share of the ET) with the simulated ones for every class and fails beyond 5 percent (it is within about 3 percent). After changing the physics, rerun it and move `launchShare` to the new simulated 60 ft shares.
