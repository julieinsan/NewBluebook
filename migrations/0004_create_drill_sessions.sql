-- Untimed drill mode session (domain/skill/difficulty targeted practice).
CREATE TABLE drill_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  filters    TEXT   -- json: { domain, skill, difficulty }
);
