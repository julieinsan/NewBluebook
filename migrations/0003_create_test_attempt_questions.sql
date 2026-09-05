-- Join table: which questions appeared in which attempt/module, in what order, with the user's work.
CREATE TABLE test_attempt_questions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id            INTEGER NOT NULL REFERENCES test_attempts (id),
  question_id           TEXT NOT NULL REFERENCES questions (id),
  module                INTEGER NOT NULL CHECK (module IN (1, 2)),
  section               TEXT NOT NULL CHECK (section IN ('rw', 'math')),
  order_index           INTEGER NOT NULL,
  user_answer           TEXT,
  is_correct            INTEGER CHECK (is_correct IN (0, 1)),
  flagged               INTEGER NOT NULL DEFAULT 0 CHECK (flagged IN (0, 1)),
  crossed_out_choices   TEXT,   -- json array of eliminated choice letters
  highlights            TEXT,   -- json array of highlight/annotation spans
  UNIQUE (attempt_id, module, order_index)
);

CREATE INDEX idx_taq_attempt ON test_attempt_questions (attempt_id);
CREATE INDEX idx_taq_question ON test_attempt_questions (question_id);
