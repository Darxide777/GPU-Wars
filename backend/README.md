# GPU Wars leaderboard backend

Cloudflare Worker + D1 (SQLite), TypeScript. Fits the Cloudflare free tier (see `../docs/LEADERBOARD.md`).

**This repository is public.** Never commit account ids, tokens, `.env`/`.dev.vars`, or salts. The `database_id` in
`wrangler.toml` is a placeholder; secrets live in `wrangler secret put`.

## Endpoints (JSON)
- `POST /scores` submit a run (see `src/validate.ts`, `ScoreSubmission`). 200 `{ok, classRank, verified}`, 422 invalid, 413 too big, 429 rate limited, 403 origin.
- `GET /leaderboard?scope=overall|class&class=<id>&category=manual|autopilot&limit=25` best ET per player, fastest first (limit max 100).
- `GET /leader?class=<id>&category=manual|autopilot` full record of the class leader (splits, seed, tune, ghost) for building the ghost. 404 if none.
- `GET /classes` list of class ids.

Class ids live in `src/classes.ts` (dependency free, importable by the game): `integrated` and `discrete` for now. Reads (`GET`) allow any origin; `POST /scores` only the allowed origins.

## Develop and test
    cd backend && npm install
    npm run typecheck && npm test      # tests use an in-memory SQLite shim (node:sqlite, Node 22+), no Cloudflare login
    npm run migrate:local && npm run dev

## Deploy (free Cloudflare account)
1. `npm install && npx wrangler login`
2. `npx wrangler d1 create gpu-wars-leaderboard`, then paste the printed `database_id` into `wrangler.toml` locally. Do not commit the real id if you prefer to keep it private (use `--config wrangler.local.toml`, which is git-ignored).
3. `npm run migrate:remote` (applies `migrations/*.sql`).
4. Optional secrets: `npx wrangler secret put HASH_SALT` and `npx wrangler secret put BLOCKED_WORDS` (comma separated).
5. Edit `ALLOWED_ORIGINS` (exact origins, comma separated) in `[vars]`; `https://*.itch.zone` is allowed via `ALLOW_ITCH_ZONE_WILDCARD`.
6. `npm run deploy`. The game then uses the printed `https://gpu-wars-leaderboard.<subdomain>.workers.dev` URL.

## Anti-cheat notes
Client-reported times are only checked for shape, per-class plausible bounds, split consistency and rate limits.
`verifyBySimulation` in `src/validate.ts` is the documented hook for later deterministic re-simulation; rows carry `verified` (0 for now).
Player identity is the name (case-insensitive): anyone can submit under any name, but a name's stored time only ever improves.

## Updating a live database (the two-class change)
Migration `migrations/0002_two_classes.sql` turns every old `discrete-<vendor>-<era>` row into `discrete` (best ET per player and category kept). On an existing deployment run, in this order:

    cd backend && npm run migrate:remote     # applies 0002 once
    npm run deploy                           # ships the Worker that only knows integrated and discrete

The committed `wrangler.toml` keeps the placeholder `database_id`: paste the real one into your local copy to run these two commands, and do not commit it.
