-- Join table: which questions appeared in a drill session, with instant-feedback results.
CREATE TABLE drill_session_questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES drill_sessions (id),
  question_id TEXT NOT NULL REFERENCES questions (id),
  user_answer TEXT,
  is_correct  INTEGER CHECK (is_correct IN (0, 1))
);

CREATE INDEX idx_dsq_session ON drill_session_questions (session_id);
CREATE INDEX idx_dsq_question ON drill_session_questions (question_id);
