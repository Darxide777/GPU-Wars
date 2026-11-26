-- Two classes only: 'integrated' and 'discrete'. Every old 'discrete-<vendor>-<era>' row becomes 'discrete'.
-- A player may hold several old discrete rows for one category (one per vendor/era); only the best ET is kept
-- (ties: the older run, then the lower id), so the UNIQUE (player_key, class_id, category) rule still holds.
-- Safe to run twice: the second run finds nothing to change. Rows of 'integrated' are not touched.

-- 1. delete every discrete row that is not the best one of its player and category
DELETE FROM scores WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY player_key, category
      ORDER BY quarter_et ASC, created_at ASC, id ASC
    ) AS rn
    FROM scores
    WHERE class_id = 'discrete' OR class_id LIKE 'discrete-%'
  ) WHERE rn > 1
);

-- 2. rename the survivors
UPDATE scores SET class_id = 'discrete' WHERE class_id LIKE 'discrete-%';
