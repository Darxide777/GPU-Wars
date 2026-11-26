# GPU Wars leaderboard

Backend code: `backend/` (Cloudflare Worker + D1). Deploy steps: `backend/README.md`.

## Class ids (`backend/src/classes.ts`)
Class = `integrated` or `discrete`. Two classes for now; there is no vendor or generation split. The list is ONE file (`CLASS_IDS`, `CLASS_BOUNDS`), imported by the game too, so more classes can be added later (the steps are under "Adding a class" in `docs/ARCHITECTURE.md`).

| Class id | Min plausible quarter ET (s) | Max trap speed (mph) |
|---|---|---|
| `integrated` | 8.5 | 170 |
| `discrete` | 3.6 | 370 |

Max ET to rank is 30 s, min trap speed 60 mph for all. These bounds follow the simulation (see `docs/CALIBRATION.md`) and are retuned there. Categories: `manual`, `autopilot` (separate boards).

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
- One row per (player, class, category), best ET kept; overall board = best row per player.
- Rate limit: per hashed IP and per `X-Client-Id`, fixed one-minute window in D1 (`RATE_LIMIT_PER_MINUTE`).
- Ghost samples are optional `[seconds, feet]` pairs, max 256.
