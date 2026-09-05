-- Practice Test 1 vs 2 selection (PRD §3.3 bank capacity).
ALTER TABLE test_attempts ADD COLUMN practice_test INTEGER NOT NULL DEFAULT 1
  CHECK (practice_test IN (1, 2));
