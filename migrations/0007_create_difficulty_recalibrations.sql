-- Standalone reference table loaded from `Copy of difficulty_changes.csv` (Story 1.4).
-- Deliberately NOT foreign-keyed to `questions`: the supplied CSV's question IDs do not
-- overlap with the current question bank. It exists so a future, larger official bank
-- import can look up recalibrations by ID if/when IDs do match.
CREATE TABLE difficulty_recalibrations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id         TEXT NOT NULL,
  previous_difficulty TEXT CHECK (previous_difficulty IS NULL OR previous_difficulty IN ('easy', 'medium', 'hard')),
  new_difficulty      TEXT CHECK (new_difficulty IS NULL OR new_difficulty IN ('easy', 'medium', 'hard')),
  domain              TEXT,
  skill               TEXT
);

CREATE INDEX idx_difficulty_recalibrations_question ON difficulty_recalibrations (question_id);
