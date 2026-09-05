/**
 * Unit tests for Epic 5 scoring (`lib/scoring.ts`).
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
import {
  computeRawScores,
  computeScaledScores,
  getAttemptScores,
  scoreAttempt,
} from "./scoring";
import { rawToScaledMath, rawToScaledRw } from "./scoringCurve";

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

function answerModule(
  db: Database.Database,
  attemptId: number,
  section: Section,
  module: 1 | 2,
  questions: AssembledModuleQuestion[],
  correctFraction: number,
): void {
  const correctCount = Math.round(questions.length * correctFraction);
  questions.forEach(({ question }, i) => {
    saveAnswer(
      db,
      attemptId,
      section,
      module,
      question.id,
      i < correctCount ? question.correct_answer : "B",
    );
  });
}

function submitFullAttempt(db: Database.Database, correctFraction = 0.5): number {
  const { attemptId, rw, math } = startNewAttempt(db);
  answerModule(db, attemptId, "rw", 1, rw, correctFraction);
  answerModule(db, attemptId, "math", 1, math, correctFraction);
  endModule1(db, attemptId, "rw");
  answerModule(db, attemptId, "rw", 2, readModuleQuestions(db, attemptId, "rw", 2), correctFraction);
  endModule2(db, attemptId, "rw");
  endBreak(db, attemptId);
  endModule1(db, attemptId, "math");
  answerModule(db, attemptId, "math", 2, readModuleQuestions(db, attemptId, "math", 2), correctFraction);
  endModule2(db, attemptId, "math");
  submitAttempt(db, attemptId);
  return attemptId;
}

test("computeRawScores aggregates module, section, and domain counts", () => {
  const db = makeTestDb();
  const attemptId = submitFullAttempt(db, 0.5);
  const raw = computeRawScores(db, attemptId);

  assert.equal(raw.sections.find((s) => s.section === "rw")?.total, 54);
  assert.equal(raw.sections.find((s) => s.section === "math")?.total, 44);
  assert.equal(raw.modules.length, 4);
  assert.equal(raw.domains.length, 8);

  const rwCorrect = raw.sections.find((s) => s.section === "rw")?.correct ?? 0;
  assert.ok(rwCorrect > 0 && rwCorrect < 54);
});

test("computeScaledScores applies approximate curves", () => {
  const raw = {
    modules: [],
    sections: [
      { section: "rw" as const, correct: 27, total: 54 },
      { section: "math" as const, correct: 22, total: 44 },
    ],
    domains: [],
  };
  const scores = computeScaledScores(1, raw);
  assert.equal(scores.rwScaled, rawToScaledRw(27));
  assert.equal(scores.mathScaled, rawToScaledMath(22));
  assert.equal(scores.totalScaled, scores.rwScaled + scores.mathScaled);
});

test("submitAttempt persists scaled scores on first delivery", () => {
  const db = makeTestDb();
  const attemptId = submitFullAttempt(db, 0.6);

  const row = db
    .prepare(
      `SELECT rw_scaled_score, math_scaled_score, total_scaled_score, status
       FROM test_attempts WHERE id = ?`,
    )
    .get(attemptId) as {
    rw_scaled_score: number;
    math_scaled_score: number;
    total_scaled_score: number;
    status: string;
  };

  assert.equal(row.status, "submitted");
  assert.ok(row.rw_scaled_score >= 200 && row.rw_scaled_score <= 800);
  assert.ok(row.math_scaled_score >= 200 && row.math_scaled_score <= 800);
  assert.equal(row.total_scaled_score, row.rw_scaled_score + row.math_scaled_score);
});

test("submitAttempt does not re-score on second delivery", () => {
  const db = makeTestDb();
  const attemptId = submitFullAttempt(db, 0.5);

  const before = db
    .prepare(
      `SELECT rw_scaled_score, math_scaled_score, total_scaled_score
       FROM test_attempts WHERE id = ?`,
    )
    .get(attemptId) as {
    rw_scaled_score: number;
    math_scaled_score: number;
    total_scaled_score: number;
  };

  submitAttempt(db, attemptId);

  const after = db
    .prepare(
      `SELECT rw_scaled_score, math_scaled_score, total_scaled_score
       FROM test_attempts WHERE id = ?`,
    )
    .get(attemptId) as {
    rw_scaled_score: number;
    math_scaled_score: number;
    total_scaled_score: number;
  };

  assert.deepEqual(after, before);
});

test("getAttemptScores rejects in-progress attempts", () => {
  const db = makeTestDb();
  const { attemptId } = startNewAttempt(db);
  assert.throws(() => getAttemptScores(db, attemptId), /is not submitted/);
});

test("scoreAttempt writes and getAttemptScores reads back", () => {
  const db = makeTestDb();
  const attemptId = submitFullAttempt(db, 0.4);
  const scores = getAttemptScores(db, attemptId);

  assert.equal(scores.attemptId, attemptId);
  assert.ok(scores.totalScaled >= 400 && scores.totalScaled <= 1600);
  assert.equal(scores.raw.sections.length, 2);
});
