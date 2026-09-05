/**
 * Unit tests for the attempt assembly service's three load-bearing invariants:
 * Module 2 requires a finalized Module 1, Module 2 assembly is idempotent, and
 * assembly is atomic (a failure leaves neither attempt rows nor serve-log rows).
 *
 * These matter for Epic 3, where this service is driven by HTTP handlers and
 * double-submits, refreshes and mid-request failures are routine rather than
 * hypothetical.
 *
 * Uses an in-memory SQLite DB (schema from the real migration files) seeded with
 * synthetic questions, so nothing here touches `data/bluebook.db`.
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
  finalizeModule1,
  submitModule1Answers,
  assembleModule2ForSection,
  readModuleQuestions,
  type AssembledModuleQuestion,
} from "./attemptService";

/** Generous per-(domain, difficulty) supply so no domain is ever the constraint. */
const PER_BUCKET = 20;

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

function answerAll(
  questions: AssembledModuleQuestion[],
  correctFraction: number,
): { questionId: string; userAnswer: string }[] {
  const correctCount = Math.round(questions.length * correctFraction);
  return questions.map(({ question }, i) => ({
    questionId: question.id,
    userAnswer: i < correctCount ? question.correct_answer : "B",
  }));
}

test("Module 2 cannot be assembled before Module 1 is finalized", () => {
  const db = makeTestDb();
  const { attemptId } = startNewAttempt(db);

  assert.throws(
    () => assembleModule2ForSection(db, attemptId, "rw"),
    /has not been submitted yet/,
    "expected a guard failure, not a silent 0-score routing",
  );

  // Nothing was persisted by the rejected call.
  assert.equal(
    countRows(
      db,
      "SELECT COUNT(*) c FROM test_attempt_questions WHERE attempt_id = ? AND module = 2",
      attemptId,
    ),
    0,
  );
  const path = db
    .prepare("SELECT rw_module2_difficulty_path AS p FROM test_attempts WHERE id = ?")
    .get(attemptId) as { p: string | null };
  assert.equal(path.p, null, "a rejected assembly must not persist a routing path");
});

test("saving answers alone does not unlock Module 2 -- finalizing is a separate act", () => {
  const db = makeTestDb();
  const { attemptId, rw } = startNewAttempt(db);

  for (const { question } of rw) {
    saveAnswer(db, attemptId, "rw", 1, question.id, question.correct_answer);
  }

  assert.throws(() => assembleModule2ForSection(db, attemptId, "rw"), /has not been submitted yet/);

  finalizeModule1(db, attemptId, "rw");
  const result = assembleModule2ForSection(db, attemptId, "rw");
  assert.equal(result.path, "harder", "all-correct Module 1 must route harder");
});

test("assembling Module 2 twice returns the same module instead of inserting a second one", () => {
  const db = makeTestDb();
  const { attemptId, rw } = startNewAttempt(db);
  submitModule1Answers(db, attemptId, "rw", answerAll(rw, 0.7));

  const first = assembleModule2ForSection(db, attemptId, "rw");
  const rowsAfterFirst = countRows(
    db,
    "SELECT COUNT(*) c FROM test_attempt_questions WHERE attempt_id = ? AND section = 'rw' AND module = 2",
    attemptId,
  );

  const second = assembleModule2ForSection(db, attemptId, "rw");
  const rowsAfterSecond = countRows(
    db,
    "SELECT COUNT(*) c FROM test_attempt_questions WHERE attempt_id = ? AND section = 'rw' AND module = 2",
    attemptId,
  );

  assert.equal(rowsAfterSecond, rowsAfterFirst, "a repeat call must not insert a second module");
  assert.deepEqual(
    second.questions.map((q) => q.question.id),
    first.questions.map((q) => q.question.id),
    "repeat call must return the questions actually on record",
  );
  assert.deepEqual(
    second.questions.map((q) => q.orderIndex),
    first.questions.map((q) => q.orderIndex),
  );
  assert.deepEqual(
    second.questions.map((q) => q.question.wasRecycled),
    first.questions.map((q) => q.question.wasRecycled),
    "wasRecycled must survive the read-back path",
  );
  assert.equal(second.path, first.path);
  assert.equal(second.correctCount, first.correctCount);
});

test("a module cannot be finalized twice", () => {
  const db = makeTestDb();
  const { attemptId, rw } = startNewAttempt(db);
  submitModule1Answers(db, attemptId, "rw", answerAll(rw, 0.7));

  assert.throws(() => finalizeModule1(db, attemptId, "rw"), /cannot be submitted twice/);
  // The other section is independent and still finalizable.
  assert.doesNotThrow(() => finalizeModule1(db, attemptId, "math"));
});

test("saveAnswer grades, overwrites, and rejects questions outside the module", () => {
  const db = makeTestDb();
  const { attemptId, rw } = startNewAttempt(db);
  const questionId = rw[0].question.id;

  saveAnswer(db, attemptId, "rw", 1, questionId, "B");
  const wrong = db
    .prepare(
      "SELECT user_answer AS a, is_correct AS c FROM test_attempt_questions WHERE attempt_id = ? AND question_id = ? AND module = 1",
    )
    .get(attemptId, questionId) as { a: string; c: number };
  assert.deepEqual(wrong, { a: "B", c: 0 });

  // Overwriting is the normal case (student changes their mind), not an error.
  saveAnswer(db, attemptId, "rw", 1, questionId, "A");
  const right = db
    .prepare(
      "SELECT user_answer AS a, is_correct AS c FROM test_attempt_questions WHERE attempt_id = ? AND question_id = ? AND module = 1",
    )
    .get(attemptId, questionId) as { a: string; c: number };
  assert.deepEqual(right, { a: "A", c: 1 });

  // Still exactly one row -- saveAnswer updates, never inserts.
  assert.equal(
    countRows(
      db,
      "SELECT COUNT(*) c FROM test_attempt_questions WHERE attempt_id = ? AND question_id = ?",
      attemptId,
      questionId,
    ),
    1,
  );

  assert.throws(
    () => saveAnswer(db, attemptId, "math", 1, questionId, "A"),
    /is not part of attempt/,
    "an R&W question must not be answerable as a Math question",
  );
  assert.throws(
    () => saveAnswer(db, attemptId, "rw", 2, questionId, "A"),
    /is not part of attempt/,
    "a Module 1 question must not be answerable as Module 2",
  );
});

test("a failed startNewAttempt leaves no attempt rows and no serve-log rows", () => {
  const db = makeTestDb();
  // Starve one R&W domain below its Module 1 need so assembly throws part-way,
  // after R&W's earlier domains have already selected (and serve-logged) questions.
  const starved = BLUEPRINT.rw.domains[BLUEPRINT.rw.domains.length - 1].domain;
  db.prepare("DELETE FROM questions WHERE section = 'rw' AND domain = ?").run(starved);

  const attemptsBefore = countRows(db, "SELECT COUNT(*) c FROM test_attempts");
  const taqBefore = countRows(db, "SELECT COUNT(*) c FROM test_attempt_questions");
  const logBefore = countRows(db, "SELECT COUNT(*) c FROM question_serve_log");

  assert.throws(() => startNewAttempt(db), /Not enough/);

  assert.equal(countRows(db, "SELECT COUNT(*) c FROM test_attempts"), attemptsBefore);
  assert.equal(countRows(db, "SELECT COUNT(*) c FROM test_attempt_questions"), taqBefore);
  assert.equal(
    countRows(db, "SELECT COUNT(*) c FROM question_serve_log"),
    logBefore,
    "serve-log rows for questions nobody ever saw must roll back too",
  );
});

test("a failed Module 2 assembly rolls back its routing path and serve-log rows", () => {
  const db = makeTestDb();
  const { attemptId, rw } = startNewAttempt(db);
  submitModule1Answers(db, attemptId, "rw", answerAll(rw, 0.7));

  // Leave only the questions Module 1 already consumed in one domain, so Module 2's
  // draw for that domain cannot be filled even after difficulty fallback.
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

  const taqBefore = countRows(db, "SELECT COUNT(*) c FROM test_attempt_questions");
  const logBefore = countRows(db, "SELECT COUNT(*) c FROM question_serve_log");

  assert.throws(() => assembleModule2ForSection(db, attemptId, "rw"), /Not enough/);

  assert.equal(countRows(db, "SELECT COUNT(*) c FROM test_attempt_questions"), taqBefore);
  assert.equal(countRows(db, "SELECT COUNT(*) c FROM question_serve_log"), logBefore);
  const path = db
    .prepare("SELECT rw_module2_difficulty_path AS p FROM test_attempts WHERE id = ?")
    .get(attemptId) as { p: string | null };
  assert.equal(path.p, null, "the routing path written before the failure must roll back");
});

test("Practice Test 2 prefers fresh questions over Practice Test 1 when the bank allows", () => {
  const db = makeTestDb();

  const test1 = startNewAttempt(db, { practiceTest: 1 });
  const test1QuestionIds = new Set([
    ...test1.rw.map((q) => q.question.id),
    ...test1.math.map((q) => q.question.id),
  ]);

  const test2 = startNewAttempt(db, { practiceTest: 2 });
  const test2QuestionIds = [
    ...test2.rw.map((q) => q.question.id),
    ...test2.math.map((q) => q.question.id),
  ];

  for (const id of test2QuestionIds) {
    assert.equal(
      test1QuestionIds.has(id),
      false,
      `Test 2 must not reuse Test 1 question ${id}`,
    );
  }

  assert.deepEqual(
    db.prepare("SELECT practice_test FROM test_attempts WHERE id = ?").get(test2.attemptId),
    { practice_test: 2 },
  );
});

test("readModuleQuestions returns the student's saved work alongside the questions", () => {
  const db = makeTestDb();
  const { attemptId, rw } = startNewAttempt(db);

  // A freshly assembled module has no work on it yet -- and says so, rather than
  // omitting the field, so the two producers of AssembledModuleQuestion match.
  const fresh = readModuleQuestions(db, attemptId, "rw", 1);
  assert.equal(fresh.length, rw.length);
  assert.deepEqual(fresh[0].state, {
    userAnswer: null,
    flagged: false,
    crossedOutChoices: null,
    highlights: null,
  });
  assert.deepEqual(
    rw.map((q) => q.state),
    fresh.map((q) => q.state),
    "insertModuleQuestions and readModuleQuestions must agree on a fresh module",
  );

  // Write one of each kind of per-question state -- flagged/cross-out/highlights are
  // Epic 3 D5 plumbing with no UI yet, so this read path is the only thing proving the
  // columns are actually carried.
  const target = rw[3].question.id;
  saveAnswer(db, attemptId, "rw", 1, target, "C");
  db.prepare(
    `UPDATE test_attempt_questions
     SET flagged = 1, crossed_out_choices = ?, highlights = ?
     WHERE attempt_id = ? AND section = 'rw' AND module = 1 AND question_id = ?`,
  ).run('["A","B"]', '[{"start":0,"end":9}]', attemptId, target);

  const saved = readModuleQuestions(db, attemptId, "rw", 1);
  const row = saved.find((q) => q.question.id === target)!;
  assert.deepEqual(row.state, {
    userAnswer: "C",
    flagged: true,
    // Carried as raw JSON text on purpose: Epic 4 owns the parsed shape.
    crossedOutChoices: '["A","B"]',
    highlights: '[{"start":0,"end":9}]',
  });

  // Untouched rows stay untouched, and order_index order is preserved.
  assert.equal(saved[0].state.flagged, false);
  assert.deepEqual(
    saved.map((q) => q.orderIndex),
    rw.map((q) => q.orderIndex),
  );

  // is_correct is on the row and must not ride the read model to the client.
  assert.ok(
    !Object.prototype.hasOwnProperty.call(row.state, "isCorrect"),
    "correctness must not leak into a payload the runner ships to the browser",
  );
});
