/**
 * Unit tests for Epic 3's module transitions (Task 1.1).
 *
 * The theme of every test here is **double delivery**. Each of these transitions is
 * driven by one HTTP POST that Epic 3 expects to receive twice -- a double-clicked
 * Submit, a retried request, or Story 3.3's expiry auto-submit racing the student's own
 * click -- so "called twice" is the case under test, not an afterthought. Concretely they
 * pin down:
 *
 *  - the seam (plan §4): delivering "end Module 1" twice returns the same Module 2 both
 *    times, with exactly 27 (R&W) / 22 (Math) module-2 rows and no second module;
 *  - that only `ModuleAlreadySubmittedError` is swallowed -- every other failure from
 *    `finalizeModule1` or from assembly still propagates, and rolls back;
 *  - that no retry moves a timestamp (D3a's write-if-null stamping), which is what stops
 *    a retried request from restarting a running clock;
 *  - that ending R&W Module 2 starts the break and ending Math's does not (D3a/D8);
 *  - that a crash between `endModule2("math")` and `submitAttempt` is recoverable (D10).
 *
 * Uses an in-memory SQLite DB built from the real migration files and seeded with
 * synthetic questions, mirroring `attemptService.test.ts`; nothing here touches
 * `data/bluebook.db`.
 *
 * Run with: `npm test`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";
import { BLUEPRINT, type Section } from "./blueprint";
import {
  startNewAttempt,
  saveAnswer,
  ModuleAlreadySubmittedError,
  type AssembledModuleQuestion,
} from "./attemptService";
import { formatSqliteTimestamp, parseSqliteTimestamp } from "./testFlow";
import { endBreak, endModule1, endModule2, submitAttempt } from "./moduleTransition";

/** Generous per-(domain, difficulty) supply so no domain is ever the constraint. */
const PER_BUCKET = 20;

/** The module-2 counts the seam doc names as its headline criterion (PRD 3.2). */
const MODULE2_QUESTION_COUNT: Record<Section, number> = { rw: 27, math: 22 };

function makeTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const insert = db.prepare(
    `INSERT INTO questions
      (id, section, domain, skill, difficulty, question_type, stimulus_text,
       choice_a, choice_b, choice_c, choice_d, correct_answer, rationale)
     VALUES (?, ?, ?, 'stub skill', ?, 'mc', 'stub stimulus', 'a', 'b', 'c', 'd', 'A', 'stub rationale')`,
  );

  for (const section of ["rw", "math"] as Section[]) {
    for (const { domain } of BLUEPRINT[section].domains) {
      for (const difficulty of ["easy", "medium", "hard"] as const) {
        for (let i = 0; i < PER_BUCKET; i++) {
          insert.run(`${section}-${domain}-${difficulty}-${i}`, section, domain, difficulty);
        }
      }
    }
  }

  return db;
}

function countRows(db: Database.Database, sql: string, ...args: unknown[]): number {
  return (db.prepare(sql).get(...args) as { c: number }).c;
}

/** Reads one `test_attempts` column. Tests assert on the raw column, not on a return value. */
function stamp(db: Database.Database, attemptId: number, column: string): string | null {
  return (
    db.prepare(`SELECT ${column} AS v FROM test_attempts WHERE id = ?`).get(attemptId) as {
      v: string | null;
    }
  ).v;
}

/**
 * Backdates a stamp to a known instant.
 *
 * Needed because `datetime('now')` has whole-second granularity: two calls a millisecond
 * apart produce the *same* string, so "the retry did not move the stamp" would pass
 * vacuously against a freshly written one. Moving the value somewhere no clock would
 * produce makes a re-stamp unmistakable.
 *
 * The value is built with `formatSqliteTimestamp` rather than by hand, so the test writes
 * exactly the shape SQLite writes -- and would fail if that shape ever drifted.
 */
function backdateStamp(
  db: Database.Database,
  attemptId: number,
  column: string,
  minutesAgo: number,
): string {
  const value = formatSqliteTimestamp(Date.now() - minutesAgo * 60_000);
  db.prepare(`UPDATE test_attempts SET ${column} = ? WHERE id = ?`).run(value, attemptId);
  return value;
}

/** Answers a module's questions so Module 1 scoring has something real to route on. */
function answerModule1(
  db: Database.Database,
  attemptId: number,
  section: Section,
  questions: AssembledModuleQuestion[],
  correctFraction: number,
): void {
  const correctCount = Math.round(questions.length * correctFraction);
  questions.forEach(({ question }, i) => {
    saveAnswer(
      db,
      attemptId,
      section,
      1,
      question.id,
      i < correctCount ? question.correct_answer : "B",
    );
  });
}

/** Drives an attempt up to the point where `section`'s Module 2 is in progress. */
function reachModule2(db: Database.Database, attemptId: number, section: Section): void {
  if (section === "math") {
    // Math's Module 2 is only reachable after R&W and the break, and each transition
    // guards on the previous one's stamp -- so the walk has to be real.
    endModule2(db, attemptId, "rw");
    endBreak(db, attemptId);
  }
  endModule1(db, attemptId, section);
}

// ---------------------------------------------------------------------------
// The seam (plan §4, epic-3-module-transition-seam.md)
// ---------------------------------------------------------------------------

for (const section of ["rw", "math"] as Section[]) {
  test(`delivering endModule1 twice returns the same Module 2 (${section})`, () => {
    const db = makeTestDb();
    const { attemptId, rw, math } = startNewAttempt(db);
    answerModule1(db, attemptId, "rw", rw, 0.7);
    answerModule1(db, attemptId, "math", math, 0.7);

    if (section === "math") {
      // Get to Math legitimately: R&W Module 1, its Module 2, then the break.
      endModule1(db, attemptId, "rw");
      endModule2(db, attemptId, "rw");
      endBreak(db, attemptId);
    }

    const first = endModule1(db, attemptId, section);
    const second = endModule1(db, attemptId, section);

    assert.equal(first.finalizedNow, true);
    assert.equal(
      second.finalizedNow,
      false,
      "the second delivery must take the seam path, not re-finalize",
    );

    // The headline criterion: same module, exactly once.
    assert.equal(first.module2.questions.length, MODULE2_QUESTION_COUNT[section]);
    assert.deepEqual(
      second.module2.questions.map((q) => q.question.id),
      first.module2.questions.map((q) => q.question.id),
      "a repeat delivery must return the Module 2 already on record",
    );
    assert.deepEqual(
      second.module2.questions.map((q) => q.orderIndex),
      first.module2.questions.map((q) => q.orderIndex),
    );
    assert.equal(second.module2.path, first.module2.path, "routing must not be recomputed");
    assert.equal(
      countRows(
        db,
        "SELECT COUNT(*) c FROM test_attempt_questions WHERE attempt_id = ? AND section = ? AND module = 2",
        attemptId,
        section,
      ),
      MODULE2_QUESTION_COUNT[section],
      "a second delivery must not insert a second Module 2",
    );

    // A third delivery is no different from the second -- there is nothing special about
    // the first retry.
    const third = endModule1(db, attemptId, section);
    assert.deepEqual(
      third.module2.questions.map((q) => q.question.id),
      first.module2.questions.map((q) => q.question.id),
    );
  });
}

test("endModule1 propagates every error that is not the seam's", () => {
  const db = makeTestDb();

  // A nonexistent attempt fails inside finalizeModule1 with a plain Error. Swallowing it
  // would turn a bad request into a 200 pointing at a module that does not exist.
  assert.throws(
    () => endModule1(db, 9999, "rw"),
    (err: unknown) =>
      err instanceof Error &&
      !(err instanceof ModuleAlreadySubmittedError) &&
      /does not exist/.test(err.message),
    "only ModuleAlreadySubmittedError may be caught",
  );
});

test("a failed Module 2 assembly rolls the whole endModule1 back", () => {
  const db = makeTestDb();
  const { attemptId, rw } = startNewAttempt(db);
  answerModule1(db, attemptId, "rw", rw, 0.7);

  // Leave only the questions Module 1 already consumed in one domain, so Module 2's draw
  // for that domain cannot be filled even after difficulty fallback.
  const starved = BLUEPRINT.rw.domains[0].domain;
  const usedIds = (
    db
      .prepare(
        "SELECT question_id AS id FROM test_attempt_questions WHERE attempt_id = ? AND section = 'rw'",
      )
      .all(attemptId) as { id: string }[]
  ).map((r) => r.id);
  db.prepare(
    `DELETE FROM questions WHERE section = 'rw' AND domain = ?
     AND id NOT IN (${usedIds.map(() => "?").join(",")})`,
  ).run(starved, ...usedIds);

  assert.throws(() => endModule1(db, attemptId, "rw"), /Not enough/);

  // The transition is all-or-nothing: no half-transitioned attempt is left behind. In
  // particular the Module 2 clock must not be running for a Module 2 that was never
  // assembled, and Module 1 must not be stuck "finalized" with nowhere to go.
  assert.equal(stamp(db, attemptId, "rw_module1_submitted_at"), null);
  assert.equal(stamp(db, attemptId, "rw_module2_started_at"), null);
  assert.equal(
    countRows(
      db,
      "SELECT COUNT(*) c FROM test_attempt_questions WHERE attempt_id = ? AND module = 2",
      attemptId,
    ),
    0,
  );
});

// ---------------------------------------------------------------------------
// D3a: write-if-null stamping
// ---------------------------------------------------------------------------

test("a retried endModule1 does not restart the Module 2 clock", () => {
  const db = makeTestDb();
  const { attemptId, rw } = startNewAttempt(db);
  answerModule1(db, attemptId, "rw", rw, 0.7);

  endModule1(db, attemptId, "rw");
  // Pretend the student has been in Module 2 for ten minutes. A retry that re-stamped
  // would silently hand them a fresh 32 minutes.
  const tenMinutesAgo = backdateStamp(db, attemptId, "rw_module2_started_at", 10);
  const module1SubmittedAt = stamp(db, attemptId, "rw_module1_submitted_at");

  const retry = endModule1(db, attemptId, "rw");

  assert.equal(stamp(db, attemptId, "rw_module2_started_at"), tenMinutesAgo);
  assert.equal(retry.module2StartedAt, tenMinutesAgo, "the result must report the live stamp");
  assert.equal(
    stamp(db, attemptId, "rw_module1_submitted_at"),
    module1SubmittedAt,
    "the seam path must not re-stamp Module 1 either",
  );

  // And the stamp is still parseable as the UTC instant it claims to be -- never via
  // `new Date()`, which would read it as local time (§6 rule 7).
  const deltaMinutes = (Date.now() - parseSqliteTimestamp(tenMinutesAgo)) / 60_000;
  assert.ok(deltaMinutes > 9.5 && deltaMinutes < 10.5, `expected ~10 minutes, got ${deltaMinutes}`);
});

// ---------------------------------------------------------------------------
// End of Module 2, and the break (D8)
// ---------------------------------------------------------------------------

test("ending R&W Module 2 starts the break, idempotently", () => {
  const db = makeTestDb();
  const { attemptId, rw } = startNewAttempt(db);
  answerModule1(db, attemptId, "rw", rw, 0.7);
  reachModule2(db, attemptId, "rw");

  const first = endModule2(db, attemptId, "rw");
  assert.equal(first.submittedNow, true);
  assert.ok(first.breakStartedAt, "R&W Module 2 must start the break clock (D8)");
  assert.equal(stamp(db, attemptId, "rw_module2_submitted_at"), first.submittedAt);
  assert.equal(stamp(db, attemptId, "break_started_at"), first.breakStartedAt);

  // The student is five minutes into the break when the retry lands.
  const submittedAt = backdateStamp(db, attemptId, "rw_module2_submitted_at", 5);
  const breakStartedAt = backdateStamp(db, attemptId, "break_started_at", 5);

  const second = endModule2(db, attemptId, "rw");
  assert.equal(second.submittedNow, false);
  assert.equal(second.submittedAt, submittedAt);
  assert.equal(second.breakStartedAt, breakStartedAt);
  assert.equal(
    stamp(db, attemptId, "break_started_at"),
    breakStartedAt,
    "a retried end-module must not restart the break countdown",
  );
});

test("ending Math Module 2 does not start a break", () => {
  const db = makeTestDb();
  const { attemptId, rw, math } = startNewAttempt(db);
  answerModule1(db, attemptId, "rw", rw, 0.7);
  answerModule1(db, attemptId, "math", math, 0.7);
  endModule1(db, attemptId, "rw");
  reachModule2(db, attemptId, "math");

  const breakBefore = stamp(db, attemptId, "break_started_at");
  const result = endModule2(db, attemptId, "math");

  assert.equal(result.breakStartedAt, null, "there is no break after Math");
  assert.equal(
    stamp(db, attemptId, "break_started_at"),
    breakBefore,
    "Math must never touch break_started_at -- R&W's break is already over",
  );
  assert.equal(stamp(db, attemptId, "math_module2_submitted_at"), result.submittedAt);

  const retry = endModule2(db, attemptId, "math");
  assert.equal(retry.submittedNow, false);
  assert.equal(retry.submittedAt, result.submittedAt);
});

test("a module that never started cannot be ended", () => {
  const db = makeTestDb();
  const { attemptId } = startNewAttempt(db);

  // D10 reads `math_module2_submitted_at` as "the whole attempt is over", so an
  // out-of-order delivery that stamped it would end a test nobody has taken.
  assert.throws(() => endModule2(db, attemptId, "math"), /has not started/);
  assert.equal(stamp(db, attemptId, "math_module2_submitted_at"), null);
  assert.throws(() => endModule2(db, 9999, "rw"), /does not exist/);
});

// ---------------------------------------------------------------------------
// The break's end (D8)
// ---------------------------------------------------------------------------

test("endBreak starts Math's clock once, however many times it is delivered", () => {
  const db = makeTestDb();
  const { attemptId, rw } = startNewAttempt(db);
  answerModule1(db, attemptId, "rw", rw, 0.7);
  endModule1(db, attemptId, "rw");
  endModule2(db, attemptId, "rw");

  assert.equal(stamp(db, attemptId, "math_module1_started_at"), null, "Math waits for the break");

  // "Resume testing" and the break countdown hitting zero can fire together; both post
  // end-break.
  const first = endBreak(db, attemptId);
  assert.equal(first.startedNow, true);
  assert.equal(stamp(db, attemptId, "math_module1_started_at"), first.mathModule1StartedAt);

  const startedAt = backdateStamp(db, attemptId, "math_module1_started_at", 12);
  const second = endBreak(db, attemptId);

  assert.equal(second.startedNow, false);
  assert.equal(second.mathModule1StartedAt, startedAt);
  assert.equal(
    stamp(db, attemptId, "math_module1_started_at"),
    startedAt,
    "a retried end-break must not hand back a fresh 35 minutes",
  );
});

test("the break cannot be ended before it starts", () => {
  const db = makeTestDb();
  const { attemptId, rw } = startNewAttempt(db);
  answerModule1(db, attemptId, "rw", rw, 0.7);
  endModule1(db, attemptId, "rw");

  // R&W Module 2 is still in progress; starting Math's clock now would burn a module the
  // student has not reached.
  assert.throws(() => endBreak(db, attemptId), /has not started/);
  assert.equal(stamp(db, attemptId, "math_module1_started_at"), null);
  assert.throws(() => endBreak(db, 9999), /does not exist/);
});

// ---------------------------------------------------------------------------
// Final submit (D6, D10)
// ---------------------------------------------------------------------------

test("submitAttempt is idempotent", () => {
  const db = makeTestDb();
  const { attemptId } = startNewAttempt(db);

  const first = submitAttempt(db, attemptId);
  assert.equal(first.submittedNow, true);
  assert.equal(stamp(db, attemptId, "status"), "submitted");
  assert.equal(stamp(db, attemptId, "submitted_at"), first.submittedAt);

  const submittedAt = backdateStamp(db, attemptId, "submitted_at", 3);
  const second = submitAttempt(db, attemptId);

  assert.equal(second.submittedNow, false);
  assert.equal(second.submittedAt, submittedAt);
  assert.equal(stamp(db, attemptId, "submitted_at"), submittedAt);
  assert.equal(stamp(db, attemptId, "status"), "submitted");
  assert.throws(() => submitAttempt(db, 9999), /does not exist/);
});

test("a crash between ending Math Module 2 and submitting is recoverable (D10)", () => {
  const db = makeTestDb();
  const { attemptId, rw, math } = startNewAttempt(db);
  answerModule1(db, attemptId, "rw", rw, 0.7);
  answerModule1(db, attemptId, "math", math, 0.7);
  endModule1(db, attemptId, "rw");
  reachModule2(db, attemptId, "math");

  endModule2(db, attemptId, "math");
  // ...and the process dies before `submit` is posted. This is the window D10 names.
  assert.ok(stamp(db, attemptId, "math_module2_submitted_at"), "the last module really is over");
  assert.equal(
    stamp(db, attemptId, "status"),
    "in_progress",
    "status lags on purpose -- it is Epics 5/7's field, not the runner's",
  );
  assert.equal(stamp(db, attemptId, "submitted_at"), null);

  // Retrying just the submit finishes the job; nothing has to be undone first.
  const recovered = submitAttempt(db, attemptId);
  assert.equal(recovered.submittedNow, true);
  assert.equal(stamp(db, attemptId, "status"), "submitted");

  // And the recovery is itself retryable, since the same crash can happen again.
  assert.equal(submitAttempt(db, attemptId).submittedAt, recovered.submittedAt);
});

// ---------------------------------------------------------------------------
// The whole walk
// ---------------------------------------------------------------------------

test("every transition of a full attempt stamps exactly its own columns", () => {
  const db = makeTestDb();
  const { attemptId, rw, math } = startNewAttempt(db);
  answerModule1(db, attemptId, "rw", rw, 0.7);
  answerModule1(db, attemptId, "math", math, 0.7);

  // R&W Module 1 -> Module 2.
  endModule1(db, attemptId, "rw");
  assert.ok(stamp(db, attemptId, "rw_module1_submitted_at"));
  assert.ok(stamp(db, attemptId, "rw_module2_started_at"));
  assert.equal(stamp(db, attemptId, "break_started_at"), null);
  assert.equal(stamp(db, attemptId, "math_module1_started_at"), null);

  // R&W Module 2 -> break.
  endModule2(db, attemptId, "rw");
  assert.ok(stamp(db, attemptId, "rw_module2_submitted_at"));
  assert.ok(stamp(db, attemptId, "break_started_at"));
  assert.equal(stamp(db, attemptId, "math_module1_started_at"), null);

  // Break -> Math Module 1.
  endBreak(db, attemptId);
  assert.ok(stamp(db, attemptId, "math_module1_started_at"));
  assert.equal(stamp(db, attemptId, "math_module1_submitted_at"), null);

  // Math Module 1 -> Module 2 -> submit.
  endModule1(db, attemptId, "math");
  assert.ok(stamp(db, attemptId, "math_module1_submitted_at"));
  assert.ok(stamp(db, attemptId, "math_module2_started_at"));

  endModule2(db, attemptId, "math");
  submitAttempt(db, attemptId);

  assert.equal(stamp(db, attemptId, "status"), "submitted");
  assert.equal(
    countRows(
      db,
      "SELECT COUNT(*) c FROM test_attempt_questions WHERE attempt_id = ? AND module = 2",
      attemptId,
    ),
    MODULE2_QUESTION_COUNT.rw + MODULE2_QUESTION_COUNT.math,
    "one Module 2 per section and no more",
  );

  // Re-delivering the whole walk changes nothing at all.
  const before = db.prepare("SELECT * FROM test_attempts WHERE id = ?").get(attemptId);
  endModule1(db, attemptId, "rw");
  endModule2(db, attemptId, "rw");
  endBreak(db, attemptId);
  endModule1(db, attemptId, "math");
  endModule2(db, attemptId, "math");
  submitAttempt(db, attemptId);
  assert.deepEqual(db.prepare("SELECT * FROM test_attempts WHERE id = ?").get(attemptId), before);
});
