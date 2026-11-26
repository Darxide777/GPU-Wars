-- Game modes and tracks. A score now belongs to a MODE ('drag' or 'formula') and a TRACK ('strip' for drag, 'beach' for formula).
-- One best row per (player_key, mode, track_id, class_id, category). Every existing row becomes drag on the strip.
--
-- The ranking number keeps its old column name `quarter_et` in BOTH modes (drag: quarter-mile ET, formula: lap time, seconds). A rename would break the Worker
-- that is live now for as long as the old and new versions overlap, and every index and query already uses it; the API exposes it as `timeS`.
-- Formula rows keep their three sector times in `sectors_json` and their top speed in `trap_speed`; the drag-only split columns are NULL for them,
-- so the split_* columns and reaction_time are no longer NOT NULL.
--
-- SQLite cannot change a UNIQUE constraint in place, so the table is rebuilt: create the new table, copy, drop the old one, rename, make the indexes.
-- Run ORDER: apply this migration, THEN deploy the new Worker, back to back. The old Worker keeps READING fine on the new table, but its score upsert names the
-- old unique key and is refused by SQLite until the new Worker is deployed (a few seconds to minutes of failed submits; the game just shows an error).
-- Deploying the new Worker first would fail all reads, so do not.
--
-- Re-running: the first statement creates a marker table WITHOUT "IF NOT EXISTS" on purpose. Running this file twice stops at that statement with
-- "table already exists" before anything else happens, so a second run can never drop the finished table. wrangler also records applied migrations and skips them.

CREATE TABLE migration_0003_modes_done (applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS scores_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_key TEXT NOT NULL,        -- lower-cased sanitized name
  player_name TEXT NOT NULL,       -- display name
  mode TEXT NOT NULL DEFAULT 'drag' CHECK (mode IN ('drag','formula')),
  track_id TEXT NOT NULL DEFAULT 'strip',
  class_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('manual','autopilot')),
  quarter_et REAL NOT NULL,        -- seconds, the ranking key: quarter-mile ET (drag) or lap time (formula)
  trap_speed REAL NOT NULL,        -- mph: trap speed (drag) or top speed (formula)
  reaction_time REAL NOT NULL DEFAULT 0,
  split_60ft REAL,                 -- drag splits; NULL for formula
  split_330 REAL,
  split_eighth REAL,
  split_1000 REAL,
  sectors_json TEXT,               -- formula: {"sector1":s,"sector2":s,"lap":s}; NULL for drag
  benchmark_score REAL NOT NULL,
  benchmark_version TEXT NOT NULL,
  gpu_id TEXT NOT NULL,
  seed INTEGER NOT NULL,
  tune_json TEXT NOT NULL,
  ghost_json TEXT,                 -- compact samples, optional
  verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (player_key, mode, track_id, class_id, category)
);

INSERT OR IGNORE INTO scores_v3 (id, player_key, player_name, mode, track_id, class_id, category, quarter_et, trap_speed, reaction_time,
    split_60ft, split_330, split_eighth, split_1000, sectors_json, benchmark_score, benchmark_version, gpu_id, seed, tune_json, ghost_json, verified, created_at)
  SELECT id, player_key, player_name, 'drag', 'strip', class_id, category, quarter_et, trap_speed, reaction_time,
    split_60ft, split_330, split_eighth, split_1000, NULL, benchmark_score, benchmark_version, gpu_id, seed, tune_json, ghost_json, verified, created_at
  FROM scores;

DROP TABLE scores;
ALTER TABLE scores_v3 RENAME TO scores;

-- The board index: one board is (mode, track, class, category) ordered by time. The overall board is (mode, track, category) ordered by time.
CREATE INDEX IF NOT EXISTS idx_scores_board ON scores (mode, track_id, class_id, category, quarter_et);
CREATE INDEX IF NOT EXISTS idx_scores_overall ON scores (mode, track_id, category, quarter_et);
