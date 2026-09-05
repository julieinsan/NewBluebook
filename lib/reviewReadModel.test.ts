/**
 * Unit tests for post-submit review read model (`lib/reviewReadModel.ts`).
 */
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";
import { BLUEPRINT, type Section } from "./blueprint";
import {
  startNewAttempt,
  saveAnswer,
  readModuleQuestions,
  type AssembledModuleQuestion,
} from "./attemptService";
import { endBreak, endModule1, endModule2, submitAttempt } from "./moduleTransition";
import { readReviewQuestions } from "./reviewReadModel";

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

function answerAllCorrect(
  db: Database.Database,
  attemptId: number,
  section: Section,
  module: 1 | 2,
  questions: AssembledModuleQuestion[],
): void {
  for (const { question } of questions) {
    saveAnswer(db, attemptId, section, module, question.id, question.correct_answer);
  }
}

function submitMinimalAttempt(db: Database.Database): number {
  const { attemptId, rw, math } = startNewAttempt(db);
  answerAllCorrect(db, attemptId, "rw", 1, rw);
  answerAllCorrect(db, attemptId, "math", 1, math);
  endModule1(db, attemptId, "rw");
  answerAllCorrect(db, attemptId, "rw", 2, readModuleQuestions(db, attemptId, "rw", 2));
  endModule2(db, attemptId, "rw");
  endBreak(db, attemptId);
  endModule1(db, attemptId, "math");
  answerAllCorrect(db, attemptId, "math", 2, readModuleQuestions(db, attemptId, "math", 2));
  endModule2(db, attemptId, "math");
  submitAttempt(db, attemptId);
  return attemptId;
}

test("readReviewQuestions returns 98 questions in test order with answer key", () => {
  const db = makeTestDb();
  const attemptId = submitMinimalAttempt(db);
  const questions = readReviewQuestions(db, attemptId);

  assert.equal(questions.length, 98);
  assert.equal(questions[0].number, 1);
  assert.equal(questions[0].section, "rw");
  assert.equal(questions[0].module, 1);
  assert.equal(questions[53].section, "rw");
  assert.equal(questions[54].section, "math");

  for (const q of questions) {
    assert.equal(q.correctAnswer, "A");
    assert.equal(q.isCorrect, true);
    assert.equal(q.rationale, "stub rationale");
    assert.ok(Array.isArray(q.choices));
  }
});

test("readReviewQuestions sets wasRecycled when serve log predates this attempt", () => {
  const db = makeTestDb();
  const { attemptId, rw } = startNewAttempt(db);
  const questionId = rw[0].question.id;

  // Rebuild serve-log history: an older drill-session serve, then this attempt's.
  db.prepare("DELETE FROM question_serve_log WHERE question_id = ?").run(questionId);
  db.prepare("INSERT INTO drill_sessions (filters) VALUES ('{}')").run();
  const { id: sessionId } = db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number };
  db.prepare("INSERT INTO question_serve_log (question_id, session_id) VALUES (?, ?)").run(
    questionId,
    sessionId,
  );
  db.prepare("INSERT INTO question_serve_log (question_id, attempt_id) VALUES (?, ?)").run(
    questionId,
    attemptId,
  );

  const review = readReviewQuestions(db, attemptId);
  const row = review.find((q) => q.id === questionId);
  assert.ok(row);
  assert.equal(row.wasRecycled, true);
});
