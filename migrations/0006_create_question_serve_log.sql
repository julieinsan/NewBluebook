-- Records every time a question is served to the user, powering least-recently-used
-- recycling once a domain's fresh (never-served) pool is exhausted (see PRD Section 3.3/2.2).
CREATE TABLE question_serve_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id TEXT NOT NULL REFERENCES questions (id),
  attempt_id  INTEGER REFERENCES test_attempts (id),
  session_id  INTEGER REFERENCES drill_sessions (id),
  served_at   TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (attempt_id IS NOT NULL OR session_id IS NOT NULL)
);

-- Required: serve log lookups by question_id (drives the LRU selection query).
CREATE INDEX idx_serve_log_question ON question_serve_log (question_id);
