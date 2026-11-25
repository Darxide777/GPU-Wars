-- Best run per player per class and category. One row each; only improved ETs replace it.
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_key TEXT NOT NULL,        -- lower-cased sanitized name
  player_name TEXT NOT NULL,       -- display name
  class_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('manual','autopilot')),
  quarter_et REAL NOT NULL,        -- seconds, the ranking key
  trap_speed REAL NOT NULL,        -- mph
  reaction_time REAL NOT NULL,
  split_60ft REAL NOT NULL,
  split_330 REAL NOT NULL,
  split_eighth REAL NOT NULL,
  split_1000 REAL NOT NULL,
  benchmark_score REAL NOT NULL,
  benchmark_version TEXT NOT NULL,
  gpu_id TEXT NOT NULL,
  seed INTEGER NOT NULL,
  tune_json TEXT NOT NULL,
  ghost_json TEXT,                 -- compact samples, optional
  verified INTEGER NOT NULL DEFAULT 0, -- 1 once full re-simulation passes (future)
  created_at INTEGER NOT NULL,
  UNIQUE (player_key, class_id, category)
);
CREATE INDEX IF NOT EXISTS idx_scores_board ON scores (class_id, category, quarter_et);
CREATE INDEX IF NOT EXISTS idx_scores_overall ON scores (category, quarter_et);

-- Fixed-window rate limiter counters (keys are hashed client ids).
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  window INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window)
);
