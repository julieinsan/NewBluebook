-- Story 6.4: cumulative active-view seconds per drill question (same semantics as Story 3.7).
ALTER TABLE drill_session_questions
  ADD COLUMN time_spent_seconds INTEGER NOT NULL DEFAULT 0 CHECK (time_spent_seconds >= 0);
