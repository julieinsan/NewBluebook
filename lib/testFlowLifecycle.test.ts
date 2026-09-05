/**
 * Epic 3 Wave 4 (Task 4.1): end-to-end lifecycle verification of the domain layer.
 *
 * Where the unit tests in `moduleTransition.test.ts`, `attemptState.test.ts` and
 * `questionState.test.ts` each pin one concern, this file drives the whole attempt
 * start→submit path as the runner and route handlers actually compose it — module counts,
 * double delivery at both section boundaries, expired-module behaviour, break stamping,
 * resume-after-refresh position, and D9′ multi-start behavior.
 *
 * Uses an in-memory SQLite DB built from the real migration files; nothing here touches
 * `data/bluebook.db`.
 *
 * Run with: `npm test`.
 */
process.env.TZ = "America/New_York";

import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";
import { BLUEPRINT, moduleQuestionCount, type ModuleNumber, type Section } from "./blueprint";
import {
  startNewAttempt,
  saveAnswer,
  readModuleQuestions,
  type AssembledModuleQuestion,
} from "./attemptService";
import {
  getAttemptState,
  getRunnerModule,
  listAttempts,
  resolveCurrentPosition,
  resolvePositionForAttempt,
} from "./attemptState";
import { saveAnswerWithDeadline } from "./questionState";
import { endBreak, endModule1, endModule2, submitAttempt } from "./moduleTransition";
import {
  BREAK_STARTED_AT_COLUMN,
  LATE_ANSWER_GRACE_MS,
  formatSqliteTimestamp,
  moduleDeadline,
  moduleStartedAtColumn,
  pathForPosition,
  runnerPath,
  breakPath,
  submittedPath,
  parseSqliteTimestamp,
  type ModulePosition,
} from "./testFlow";

const PER_BUCKET = 20;

const MODULE1_COUNT: Record<Section, number> = {
  rw: moduleQuestionCount("rw", 1),
  math: moduleQuestionCount("math", 1),
};
const MODULE2_COUNT: Record<Section, number> = {
  rw: moduleQuestionCount("rw", 2),
  math: moduleQuestionCount("math", 2),
};

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

function stamp(db: Database.Database, attemptId: number, column: string): string | null {
  return (
    db.prepare(`SELECT ${column} AS v FROM test_attempts WHERE id = ?`).get(attemptId) as {
      v: string | null;
    }
  ).v;
}

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

/** Mirrors POST /api/attempts (D9′): always create a new attempt and stamp R&W M1. */
function startAttempt(
  db: Database.Database,
  practiceTest: 1 | 2 = 1,
): {
  attemptId: number;
  practiceTest: 1 | 2;
  next: string;
  rw: AssembledModuleQuestion[];
  math: AssembledModuleQuestion[];
} {
  const { attemptId, practiceTest: pt, rw, math } = startNewAttempt(db, { practiceTest });
  const column = moduleStartedAtColumn("rw", 1);
  db.prepare(
    `UPDATE test_attempts SET ${column} = datetime('now') WHERE id = ? AND ${column} IS NULL`,
  ).run(attemptId);

  return {
    attemptId,
    practiceTest: pt,
    next: runnerPath(attemptId, "rw", 1),
    rw,
    math,
  };
}

function positionOf(db: Database.Database, attemptId: number): ModulePosition {
  return resolveCurrentPosition(getAttemptState(db, attemptId));
}

function assertModuleCounts(
  db: Database.Database,
  attemptId: number,
  section: Section,
  module: ModuleNumber,
  expected: number,
): void {
  assert.equal(
    countRows(
      db,
      "SELECT COUNT(*) c FROM test_attempt_questions WHERE attempt_id = ? AND section = ? AND module = ?",
      attemptId,
      section,
      module,
    ),
    expected,
    `${section} Module ${module} question count`,
  );
}

// ---------------------------------------------------------------------------
// Full lifecycle
// ---------------------------------------------------------------------------

test("full attempt lifecycle from start through submit has 27/22 questions per module", () => {
  const db = makeTestDb();
  const { attemptId, rw, math } = startAttempt(db);

  assertModuleCounts(db, attemptId, "rw", 1, MODULE1_COUNT.rw);
  assertModuleCounts(db, attemptId, "math", 1, MODULE1_COUNT.math);
  assert.equal(rw.length, MODULE1_COUNT.rw);
  assert.equal(math.length, MODULE1_COUNT.math);

  answerModule1(db, attemptId, "rw", rw, 0.7);
  answerModule1(db, attemptId, "math", math, 0.4);

  // R&W Module 1 -> Module 2
  endModule1(db, attemptId, "rw");
  assertModuleCounts(db, attemptId, "rw", 2, MODULE2_COUNT.rw);
  assert.deepEqual(positionOf(db, attemptId), { kind: "module", section: "rw", module: 2 });

  // R&W Module 2 -> break
  endModule2(db, attemptId, "rw");
  assert.ok(stamp(db, attemptId, "rw_module2_submitted_at"));
  assert.ok(stamp(db, attemptId, BREAK_STARTED_AT_COLUMN));
  assert.deepEqual(positionOf(db, attemptId), { kind: "break" });
  assert.equal(pathForPosition(attemptId, positionOf(db, attemptId)), breakPath(attemptId));

  // Break -> Math Module 1
  endBreak(db, attemptId);
  assert.ok(stamp(db, attemptId, "math_module1_started_at"));
  assert.deepEqual(positionOf(db, attemptId), { kind: "module", section: "math", module: 1 });

  // Math Module 1 -> Module 2
  endModule1(db, attemptId, "math");
  assertModuleCounts(db, attemptId, "math", 2, MODULE2_COUNT.math);
  assert.deepEqual(positionOf(db, attemptId), { kind: "module", section: "math", module: 2 });

  // Math Module 2 -> submitted (D10)
  endModule2(db, attemptId, "math");
  assert.ok(stamp(db, attemptId, "math_module2_submitted_at"));
  assert.deepEqual(positionOf(db, attemptId), { kind: "submitted" });
  assert.equal(stamp(db, attemptId, "status"), "in_progress", "status lags until submit");

  submitAttempt(db, attemptId);
  assert.equal(stamp(db, attemptId, "status"), "submitted");
  assert.equal(pathForPosition(attemptId, positionOf(db, attemptId)), submittedPath(attemptId));
});

// ---------------------------------------------------------------------------
// Double delivery at both section boundaries (plan §4, risk table)
// ---------------------------------------------------------------------------

for (const section of ["rw", "math"] as Section[]) {
  test(`double delivery of endModule1 at the ${section} section boundary is safe`, () => {
    const db = makeTestDb();
    const { attemptId, rw, math } = startAttempt(db);
    answerModule1(db, attemptId, "rw", rw, 0.7);
    answerModule1(db, attemptId, "math", math, 0.4);

    if (section === "math") {
      endModule1(db, attemptId, "rw");
      endModule2(db, attemptId, "rw");
      endBreak(db, attemptId);
    }

    const first = endModule1(db, attemptId, section);
    const module2StartedAt = stamp(db, attemptId, moduleStartedAtColumn(section, 2));
    const second = endModule1(db, attemptId, section);

    assert.equal(first.finalizedNow, true);
    assert.equal(second.finalizedNow, false);
    assert.equal(second.module2StartedAt, module2StartedAt);
    assert.deepEqual(
      second.module2.questions.map((q) => q.question.id),
      first.module2.questions.map((q) => q.question.id),
    );
    assertModuleCounts(db, attemptId, section, 2, MODULE2_COUNT[section]);
    assert.deepEqual(
      resolvePositionForAttempt(db, attemptId),
      section === "rw"
        ? ({ kind: "module", section: "rw", module: 2 } as const)
        : ({ kind: "module", section: "math", module: 2 } as const),
    );
  });
}

// ---------------------------------------------------------------------------
// Expired module: answers refused, end-module still succeeds (auto-submit path)
// ---------------------------------------------------------------------------

test("an expired module rejects late answers but end-module still finalizes it", () => {
  const db = makeTestDb();
  const { attemptId, rw } = startAttempt(db);
  answerModule1(db, attemptId, "rw", rw, 0.7);

  endModule1(db, attemptId, "rw");
  const startedAt = formatSqliteTimestamp(Date.UTC(2026, 8, 5, 9, 0, 0));
  db.prepare(`UPDATE test_attempts SET rw_module2_started_at = ? WHERE id = ?`).run(
    startedAt,
    attemptId,
  );

  const questions = readModuleQuestions(db, attemptId, "rw", 2);
  const questionId = questions[0].question.id;
  const deadline = moduleDeadline("rw", 2, startedAt);
  const pastGrace = deadline + LATE_ANSWER_GRACE_MS + 1;

  saveAnswer(db, attemptId, "rw", 2, questionId, "A");
  const rejected = saveAnswerWithDeadline(db, attemptId, "rw", 2, questionId, "B", pastGrace);
  assert.deepEqual(rejected, { saved: false, isLate: true });
  assert.equal(
    (
      db
        .prepare(
          "SELECT user_answer FROM test_attempt_questions WHERE attempt_id = ? AND question_id = ? AND module = 2",
        )
        .get(attemptId, questionId) as { user_answer: string }
    ).user_answer,
    "A",
    "a stale autosave must not overwrite the last in-time answer",
  );

  // Story 3.3's expiry auto-submit POSTs the same end-module request the button does.
  const first = endModule2(db, attemptId, "rw");
  const breakStartedAt = stamp(db, attemptId, BREAK_STARTED_AT_COLUMN);
  const second = endModule2(db, attemptId, "rw");

  assert.equal(first.submittedNow, true);
  assert.equal(second.submittedNow, false);
  assert.equal(second.breakStartedAt, breakStartedAt);
  assert.deepEqual(positionOf(db, attemptId), { kind: "break" });
});

// ---------------------------------------------------------------------------
// Break start/end stamping (D8)
// ---------------------------------------------------------------------------

test("break_started_at is stamped when R&W Module 2 ends and Math starts only at endBreak", () => {
  const db = makeTestDb();
  const { attemptId, rw } = startAttempt(db);
  answerModule1(db, attemptId, "rw", rw, 0.7);

  endModule1(db, attemptId, "rw");
  assert.equal(stamp(db, attemptId, BREAK_STARTED_AT_COLUMN), null);
  assert.equal(stamp(db, attemptId, "math_module1_started_at"), null);

  endModule2(db, attemptId, "rw");
  const breakStartedAt = stamp(db, attemptId, BREAK_STARTED_AT_COLUMN);
  assert.ok(breakStartedAt);
  assert.equal(stamp(db, attemptId, "math_module1_started_at"), null);

  endBreak(db, attemptId);
  assert.equal(stamp(db, attemptId, BREAK_STARTED_AT_COLUMN), breakStartedAt);
  assert.ok(stamp(db, attemptId, "math_module1_started_at"));
});

// ---------------------------------------------------------------------------
// Resume after refresh: position and deadline are stable (D3, D4)
// ---------------------------------------------------------------------------

test("resume-after-refresh keeps the same position and module deadline", () => {
  const db = makeTestDb();
  const { attemptId, rw } = startAttempt(db);
  answerModule1(db, attemptId, "rw", rw, 0.7);
  endModule1(db, attemptId, "rw");

  const reads = Array.from({ length: 5 }, () => ({
    position: positionOf(db, attemptId),
    path: pathForPosition(attemptId, positionOf(db, attemptId)),
    runner: getRunnerModule(db, attemptId, "rw", 2, Date.now()),
  }));

  for (let i = 1; i < reads.length; i++) {
    assert.deepEqual(reads[i].position, reads[0].position);
    assert.equal(reads[i].path, reads[0].path);
    assert.equal(reads[i].runner.timer.deadline, reads[0].runner.timer.deadline);
  }

  assert.deepEqual(reads[0].position, { kind: "module", section: "rw", module: 2 });
  assert.equal(reads[0].path, runnerPath(attemptId, "rw", 2));

  const startedAt = stamp(db, attemptId, "rw_module2_started_at");
  assert.ok(startedAt);
  assert.equal(
    reads[0].runner.timer.deadline,
    moduleDeadline("rw", 2, startedAt),
    "deadline must be derived from the stored stamp, not from serverNow",
  );
  assert.doesNotThrow(() => parseSqliteTimestamp(startedAt!));
});

// ---------------------------------------------------------------------------
// Multi-start while in progress (D9′)
// ---------------------------------------------------------------------------

test("second start creates a new attempt while the first is still in progress", () => {
  const db = makeTestDb();

  const first = startAttempt(db, 1);
  assert.equal(first.next, runnerPath(first.attemptId, "rw", 1));
  assert.equal(first.practiceTest, 1);

  const second = startAttempt(db, 2);
  assert.notEqual(second.attemptId, first.attemptId);
  assert.equal(second.practiceTest, 2);
  assert.equal(second.next, runnerPath(second.attemptId, "rw", 1));

  assert.equal(
    countRows(db, "SELECT COUNT(*) c FROM test_attempts WHERE status = 'in_progress'"),
    2,
  );
  assert.equal(listAttempts(db).filter((a) => a.resumable).length, 2);
});

test("a new attempt can start after the previous one is fully submitted", () => {
  const db = makeTestDb();
  const first = startAttempt(db);
  answerModule1(db, first.attemptId, "rw", first.rw, 0.7);
  answerModule1(db, first.attemptId, "math", first.math, 0.4);

  endModule1(db, first.attemptId, "rw");
  endModule2(db, first.attemptId, "rw");
  endBreak(db, first.attemptId);
  endModule1(db, first.attemptId, "math");
  endModule2(db, first.attemptId, "math");
  submitAttempt(db, first.attemptId);

  const second = startAttempt(db);
  assert.notEqual(second.attemptId, first.attemptId);
  assert.equal(listAttempts(db).filter((a) => a.resumable).length, 1);
});
