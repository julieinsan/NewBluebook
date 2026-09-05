/**
 * Unit tests for Epic 3's attempt state machine and read models (`lib/attemptState.ts`).
 *
 * Four things here are load-bearing rather than routine:
 *
 *  1. **The lifecycle walk.** `resolveCurrentPosition` is the single thing every test
 *     route redirects against (D4). If it is wrong at one step, the student is either
 *     stuck or teleported.
 *  2. **The D10 window.** `math_module2_submitted_at` is set but `status` is still
 *     `in_progress`, because finishing is two writes and only the first has landed. The
 *     attempt must read as finished; keying off `status` would drop the student back
 *     into a finalized module.
 *  3. **The runner payload must not carry correctness.** D1 ships a whole module to the
 *     browser mid-test, so the assertion is made on the *serialized* payload, which is
 *     what actually crosses the wire -- not on the TypeScript type, which is erased.
 *  4. **Deadlines under a non-UTC process timezone.** This file sets `TZ` to US Eastern
 *     precisely because a UTC-only run cannot see plan §6 rule 7's bug: `datetime('now')`
 *     writes UTC with no zone marker and V8 reads it as local time.
 *
 * Uses an in-memory SQLite DB built from the real migration files, so nothing here
 * touches `data/bluebook.db`.
 *
 * Stamps are written with direct UPDATEs rather than through the transition functions:
 * those are Task 1.1's file, being written in parallel, and this module's contract is
 * with the *columns* (migrations 0008/0009), not with whoever writes them. The column
 * names come from `testFlow.ts`'s accessors, so a rename cannot leave these tests
 * asserting against a column nothing writes any more.
 *
 * Run with: `npm test`.
 */

// Set before any date work happens. node:test runs each test file in its own process,
// so this cannot leak into another suite, and Node re-reads TZ on assignment. Any value
// with a non-zero UTC offset would do; US Eastern is the machine timezone where the
// 240-minute skew in plan §6 rule 7 was originally measured.
process.env.TZ = "America/New_York";

import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";
import { BLUEPRINT, type ModuleNumber, type Section } from "./blueprint";
import { startNewAttempt, saveAnswer, readModuleQuestions } from "./attemptService";
import {
  BREAK_STARTED_AT_COLUMN,
  breakPath,
  moduleStartedAtColumn,
  moduleSubmittedAtColumn,
  runnerPath,
  submittedPath,
  type ModulePosition,
} from "./testFlow";
import {
  getAttemptState,
  getRunnerModule,
  listAttempts,
  resolveCurrentPosition,
} from "./attemptState";

/** Generous per-(domain, difficulty) supply so no domain is ever the constraint. */
const PER_BUCKET = 20;

/**
 * Marker strings on every seeded question, so a leak test can look for the *content* of
 * a forbidden field and not only for its key.
 */
const SECRET_RATIONALE = "LEAK-CANARY-RATIONALE";
const SECRET_SKILL = "LEAK-CANARY-SKILL";

function makeTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const insert = db.prepare(
    `INSERT INTO questions
      (id, section, domain, skill, difficulty, question_type, stimulus_text,
       choice_a, choice_b, choice_c, choice_d, correct_answer, rationale)
     VALUES (?, ?, ?, ?, ?, 'mc', 'stub stimulus', 'a', 'b', 'c', 'd', 'A', ?)`,
  );

  for (const section of ["rw", "math"] as Section[]) {
    for (const { domain } of BLUEPRINT[section].domains) {
      for (const difficulty of ["easy", "medium", "hard"] as const) {
        for (let i = 0; i < PER_BUCKET; i++) {
          insert.run(
            `${section}-${domain}-${difficulty}-${i}`,
            section,
            domain,
            SECRET_SKILL,
            difficulty,
            SECRET_RATIONALE,
          );
        }
      }
    }
  }

  return db;
}

/**
 * Writes one timing stamp directly. The column name is interpolated, which is safe only
 * because it comes from `testFlow.ts`'s closed map of literals -- never from input.
 */
function stamp(
  db: Database.Database,
  attemptId: number,
  column: string,
  value = "2026-09-05 14:23:11",
): void {
  db.prepare(`UPDATE test_attempts SET ${column} = ? WHERE id = ?`).run(value, attemptId);
}

function startModule(
  db: Database.Database,
  attemptId: number,
  section: Section,
  module: ModuleNumber,
  value?: string,
): void {
  stamp(db, attemptId, moduleStartedAtColumn(section, module), value);
}

function endModule(
  db: Database.Database,
  attemptId: number,
  section: Section,
  module: ModuleNumber,
): void {
  stamp(db, attemptId, moduleSubmittedAtColumn(section, module));
  // endModule1 stamps the next module's clock in the same transition.
  if (module === 1) {
    startModule(db, attemptId, section, 2);
  }
}

function positionOf(db: Database.Database, attemptId: number): ModulePosition {
  return resolveCurrentPosition(getAttemptState(db, attemptId));
}

/** Default pause fields for hand-built AttemptState fixtures. */
const PAUSE_FIELDS = {
  pausedAt: null,
  pausedPhase: null,
  rwModule1PauseSeconds: 0,
  rwModule2PauseSeconds: 0,
  breakPauseSeconds: 0,
  mathModule1PauseSeconds: 0,
  mathModule2PauseSeconds: 0,
} as const;

// ---------------------------------------------------------------------------
// getAttemptState
// ---------------------------------------------------------------------------

test("getAttemptState reads a fresh attempt as entirely unstamped", () => {
  const db = makeTestDb();
  const { attemptId } = startNewAttempt(db);

  const state = getAttemptState(db, attemptId);

  assert.equal(state.attemptId, attemptId);
  assert.equal(state.status, "in_progress");
  assert.ok(state.startedAt, "the attempt row's own started_at defaults to datetime('now')");
  assert.equal(state.submittedAt, null);
  assert.equal(state.breakStartedAt, null);

  for (const section of ["rw", "math"] as Section[]) {
    assert.deepEqual(state[section], {
      section,
      module1StartedAt: null,
      module1SubmittedAt: null,
      module2StartedAt: null,
      module2SubmittedAt: null,
      module2DifficultyPath: null,
    });
  }
});

test("getAttemptState reflects every stamp it is asked to carry", () => {
  const db = makeTestDb();
  const { attemptId } = startNewAttempt(db);

  startModule(db, attemptId, "rw", 1, "2026-09-05 10:00:00");
  endModule(db, attemptId, "rw", 1);
  startModule(db, attemptId, "rw", 2, "2026-09-05 10:40:00");
  stamp(db, attemptId, BREAK_STARTED_AT_COLUMN, "2026-09-05 11:15:00");
  db.prepare("UPDATE test_attempts SET rw_module2_difficulty_path = 'harder' WHERE id = ?").run(
    attemptId,
  );

  const state = getAttemptState(db, attemptId);

  assert.equal(state.rw.module1StartedAt, "2026-09-05 10:00:00");
  assert.equal(state.rw.module2StartedAt, "2026-09-05 10:40:00");
  assert.equal(state.rw.module2DifficultyPath, "harder");
  assert.equal(state.breakStartedAt, "2026-09-05 11:15:00");
  assert.equal(state.math.module1StartedAt, null, "Math is untouched by R&W's stamps");
});

test("getAttemptState throws for an attempt that does not exist", () => {
  const db = makeTestDb();
  assert.throws(() => getAttemptState(db, 9999), /does not exist/);
});

// ---------------------------------------------------------------------------
// resolveCurrentPosition (D4, D10)
// ---------------------------------------------------------------------------

test("resolveCurrentPosition walks the whole lifecycle in order", () => {
  const db = makeTestDb();
  const { attemptId } = startNewAttempt(db);

  assert.deepEqual(
    positionOf(db, attemptId),
    { kind: "module", section: "rw", module: 1 },
    "a fresh attempt starts in R&W Module 1",
  );

  endModule(db, attemptId, "rw", 1);
  assert.deepEqual(positionOf(db, attemptId), { kind: "module", section: "rw", module: 2 });

  endModule(db, attemptId, "rw", 2);
  stamp(db, attemptId, BREAK_STARTED_AT_COLUMN);
  assert.deepEqual(
    positionOf(db, attemptId),
    { kind: "break" },
    "ending R&W Module 2 puts the student on the break, not into Math",
  );

  // `end-break` stamps Math Module 1's clock -- that, not the break stamp, is what ends
  // the break.
  startModule(db, attemptId, "math", 1);
  assert.deepEqual(positionOf(db, attemptId), { kind: "module", section: "math", module: 1 });

  endModule(db, attemptId, "math", 1);
  assert.deepEqual(positionOf(db, attemptId), { kind: "module", section: "math", module: 2 });

  endModule(db, attemptId, "math", 2);
  assert.deepEqual(positionOf(db, attemptId), { kind: "submitted" });
});

test("D10: the attempt reads as submitted the moment Math Module 2 is stamped, before `submit` runs", () => {
  const db = makeTestDb();
  const { attemptId } = startNewAttempt(db);

  for (const [section, module] of [
    ["rw", 1],
    ["rw", 2],
    ["math", 1],
    ["math", 2],
  ] as [Section, ModuleNumber][]) {
    endModule(db, attemptId, section, module);
  }
  startModule(db, attemptId, "math", 1);

  // This is the crash window: `end-module` landed, `submit` did not.
  const state = getAttemptState(db, attemptId);
  assert.equal(state.status, "in_progress", "the row genuinely still says in_progress");
  assert.equal(state.submittedAt, null);

  assert.deepEqual(
    resolveCurrentPosition(state),
    { kind: "submitted" },
    "position keys off math_module2_submitted_at, never off status -- otherwise the " +
      "student is routed back into a module whose submitted-at stamp is already set",
  );
});

test("a break skipped early still ends: Math's clock, not break_started_at, defines the break", () => {
  const db = makeTestDb();
  const { attemptId } = startNewAttempt(db);

  endModule(db, attemptId, "rw", 1);
  endModule(db, attemptId, "rw", 2);
  stamp(db, attemptId, BREAK_STARTED_AT_COLUMN, "2026-09-05 11:00:00");
  startModule(db, attemptId, "math", 1, "2026-09-05 11:01:00");

  // The break stamp is still set and its ten minutes have not elapsed, yet the student
  // pressed "Resume testing" -- nothing clears break_started_at, so only Math's clock
  // can say the break is over.
  const state = getAttemptState(db, attemptId);
  assert.equal(state.breakStartedAt, "2026-09-05 11:00:00");
  assert.deepEqual(resolveCurrentPosition(state), {
    kind: "module",
    section: "math",
    module: 1,
  });
});

test("resolveCurrentPosition is pure over AttemptState -- no DB, no clock", () => {
  // Constructing the state by hand is the point: a route guard, a route handler and the
  // home screen all resolve positions from a state they already have, and none of them
  // should need a database handle to do it.
  const state = {
    attemptId: 7,
    status: "in_progress" as const,
    startedAt: "2026-09-05 09:00:00",
    submittedAt: null,
    breakStartedAt: null,
    ...PAUSE_FIELDS,
    rw: {
      section: "rw" as const,
      module1StartedAt: "2026-09-05 09:00:00",
      module1SubmittedAt: "2026-09-05 09:32:00",
      module2StartedAt: "2026-09-05 09:32:00",
      module2SubmittedAt: null,
      module2DifficultyPath: "easier" as const,
    },
    math: {
      section: "math" as const,
      module1StartedAt: null,
      module1SubmittedAt: null,
      module2StartedAt: null,
      module2SubmittedAt: null,
      module2DifficultyPath: null,
    },
  };

  assert.deepEqual(resolveCurrentPosition(state), {
    kind: "module",
    section: "rw",
    module: 2,
  });
});

test("resolveCurrentPosition stays on Module 1 when Module 2's clock has not started", () => {
  const state = {
    attemptId: 8,
    status: "in_progress" as const,
    startedAt: "2026-09-05 09:00:00",
    submittedAt: null,
    breakStartedAt: null,
    ...PAUSE_FIELDS,
    rw: {
      section: "rw" as const,
      module1StartedAt: "2026-09-05 09:00:00",
      module1SubmittedAt: "2026-09-05 09:32:00",
      module2StartedAt: null,
      module2SubmittedAt: null,
      module2DifficultyPath: null,
    },
    math: {
      section: "math" as const,
      module1StartedAt: null,
      module1SubmittedAt: null,
      module2StartedAt: null,
      module2SubmittedAt: null,
      module2DifficultyPath: null,
    },
  };

  assert.deepEqual(resolveCurrentPosition(state), {
    kind: "module",
    section: "rw",
    module: 1,
  });
});

test("resolveCurrentPosition routes to the break when R&W is done even if math_module1_submitted_at is stale", () => {
  const state = {
    attemptId: 6,
    status: "in_progress" as const,
    startedAt: "2026-09-05 09:00:00",
    submittedAt: null,
    breakStartedAt: "2026-09-05 18:03:37",
    ...PAUSE_FIELDS,
    rw: {
      section: "rw" as const,
      module1StartedAt: "2026-09-05 09:00:00",
      module1SubmittedAt: "2026-09-05 15:40:34",
      module2StartedAt: "2026-09-05 17:55:24",
      module2SubmittedAt: "2026-09-05 18:03:37",
      module2DifficultyPath: "easier" as const,
    },
    math: {
      section: "math" as const,
      module1StartedAt: null,
      module1SubmittedAt: "2026-09-05 15:40:34",
      module2StartedAt: null,
      module2SubmittedAt: null,
      module2DifficultyPath: null,
    },
  };

  assert.deepEqual(resolveCurrentPosition(state), { kind: "break" });
});

test("resolveCurrentPosition stays on Math Module 1 when Module 2's clock has not started", () => {
  const state = {
    attemptId: 9,
    status: "in_progress" as const,
    startedAt: "2026-09-05 09:00:00",
    submittedAt: null,
    breakStartedAt: "2026-09-05 11:00:00",
    ...PAUSE_FIELDS,
    rw: {
      section: "rw" as const,
      module1StartedAt: "2026-09-05 09:00:00",
      module1SubmittedAt: "2026-09-05 09:32:00",
      module2StartedAt: "2026-09-05 09:32:00",
      module2SubmittedAt: "2026-09-05 10:04:00",
      module2DifficultyPath: "easier" as const,
    },
    math: {
      section: "math" as const,
      module1StartedAt: "2026-09-05 11:01:00",
      module1SubmittedAt: "2026-09-05 11:36:00",
      module2StartedAt: null,
      module2SubmittedAt: null,
      module2DifficultyPath: null,
    },
  };

  assert.deepEqual(resolveCurrentPosition(state), {
    kind: "module",
    section: "math",
    module: 1,
  });
});

// ---------------------------------------------------------------------------
// getRunnerModule (D1)
// ---------------------------------------------------------------------------

test("getRunnerModule returns the whole module in order_index order with saved work", () => {
  const db = makeTestDb();
  const { attemptId, rw } = startNewAttempt(db);
  startModule(db, attemptId, "rw", 1);

  // One answered question and one flagged question, at known positions.
  saveAnswer(db, attemptId, "rw", 1, rw[3].question.id, "C");
  db.prepare(
    "UPDATE test_attempt_questions SET flagged = 1 WHERE attempt_id = ? AND question_id = ?",
  ).run(attemptId, rw[5].question.id);

  const runner = getRunnerModule(db, attemptId, "rw", 1);

  assert.equal(runner.attemptId, attemptId);
  assert.equal(runner.section, "rw");
  assert.equal(runner.module, 1);
  assert.equal(runner.questions.length, 27, "R&W Module 1 is 27 questions (PRD 3.2)");

  // Same order as the read model, which orders by order_index.
  assert.deepEqual(
    runner.questions.map((q) => q.id),
    readModuleQuestions(db, attemptId, "rw", 1).map((q) => q.question.id),
  );
  assert.deepEqual(
    runner.questions.map((q) => q.number),
    runner.questions.map((_, i) => i + 1),
    "display numbers are 1..N, not the shared cross-section order_index",
  );
  const orderIndexes = runner.questions.map((q) => q.orderIndex);
  assert.deepEqual(orderIndexes, [...orderIndexes].sort((a, b) => a - b));

  assert.equal(runner.questions[3].userAnswer, "C");
  assert.equal(runner.questions[3].flagged, false);
  assert.equal(runner.questions[5].flagged, true);
  assert.equal(runner.questions[5].userAnswer, null);
  assert.deepEqual(runner.questions[0].choices, [
    { letter: "A", text: "a" },
    { letter: "B", text: "b" },
    { letter: "C", text: "c" },
    { letter: "D", text: "d" },
  ]);
});

test("getRunnerModule never leaks correctness or the answer key to the client", () => {
  const db = makeTestDb();
  const { attemptId, rw } = startNewAttempt(db);
  startModule(db, attemptId, "rw", 1);

  // A saved answer sets `is_correct` on the row, so the column genuinely holds a value
  // that could leak; an unanswered module would make this test pass vacuously.
  saveAnswer(db, attemptId, "rw", 1, rw[0].question.id, rw[0].question.correct_answer);
  const graded = db
    .prepare(
      "SELECT is_correct AS c FROM test_attempt_questions WHERE attempt_id = ? AND question_id = ?",
    )
    .get(attemptId, rw[0].question.id) as { c: number };
  assert.equal(graded.c, 1, "precondition: the row really is graded");

  // Assert on the serialized payload -- the TypeScript type is erased at runtime, so it
  // is the JSON that proves nothing extra crosses the wire.
  const serialized = JSON.stringify(getRunnerModule(db, attemptId, "rw", 1));

  for (const forbidden of [
    "is_correct",
    "isCorrect",
    "correct_answer",
    "correctAnswer",
    "rationale",
    "difficulty",
    "wasRecycled",
    SECRET_RATIONALE,
    SECRET_SKILL,
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `runner payload must not contain "${forbidden}"`,
    );
  }

  // Belt and braces: pin the exact key set, so a future field cannot ride along unnoticed.
  const parsed = JSON.parse(serialized) as { questions: Record<string, unknown>[] };
  assert.deepEqual(Object.keys(parsed.questions[0]).sort(), [
    "choices",
    "crossedOutChoices",
    "figureAssetPath",
    "flagged",
    "highlights",
    "id",
    "number",
    "orderIndex",
    "questionType",
    "stimulusText",
    "userAnswer",
  ]);
});

test("getRunnerModule's deadline is UTC-correct even when the process timezone is not", () => {
  const db = makeTestDb();
  const { attemptId } = startNewAttempt(db);

  const startedAt = "2026-09-05 14:23:11"; // UTC, as datetime('now') writes it
  startModule(db, attemptId, "rw", 1, startedAt);

  const serverNow = Date.UTC(2026, 8, 5, 14, 30, 0);
  const runner = getRunnerModule(db, attemptId, "rw", 1, serverNow);

  assert.equal(
    runner.timer.deadline,
    Date.UTC(2026, 8, 5, 14, 23, 11) + 32 * 60 * 1000,
    "the deadline is the UTC stamp plus R&W's 32 minutes, whatever TZ this process runs in",
  );
  assert.equal(runner.timer.serverNow, serverNow);
  assert.equal(runner.timer.durationSeconds, 32 * 60);

  // Demonstrate the hazard this guards against, but only where the runtime actually
  // honoured the TZ above (a build without full ICU data would ignore it, and CI runs
  // UTC, where the naive parse happens to be right).
  const offsetMinutes = new Date(Date.UTC(2026, 8, 5, 14, 23, 11)).getTimezoneOffset();
  if (offsetMinutes !== 0) {
    const naive = new Date(startedAt).getTime(); // the banned parse, for contrast only
    assert.notEqual(
      naive + 32 * 60 * 1000,
      runner.timer.deadline,
      `new Date(stamp) is off by ${offsetMinutes} minutes here -- this is plan §6 rule 7`,
    );
  }
});

test("Math's deadline uses Math's 35-minute limit", () => {
  const db = makeTestDb();
  const { attemptId } = startNewAttempt(db);
  startModule(db, attemptId, "math", 1, "2026-01-15 08:00:00");

  const runner = getRunnerModule(db, attemptId, "math", 1, Date.UTC(2026, 0, 15, 8, 0, 0));
  assert.equal(runner.timer.durationSeconds, 35 * 60);
  assert.equal(runner.timer.deadline, Date.UTC(2026, 0, 15, 8, 35, 0));
  assert.equal(runner.questions.length, 22, "Math Module 1 is 22 questions (PRD 3.2)");
});

test("a refresh recomputes an identical deadline", () => {
  const db = makeTestDb();
  const { attemptId } = startNewAttempt(db);
  startModule(db, attemptId, "rw", 1, "2026-09-05 14:23:11");

  const first = getRunnerModule(db, attemptId, "rw", 1, Date.UTC(2026, 8, 5, 14, 25, 0));
  const second = getRunnerModule(db, attemptId, "rw", 1, Date.UTC(2026, 8, 5, 14, 40, 0));

  assert.equal(
    second.timer.deadline,
    first.timer.deadline,
    "the deadline is derived from a stored stamp, so reading it can never move it",
  );
  assert.ok(second.timer.serverNow > first.timer.serverNow, "only serverNow advances");
});

test("getRunnerModule refuses a module that has not been assembled or has no clock", () => {
  const db = makeTestDb();
  const { attemptId } = startNewAttempt(db);

  // Module 2 is assembled lazily at the section's end-module transition.
  assert.throws(() => getRunnerModule(db, attemptId, "rw", 2), /has not been served yet/);

  // Assembled, but no transition has stamped its clock: there is no honest deadline, and
  // inventing one from "now" would restart the countdown on every refresh.
  assert.throws(() => getRunnerModule(db, attemptId, "rw", 1), /no started_at stamp/);
});

// ---------------------------------------------------------------------------
// listAttempts (Story 3.1, D9)
// ---------------------------------------------------------------------------

test("listAttempts distinguishes the resumable attempt from finished ones", () => {
  const db = makeTestDb();

  const finished = startNewAttempt(db).attemptId;
  for (const [section, module] of [
    ["rw", 1],
    ["rw", 2],
    ["math", 1],
    ["math", 2],
  ] as [Section, ModuleNumber][]) {
    endModule(db, finished, section, module);
  }
  db.prepare(
    "UPDATE test_attempts SET status = 'submitted', submitted_at = datetime('now') WHERE id = ?",
  ).run(finished);

  const active = startNewAttempt(db).attemptId;
  startModule(db, active, "rw", 1);
  endModule(db, active, "rw", 1);

  const attempts = listAttempts(db);

  assert.deepEqual(
    attempts.map((a) => a.attemptId),
    [active, finished],
    "newest first",
  );

  const [current, past] = attempts;
  assert.equal(current.practiceTest, 1);
  assert.equal(current.resumable, true);
  assert.equal(current.status, "in_progress");
  assert.deepEqual(current.position, { kind: "module", section: "rw", module: 2 });
  assert.equal(current.path, runnerPath(active, "rw", 2), "the row deep-links to its module");

  assert.equal(past.practiceTest, 1);
  assert.equal(past.resumable, false);
  assert.equal(past.status, "submitted");
  assert.deepEqual(past.position, { kind: "submitted" });
  assert.equal(past.path, submittedPath(finished));
  assert.equal(past.totalScaledScore, null, "Epic 5 fills the score; it is null until then");

  assert.equal(
    attempts.filter((a) => a.resumable).length,
    1,
    "only the in-progress attempt is resumable after one is submitted",
  );
});

test("listAttempts allows multiple resumable in-progress attempts", () => {
  const db = makeTestDb();

  const first = startNewAttempt(db, { practiceTest: 1 }).attemptId;
  startModule(db, first, "rw", 1);

  const second = startNewAttempt(db, { practiceTest: 2 }).attemptId;
  startModule(db, second, "rw", 1);

  const attempts = listAttempts(db);
  const resumable = attempts.filter((a) => a.resumable);

  assert.equal(resumable.length, 2);
  assert.equal(resumable.find((a) => a.attemptId === first)?.practiceTest, 1);
  assert.equal(resumable.find((a) => a.attemptId === second)?.practiceTest, 2);
});

test("listAttempts marks an attempt in the D10 window as not resumable", () => {
  const db = makeTestDb();
  const attemptId = startNewAttempt(db).attemptId;
  for (const [section, module] of [
    ["rw", 1],
    ["rw", 2],
    ["math", 1],
    ["math", 2],
  ] as [Section, ModuleNumber][]) {
    endModule(db, attemptId, section, module);
  }

  const [row] = listAttempts(db);

  // `status` and `resumable` deliberately disagree here: the attempt is over (D10) even
  // though the second of the two finishing writes has not landed. Starting a new test
  // must not reuse this one, and the home screen must not offer to resume it.
  assert.equal(row.status, "in_progress");
  assert.equal(row.resumable, false);
  assert.equal(row.path, submittedPath(attemptId));
});

test("listAttempts deep-links an attempt sitting on the break", () => {
  const db = makeTestDb();
  const attemptId = startNewAttempt(db).attemptId;
  endModule(db, attemptId, "rw", 1);
  endModule(db, attemptId, "rw", 2);
  stamp(db, attemptId, BREAK_STARTED_AT_COLUMN);

  const [row] = listAttempts(db);
  assert.deepEqual(row.position, { kind: "break" });
  assert.equal(row.path, breakPath(attemptId));
  assert.equal(row.resumable, true);
});

test("listAttempts returns an empty list when nothing has been attempted", () => {
  assert.deepEqual(listAttempts(makeTestDb()), []);
});
