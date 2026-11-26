# GPU Wars leaderboard

Backend code: `backend/` (Cloudflare Worker + D1). Deploy steps: `backend/README.md`.

## Modes and tracks (migration `0003_modes.sql`)
A score belongs to a **mode** (`drag` or `formula`) and a **track** (`strip` for drag, `beach` for formula; data in `TRACKS` in `backend/src/classes.ts`). A player has one best row per (player, mode, track, class, category). A request that names no mode or track is drag on the strip, so an old game build keeps working unchanged.

| | drag | formula |
|---|---|---|
| ranking time | quarter-mile ET | one lap from a standing start |
| splits sent | `ft60, ft330, eighth, ft1000, quarter` | `sector1, sector2, lap` (elapsed seconds at the end of each, `lap` is the lap time) |
| speed sent | `trapSpeed` (mph) | `topSpeed` (mph) |
| reaction time | required | optional (0) |
| ghost samples | `[seconds, feet]`, max 1400 ft / 40 s | `[seconds, metres along the lap]`, max 20000 m / 240 s |

- `POST /scores` takes optional `mode` and `track`. Unknown mode, or a track that does not belong to the mode, is a 422. A drag body is validated exactly as before.
- `GET /leaderboard` and `GET /leader` take optional `mode` and `track` (default `drag`/`strip`; unknown values are a 400). Every row now also carries `mode`, `track` and `timeS` (the ranking time in both modes). Drag rows keep `quarterEt` and `trapSpeed`; formula rows have `topSpeed` and, from `/leader`, `splits: {sector1, sector2, lap}`. The overall board is per mode and track.
- `GET /modes` lists the modes with their tracks, default track and metric. `GET /classes` is unchanged. Rate limiting is unchanged (a formula POST counts like a drag POST).
- **Storage choice:** the ranking time stays in the existing column `quarter_et` for both modes (the API calls it `timeS`) instead of a rename or a second column. Every index, the ranking queries, `/leader` and the Worker that is live now already use it, so the old Worker keeps reading the migrated table, and nothing has to be copied. The cost is a column name that reads drag-specific; the migration header and the `MODE_METRIC` table say what it means. The drag split columns are NULL for formula rows, whose sector times live in `sectors_json`.
- **Formula numbers are PLACEHOLDERS.** Everything the server checks for a lap (outer lap and top-speed bounds per class, a lap/top-speed curve by benchmark score, tolerances, sector shares, track length, ghost limits) is in ONE table, `FORMULA_PLACEHOLDER_TABLE` in `backend/src/plausible.ts`, flagged `placeholder: true`. They are generous guesses so the shape works today; phase 3 replaces them with numbers measured from the formula physics. The checks are: lap inside the class window for the score, top speed inside its window, sector 1 and sector 2 end at believable shares of the lap, and the lap's average speed fits the top speed (a backstop at the moment).

## How to deploy the mode change (the owner runs this)
The live deployment serves drag only. Order matters: **migrate first, then deploy, back to back.**

    git pull
    cd backend
    npm install
    # your local wrangler.toml needs YOUR real database_id (never commit it; the committed file keeps the all-zero placeholder)
    npm run migrate:remote      # applies 0003_modes.sql once (all rows become drag/strip)
    npm run deploy

- Between the two commands the OLD Worker still reads fine, but its score upsert names the old unique key, which no longer exists, so a submit in that window fails with an error (the game shows it and the player can retry). Keep the gap short. Do not deploy first: the new Worker needs the new columns.
- `0003_modes.sql` is applied once (wrangler records it). Running the file again fails at its first statement ("table already exists") and changes nothing; it cannot drop the migrated table twice.
- Nothing needs to change in the game's configuration; an old game build keeps submitting and reading drag.
- To roll back, deploy the previous Worker version; the migrated table still serves drag reads, but drag submits from the old Worker stay refused until a migration restores the old unique key.

## Class ids (`backend/src/classes.ts`)
Class = `integrated` or `discrete`. Two classes for now; there is no vendor or generation split. The list is ONE file (`CLASS_IDS`, `CLASS_BOUNDS`), imported by the game too, so more classes can be added later (the steps are under "Adding a class" in `docs/ARCHITECTURE.md`).

| Class id | Min plausible quarter ET (s) | Max trap speed (mph) |
|---|---|---|
| `integrated` | 8.2 | 170 |
| `discrete` | 3.6 | 370 |

Those are the OUTER limits. Inside them the server runs a score-aware check (`backend/src/plausible.ts`): the submission carries `benchmarkScore` and `class`, and a lookup table (`SCORE_CURVE`, from the physics, linear interpolation) gives the fastest and slowest believable ET, a trap speed window and 60 ft / 1/8 mile floors for that score. Fast edge = default-tune ET minus 0.5 s (a good tune) minus 0.1 s (physics margin); slow edge = ET x 1.25 + 1.5 s + 0.12 s (autopilot). The ranked day is fixed, so there is no weather allowance. So a score-1000 discrete card cannot post 3.7 s (its fastest is about 5.6 s), while 4.1 s at score 10000 is fine. A score above the class cap (8000 integrated, 10000 discrete) is refused. Every refusal is a 422 with a plain reason, e.g. `quarter ET 3.70 s is faster than plausible for a card of class discrete with benchmark score 1000 (fastest 5.63 s)`. `tests/score-bounds.test.mjs` sweeps the game physics (default and good tune) against the window, so the table cannot drift unnoticed; after a physics change copy the new rows into `SCORE_CURVE`.

What the server can and cannot verify: `benchmarkScore` is reported by the client. The check stops a card from claiming a time far beyond its score, but a modified client can still report a spoofed high score (up to the class cap) and then a matching time. Future options: re-simulate the run on the server (see below), or keep a per-GPU score sanity table (the score a given `gpuId` can plausibly reach) and refuse scores far above it.

Everything in this document before "Free-tier limits" that mentions ET describes DRAG; formula's checks are in "Modes and tracks". Max ET to rank is 30 s, min trap speed 60 mph for all. These bounds follow the simulation (see `docs/CALIBRATION.md`) and are retuned there. Categories: `manual`, `autopilot` (separate boards).

## Old rows (migration `0002_two_classes.sql`)
The first deployment had 17 class ids (`integrated` and `discrete-<amd|nvidia|intel|other>-<retro|classic|modern|current>`). Migration 0002 maps every `discrete-*` id to `discrete` and, for each player and category, keeps only the best ET (ties: the older run). `npm run migrate:remote` applies it once (wrangler records applied migrations); it is also safe to run twice. Run it BEFORE `npm run deploy`, or between the two the old Worker simply sees the new ids as unknown classes on its boards. It is tested with the in-memory shim (`backend/test/api.test.ts`).

## Free-tier limits (checked 2026-11-25, developers.cloudflare.com)
Workers Free: 100,000 requests/day (resets 00:00 UTC), **10 ms CPU per request**, 50 subrequests, 128 MB memory.
D1 Free: 5 million rows read/day, 100,000 rows written/day, 5 GB total storage, 500 MB per database, 10 databases, 50 queries per invocation.

Budget: a submit costs about 3 to 5 D1 writes (rate-limit counters x2, score upsert) so roughly 20,000+ submissions/day; reads use indexes. Leaderboard reads are cheap; consider `Cache-Control` or the Cache API if traffic grows.

## Would full re-simulation fit the free CPU limit?
Unlikely on Free. A quarter-mile run is roughly 4-6 simulated seconds; at a 120 Hz fixed step that is about 500-700 steps. If one step is a few microseconds of plain TS, a run costs a few ms, which could fit 10 ms, but the physics (drivetrain, tyre, clutch, wind, etc.) is likely heavier and cold start parsing also counts. Estimate only; measure once the physics is pure TS. Options if it exceeds 10 ms: Workers Paid (30 s default CPU), run a coarser verification step (for example 60 Hz plus an ET tolerance), verify asynchronously via Queues/cron in batches, or verify only runs that would enter the top N of a class. The hook `verifyBySimulation` and the stored `seed`, `tune`, `benchmarkScore`, `benchmarkVersion` and `class` make this possible later.

## Design notes
- CORS: reads (`GET /classes`, `/leaderboard`, `/leader`) answer ANY origin with `Access-Control-Allow-Origin: *` (public data, no cookies; itch.io games run from several hosts) and may be cached by the browser for 10 s (`/classes`: 1 h). The preflight of a GET is answered for any origin. `POST /scores` and its preflight stay limited to `ALLOWED_ORIGINS` and the itch.zone wildcard. The game sends no custom header on GETs, so they need no preflight at all.
- One row per (player, mode, track, class, category), best time kept; overall board = best row per player within a mode and track.
- Rate limit: per hashed IP and per `X-Client-Id`, fixed one-minute window in D1 (`RATE_LIMIT_PER_MINUTE`).
- The game's LEADERBOARD screen reads `GET /leaderboard?scope=overall|class&category=...&limit=100` (one request per board per minute, cached in the client; see `docs/ARCHITECTURE.md`). A 429 from the board is shown as "slow down, retry". The screen needs no backend change; a "my rank when outside the top 100" line would need a new endpoint.
- Ghost samples are optional `[seconds, feet]` pairs, max 256.
