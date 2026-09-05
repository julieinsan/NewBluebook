-- Question bank: R&W and Math questions, imported by Epic 1 ingestion scripts.
CREATE TABLE questions (
  id                TEXT PRIMARY KEY,                 -- source question ID where available
  section           TEXT NOT NULL CHECK (section IN ('rw', 'math')),
  domain            TEXT NOT NULL,
  skill             TEXT NOT NULL,
  difficulty        TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  question_type     TEXT NOT NULL CHECK (question_type IN ('mc', 'grid_in')),
  stimulus_text     TEXT NOT NULL,                     -- passage or math problem text (markdown/LaTeX)
  choice_a          TEXT,                              -- null for grid_in
  choice_b          TEXT,
  choice_c          TEXT,
  choice_d          TEXT,
  correct_answer    TEXT NOT NULL,                     -- letter, or value(s) for grid_in
  rationale         TEXT,
  figure_asset_path TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Required: question lookups by (section, domain, skill, difficulty) for assembly/selection.
CREATE INDEX idx_questions_lookup ON questions (section, domain, skill, difficulty);
