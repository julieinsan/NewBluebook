-- Practice-app pause: freeze whichever clock is active (module or break) until resume.
-- Intentionally diverges from real Bluebook, where module time never stops.

ALTER TABLE test_attempts ADD COLUMN paused_at TEXT;
ALTER TABLE test_attempts ADD COLUMN paused_phase TEXT
  CHECK (paused_phase IS NULL OR paused_phase IN ('rw:1', 'rw:2', 'break', 'math:1', 'math:2'));
ALTER TABLE test_attempts ADD COLUMN rw_module1_pause_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE test_attempts ADD COLUMN rw_module2_pause_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE test_attempts ADD COLUMN break_pause_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE test_attempts ADD COLUMN math_module1_pause_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE test_attempts ADD COLUMN math_module2_pause_seconds INTEGER NOT NULL DEFAULT 0;
