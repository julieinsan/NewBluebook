-- Records WHEN each section's Module 1 was declared finished by the student, which is a
-- distinct event from answers merely being saved. Story 3.2 persists each answer as it's
-- given (so a mid-module refresh doesn't lose work), so the presence of `user_answer`
-- values can never mean "this module is done" -- only these columns can.
--
-- They are the guard `assembleModule2ForSection` checks before scoring: without them an
-- unsubmitted (or half-answered) Module 1 scores 0/27 and silently routes the student to
-- the "easier" Module 2. Null = not yet submitted; set once, never cleared.
ALTER TABLE test_attempts ADD COLUMN rw_module1_submitted_at   TEXT;
ALTER TABLE test_attempts ADD COLUMN math_module1_submitted_at TEXT;
