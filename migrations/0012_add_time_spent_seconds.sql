-- Story 3.7: cumulative active-view seconds per served question.
ALTER TABLE test_attempt_questions
  ADD COLUMN time_spent_seconds INTEGER NOT NULL DEFAULT 0 CHECK (time_spent_seconds >= 0);
