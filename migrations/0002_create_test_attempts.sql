-- A single full-length practice test attempt (R&W + Math, two modules each).
CREATE TABLE test_attempts (
  id                             INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at                     TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at                   TEXT,
  status                         TEXT NOT NULL DEFAULT 'in_progress'
                                   CHECK (status IN ('in_progress', 'submitted')),
  -- Module 1 is always the fixed, non-adaptive baseline module for each section.
  rw_module1_difficulty_path     TEXT NOT NULL DEFAULT 'fixed' CHECK (rw_module1_difficulty_path = 'fixed'),
  math_module1_difficulty_path   TEXT NOT NULL DEFAULT 'fixed' CHECK (math_module1_difficulty_path = 'fixed'),
  -- Module 2 path is set once Module 1 is scored (>=60% correct -> harder, else easier).
  rw_module2_difficulty_path     TEXT CHECK (rw_module2_difficulty_path IS NULL OR rw_module2_difficulty_path IN ('easier', 'harder')),
  math_module2_difficulty_path   TEXT CHECK (math_module2_difficulty_path IS NULL OR math_module2_difficulty_path IN ('easier', 'harder')),
  rw_scaled_score                INTEGER,
  math_scaled_score              INTEGER,
  total_scaled_score             INTEGER
);
