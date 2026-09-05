-- Epic 3 timing state: when each module's clock started, when each Module 2 finished,
-- and when the section break began. All nullable, all set once and never cleared, all
-- written write-if-null by a Route Handler (never during render -- see the plan's D3a):
-- a stamp that could be re-written would reset a running countdown on every refresh.
--
-- `{section}_module{1,2}_started_at` is the server's timer authority. The deadline is
-- derived (`started_at` + the section's blueprint limit), never stored, so a refresh
-- recovers the true remaining time and the client can correct for clock skew instead of
-- owning a countdown nobody can audit.
--
-- `break_started_at` does the same job for the 10-minute inter-section break: stamped
-- when R&W Module 2 ends, so the break screen counts down against a server fact rather
-- than a page-load time.
--
-- `{section}_module2_submitted_at` is the counterpart to migration 0008's Module 1
-- columns, and closes the last gap in derivable progress: with it, "this section is
-- done" and "this attempt is done" follow from `test_attempts` alone, with no counting
-- of answered `test_attempt_questions` rows -- which would have been wrong anyway, since
-- answers are saved continuously while a module is still in progress.
--
-- Note there is no `rw_module1_started_at` equivalent for a "test started" stamp:
-- `test_attempts.started_at` (migration 0002) already exists and means "the attempt row
-- was created". The R&W Module 1 clock is a separate fact and gets its own column.
ALTER TABLE test_attempts ADD COLUMN rw_module1_started_at     TEXT;
ALTER TABLE test_attempts ADD COLUMN rw_module2_started_at     TEXT;
ALTER TABLE test_attempts ADD COLUMN math_module1_started_at   TEXT;
ALTER TABLE test_attempts ADD COLUMN math_module2_started_at   TEXT;
ALTER TABLE test_attempts ADD COLUMN rw_module2_submitted_at   TEXT;
ALTER TABLE test_attempts ADD COLUMN math_module2_submitted_at TEXT;
ALTER TABLE test_attempts ADD COLUMN break_started_at          TEXT;
