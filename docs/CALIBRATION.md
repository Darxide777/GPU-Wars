# Calibration: how a class and a score become a quarter-mile time

(The Formula lap times are at the end of this file: "Formula lap times".)

One rule: **the class sets the range, the score sets the place in it, the tune is worth a few tenths.** A card in a better class is a different kind of machine, not a slightly faster one.

There are TWO classes for now, `integrated` and `discrete` (no vendor or generation split yet). The list is one file, `backend/src/classes.ts`; to add classes later see "Adding a class" in `docs/ARCHITECTURE.md`. Because the single discrete window is wide, the score does the work the old generations used to do.

| class | slowest card (score 0) | fastest card (class cap) | machine |
|---|---|---|---|
| integrated | 12.3 s | 9.4 s (score 8000; a strong iGPU such as the Radeon 8060S scores 5005 (measured) and runs about 10.3 s, near 10) | a 400 to 650 hp street car |
| discrete | 6.9 s (a weak old card) | 4.0 s at about 340 mph (the best current cards, score 10000) | a 1,900 hp funny car up to a top fuel dragster |
| no benchmark | 12.9 s | | slower than every benchmarked car |

Times are the perfect-driver prediction (`predictDrag`) on the ranked class day with the default tune. A good tune is 0.1 to 0.5 s quicker, and a full search of every tune setting gains up to about 1.3 s on integrated and 0.7 s on discrete (the server allows for that: `PLAUSIBLE_TOLERANCE.goodTune`).

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

Real cards on the log score scale (`REFERENCE_CARDS`, `src/benchmark/reference.ts`; the 8060S is a REAL MEASUREMENT from the owner's machine (score 5005, taken for the masked-GPU PR, 2026-11-25); the discrete rates are PLACEHOLDERS at about 5 percent of the card's fp32 peak):

| card | class | rate units/s | score | ET default tune |
|---|---|---|---|---|
| AMD Radeon 8060S (measured) | integrated | 3.47e+11 | 5005 | about 10.3 |
| Samsung Galaxy S24 Ultra, phone (measured) | integrated | 5.67e+10 | 1302 | about 11.7 |
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
7. **`backend/src/classes.ts`** bounds (min ET, max trap per class): a little outside what the simulation gives for the top card with a perfect tune on the thinnest, coolest, grippiest day of 80 seeds: discrete 3.96 s at up to 351 mph (bounds 3.6 s, 370 mph), integrated 8.74 s at 150 (8.5, 170). These class-wide bounds are the outer limit. `backend/src/plausible.ts` adds a score-aware window from a small table of the default-tune rows above (see `docs/LEADERBOARD.md`); `tests/score-bounds.test.mjs` fails if the physics (default or good tune) leaves it, so refresh its `SCORE_CURVE` after a physics change.

`tests/calibration.test.mjs` sweeps score x class and fails if any class leaves its ET band (integrated 9.3 to 12.8 s, discrete 3.95 to 7.2 s), if a higher score is ever slower, if the discrete window stops separating cards (500 points worth less than 0.035 s, or the reference cards out of order), if a trap speed does not fit its ET, if the 8060S placeholder leaves 10 s +/- 0.35 s, if the un-benchmarked car is not the slowest of all, if a tune stops mattering, or if a fallback leader leaves the bands or the server bounds. `PRINT_ET_TABLE=1 node --test tests/calibration.test.mjs` prints the table.

## Calibrating `BENCHMARK.rate` on real hardware (the Radeon 8060S)

The benchmark turns a measured **work rate** (shader iterations of the Julia-set workload per second, `units/s`) into a score on a log scale: `score = 10000 x ln(rate / min) / ln(max / min)`, clamped to 0..10000 and then to the class cap. The rate ranges in `BENCHMARK.rate` are placeholders until real cards are measured.

**What the owner does:**

1. Build and open the game (`npm run build`, then serve `index.html`), press **BENCHMARK** (the class is detected, never picked) and let it finish with the screen visible and no other tab busy.
2. Read the result screen. It prints one line, and the same line goes to the browser console (`[GPU Wars benchmark] ...`):

   `RAW SCORE 5005 (KEPT 5005, CLASS CAP 8000) | RATE 3.473e+11 units/s (347.3 G units/s) | webgl2 | version 2 | gpu <name> | class integrated`

3. Report the **RATE** and the **gpu** text (copy the console line). Run it three times and use the middle one: the rate is the mean of the passes that were not thermally throttled.
4. Then do what the table below says.

**The 8060S is measured:** the owner's machine scored **5005** on `rate: { min: 3e10, max: 4e12 }` (rate 3.47e11 units/s, stored in `REFERENCE_CARDS` with `source: 'measured'`), a **10.3 s** car on the default tune, which the owner accepts as about 10 s. The score table and `BENCHMARK.rate` were NOT changed to chase 10.0 s. The calibration test checks the 8060S lands at its `targetEt` (10.3 s) within 0.35 s. It is below the integrated cap (8000), so faster iGPUs score higher. The log scale puts a 1 TFLOP iGPU near score 0 and a 4090-class card at the maximum.

**Turning the owner's number into the constants:** let `R` be the reported rate of the 8060S.

- (Historical, for a re-calibration) if the 8060S should score about 6100 (a 10 s car), pick `max` (the rate a flagship card reaches; anything above is capped; 4e12 is the start) and solve for `min` so that `ln(R / min) / ln(max / min) = 0.61`, that is `min = exp((ln R - 0.61 x ln max) / 0.39)`. For R = 6e11 and max = 4e12 this gives min = 3.0e10.
- Set `BENCHMARK.rate.webgl2` and `webgl1` to `{ min, max }`, update `REFERENCE_CARDS` (set `source: 'measured'`), bump `BENCHMARK.version` (every saved score is then re-run), and run `npm test`: the 8060S test checks that `scoreFromRate(R)` gives a 10 s car.
- Other cards later: add them to `REFERENCE_CARDS` with their class and the ET they should have, so the table stays honest. A faster strong iGPU should score higher than the 8060S, which is why the placeholder sits below the integrated cap.
- If the 8060S is much slower or faster than the guess, only `rate.min`/`max` change; the physics and the class windows do not.

`canvas2d` (the fallback when WebGL is missing) has its own range and can never score above 40% of `maxScore`.

## The ghost's launch curve

The class leader's ghost (`src/leaderboard/ghost.ts`) makes the splits the leader's record does not give from `launchEnvelope`. It is tuned to the simulation: `LEADERBOARD_GHOST.launchShare` holds the simulated 60 ft as a share of the ET per ET with the default tune (0.198 at 4.0 s, 0.181 at 4.55 s, 0.173 at 5.0 s, 0.169 at 5.75 s, 0.172 at 6.9 s, 0.180 at 9.5 s), `powerByClass` is 1.6 for both classes and `trapShare` is 0.2. `tests/ghost-fx.test.mjs` compares the generated splits (60 ft, 330 ft, 1/8 mile, 1000 ft as a share of the ET) with the simulated ones for both classes at the bundled leader's ET and at six scores across each class's range, and fails beyond 5 percent. A leader with a GOOD tune launches a little harder than the default-tune physics (60 ft about 0.164 of a 9.7 s ET, 0.174 of 4.3 s, against the ghost's 0.180 and 0.187): the share table follows the default tune, so a ghost is slightly conservative off the line. After changing the physics, rerun it and move `launchShare` to the new simulated 60 ft shares.

## Masked graphics cards (the browser hides the name)

Some browsers (Firefox ", or similar" buckets, resistFingerprinting, Tor, Brave shields) report a fixed placeholder such as `AMD Radeon R9 200 Series, or similar` (see the list and sources in the comments of `src/benchmark/gpu.ts`). Such a name is UNKNOWN, never the card it names. The class is then decided AFTER the benchmark from the measured work rate, by the one rule in `MASKED_GPU_RULE` (`src/benchmark/constants.ts`):

- threshold rate = rate of the reference card (`AMD Radeon 8060S`, MEASURED, 3.47e11 units/s, score 5005) x margin (**2**) = **6.95e11 units/s**, which is a score of about **6422** on the webgl2 scale (the integrated cap is 8000, so a score above the threshold is always allowed in discrete and below it always fits integrated).
- rate above the threshold: DISCRETE. Otherwise (or on the 2D canvas fallback, or with no rate): INTEGRATED. A masked card is never given a faster class than its speed supports, and a score is always kept to its class's cap.
- The saved result carries `classFromSpeed: true`; the re-run check does not compare that class with the pre-benchmark default (integrated), so it does not ask again and again. A different `gpuId`, benchmark version or a card that stops being masked still asks for a re-run.
- Risks: an iGPU more than twice as fast as the 8060S would be called discrete (none is known); a real discrete card slower than 6.95e11 units/s (about an RTX 3060 or weaker, by the placeholder rates) with a masked name is raced as integrated and its score is capped at 8000. The margin and the 8060S rate are the only numbers to tune.

The 8060S score was read twice on the owner's machine: 5005 (the RAW score, used here; below both class caps so raw = kept) and 4944. That is about 1 percent run-to-run variation (about 0.5 percent in rate terms on the log scale); the margin of 2 (a 100 percent rate gap) comfortably exceeds it. The class rule and `REFERENCE_CARDS` use the work RATE, which is the raw measurement, never the capped score.

The benchmark screen's neon look and its show phase (the rest of the song after the score is measured) do not touch the scored work: `tests/benchmark.test.mjs` pins the `BENCHMARK` numbers and a hash of the shader source, so the 8060S raw score of about 5005 stays valid.

## Formula lap times (phase 3)

Formula is calibrated the way Drag is: **the class sets the range, the score sets the place in it, the tune is worth a few percent.** The number is the lap of a PERFECT DRIVER (the autopilot's standing-start lap, `predictFormula`, from the green) on BEACH (4828 m, a plain banked oval you can drive flat out) with the DEFAULT tune. (BEACH was a tri-oval with a kink; it became a plain oval at the owner's request. The best car's lap is the same 38.07 s, flat out. A weak car now gains up to about 2 percent with no downforce, since it never needs it on a flat-out oval; the best card still needs it.)

**The targets (the owner's constants, one table: `TARGETS` in `tests/formula-calibration.test.mjs`; the test pins each within 0.3 s):**

| car | score | target lap |
|---|---|---|
| best discrete card (class cap) | 10000 | about 38 s (38.08) |
| Radeon 8060S, a strong iGPU (measured) | 5005 | about 47 s (47.00) |
| Samsung Galaxy S24 Ultra, phone (measured) | 1302 | about 51 s (51.02) |
| weakest integrated card | 0 | about 55 s (55.02) |
| NO BENCHMARK | - | about 58 s (58.00), slower than every benchmarked car |
| best integrated card (class cap) | 8000 | 44.5 s |
| weakest discrete card | 0 | 43.0 s |

The class gap is now 1.45x (weakest integrated 55 s against best discrete 38 s; it was 1.2x). As in Drag the best integrated card (44.5 s) is slower than the weakest discrete card (43.0 s). Discrete follows the SHAPE of Drag's discrete curve (steep at the bottom, flat at the top: 0.6 to 1.0 s per 1000 points below 3000, 0.13 s per 1000 points at the top).

**The table (default tune; "good tune" is gearing +0.4, downforce 0.3, tyre pressure +0.4, 2 bottles of nitro):**

| class | score | engine level | lap, default tune (s) | top speed (mph) | lap, good tune (s) | good tune gain |
|---|---|---|---|---|---|---|
| integrated | 0 | -1.444 | 55.02 | 199 | 53.33 | 3.1% |
| integrated | 500 | -0.829 | 53.47 | 204 | 51.85 | 3.0% |
| integrated | 1000 | -0.182 | 51.90 | 210 | 50.38 | 2.9% |
| integrated | 1302 | 0.217 | 51.02 | 214 | 49.50 | 3.0% |
| integrated | 1500 | 0.317 | 50.78 | 215 | 49.30 | 2.9% |
| integrated | 2000 | 0.568 | 50.23 | 218 | 48.77 | 2.9% |
| integrated | 2500 | 0.819 | 49.68 | 220 | 48.25 | 2.9% |
| integrated | 3000 | 1.07 | 49.17 | 222 | 47.75 | 2.9% |
| integrated | 3500 | 1.341 | 48.62 | 225 | 47.22 | 2.9% |
| integrated | 4000 | 1.612 | 48.07 | 227 | 46.70 | 2.8% |
| integrated | 4500 | 1.882 | 47.53 | 230 | 46.22 | 2.8% |
| integrated | 5000 | 2.153 | 47.02 | 232 | 45.72 | 2.8% |
| integrated | 5005 | 2.156 | 47.00 | 233 | 45.72 | 2.7% |
| integrated | 5500 | 2.382 | 46.60 | 235 | 45.30 | 2.8% |
| integrated | 6000 | 2.61 | 46.18 | 237 | 44.90 | 2.8% |
| integrated | 6500 | 2.839 | 45.77 | 239 | 44.52 | 2.7% |
| integrated | 7000 | 3.077 | 45.33 | 241 | 44.12 | 2.7% |
| integrated | 7500 | 3.314 | 44.92 | 243 | 43.73 | 2.6% |
| integrated | 8000 | 3.552 | 44.50 | 246 | 43.35 | 2.6% |
| discrete | 0 | 4.474 | 43.00 | 254 | 41.93 | 2.5% |
| discrete | 1000 | 5.163 | 41.93 | 261 | 40.93 | 2.4% |
| discrete | 2000 | 5.851 | 40.95 | 267 | 40.00 | 2.3% |
| discrete | 3000 | 6.305 | 40.30 | 272 | 39.42 | 2.2% |
| discrete | 4000 | 6.759 | 39.68 | 276 | 38.83 | 2.1% |
| discrete | 5000 | 7.055 | 39.30 | 279 | 38.47 | 2.1% |
| discrete | 6000 | 7.351 | 38.90 | 282 | 38.12 | 2.0% |
| discrete | 7000 | 7.566 | 38.63 | 284 | 37.85 | 2.0% |
| discrete | 8000 | 7.781 | 38.35 | 286 | 37.60 | 2.0% |
| discrete | 9000 | 7.89 | 38.22 | 287 | 37.47 | 2.0% |
| discrete | 10000 | 8 | 38.08 | 288 | 37.33 | 2.0% |
| no benchmark | - | -2.54 | 58.00 | 188 | 56.23 |

`PRINT_LAP_TABLE=1 node tests/formula-calibration.test.mjs` prints this table (pass the file to node directly: the test runner hides the printout).

**What sets the numbers, in the order to turn them** (all in `src/formula/car.ts` and `constants.ts` unless noted):

1. **The target laps** (`TARGETS` in the calibration test): the owner's numbers.
2. **`FORMULA_CLASS_WINDOWS`**: the engine level at the slowest card of each class and at the class cap. An engine level moves pull 9 percent and top speed 5 percent per level (the source game's `raceCarStats`) and may be negative: integrated is -1.444 (a 55 s lap) to 3.552 (44.5 s), discrete 4.474 (43 s) to 8 (38 s, the source's top engine). `UNBENCHMARKED_ENGINE` is -2.54 (a 58 s lap).
3. **`FORMULA_SCORE_TO_ENGINE`** (like Drag's `BENCHMARK_TO_SPEC`): the score as a share of the class cap to the share of the window, straight lines between rows. The rows are solved so the lap table hits the targets at the 1302 and 5005 rows and is smooth between them; a higher score is never slower (tested over every 50 points). To change a target: bisect the engine for the new lap (`engineForLap` in the calibration test), rewrite the window end or row, recopy the backend table.
4. **`TUNE_EFFECT`**: the tune (below).
5. **`FORMULA_FALLBACK_LEADERS`** (`src/leaderboard/formula-leader.ts`): integrated 44.4 s, discrete 38.0 s, the autopilot category +0.05 s. Each is just under the default-tune lap of the BEST card of its class (44.50 s and 38.08 s): a default tune on the best card fails to beat it by 0.10 s (0.08 s discrete), a good tune beats it by about 1.0 s (0.7 s discrete), a weaker card cannot. The autopilot leader is the same car, so the default-tune autopilot on the best card also just fails (by 0.05 s) and a tuned one wins. (Drag sets its leader from a card at 70 percent of the cap with a good tune; the owner asked for the best card here.)
6. **`FORMULA_LAP_TABLE`** (`backend/src/plausible.ts`): the server's windows, copied from the table above (`docs/LEADERBOARD.md`). `tests/formula-calibration.test.mjs` fails if the table drifts more than 0.12 s or 3 mph from the physics, or if any default, good or extreme tune leaves its window at a dense sweep of scores.

### Tune balance

The source game's tune was a straight line: gearing +1 (tall) made the BEACH lap 7 percent quicker (35.5 s against 38.1 s) and tyre pressure +1 (hard) 2.8 percent, so the best tune was "everything to the end" and a full search gained 10 to 11 percent. What changed:

- **Gearing and tyre pressure now have a best value inside their range.** Their TOP SPEED effect is `top * x - curve * x^2` (`TUNE_EFFECT.gearingTop/gearingCurve`: 5 percent and 6.25 percent; `pressureTop/pressureCurve`: 2.5 percent and 3.125 percent). That peaks at +0.4 and falls again past it (a gear that is too tall, or a tyre that is too hard, cannot reach its top speed in a lap): gearing +1 and pressure +1 are now slightly slower than neutral, short gears (-1) lose about 12 to 14 percent. Pull lost per +1 of gearing (12 percent) and grip lost per +1 of pressure (8 percent) are unchanged.
- **Unchanged from the source:** downforce (7 percent top speed, 30 percent grip per unit), steering (15 percent turn, 8 percent grip), nitro, the whole physics, the gearbox, the grip and the banking. Downforce already had a real optimum (about 0.3 to 0.4; 0 loses 18 percent) and the autopilot's line needs almost no extra steering, so steering is worth under 0.5 percent and nitro (2 bottles) about 0.4 percent.
- **Result:** the fixed good tune above is worth 2.0 percent of the lap at the best discrete card, 2.7 to 3.0 percent at the 8060S and S24 Ultra and 3.1 percent at the weakest integrated card (table). A coordinate search over the whole tune box (the test, and a wider one run while calibrating) finds a little more: 2.1 percent at the best discrete card, 2.4 to 3.1 percent in the middle and 3.4 to 3.6 percent at the weakest cards (a slow car wants less downforce: its best value moves from 0.4 to 0.1 to 0.2). The default tune (gearing 0, downforce 0.5, pressure 0) is therefore within 2 to 3.6 percent of the best, a sensible near-optimum; no single setting pushed to either end of its range gains more than 1 percent over the default (tested). Turn `TUNE_EFFECT` first to make the tune matter more or less; the test fails over 4.5 percent or under 1 percent.
- **The source comparison** (`tests/formula-autopilot.test.mjs`) stays at 3 percent, but its cases that set gearing or pressure (which the source made linear on purpose, so they no longer agree) were re-recorded from the live source with only downforce and steering set. The default-tune lap of the stock car (38.08 s) is unchanged.

### What is NOT validated

Everything above is the SIMULATION's perfect-driver lap on the default tune. Not yet seen: a real lap on the owner's 8060S and S24 Ultra (their measured scores, 5005 and 1302, map to 47 s and 51 s; the real cards will land on the same lap only if the score really sets the engine, which the code guarantees, but a human lap will be a few seconds slower than the autopilot's), how the rebalanced tune FEELS to drive (a real browser drive), and the discrete scores, whose card rates are placeholders. The backend table says so (`hardwareValidated: false`).
