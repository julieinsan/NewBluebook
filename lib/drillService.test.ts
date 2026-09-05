/**
 * Unit tests for Epic 6 drill service.
 */
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";
import { BLUEPRINT, type Section } from "./blueprint";
import {
  addDrillTimeSpent,
  getDrillRunnerState,
  getDrillSessionSummary,
  listDrillDomainOptions,
  saveDrillAnswer,
  serveNextDrillQuestion,
  startDrillSession,
} from "./drillService";

function makeTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const insert = db.prepare(
    `INSERT INTO questions
      (id, section, domain, skill, difficulty, question_type, stimulus_text,
       choice_a, choice_b, choice_c, choice_d, correct_answer, rationale)
     VALUES (?, ?, ?, ?, ?, 'mc', 'stub', 'a', 'b', 'c', 'd', ?, 'because')`,
  );

  for (const section of ["rw", "math"] as Section[]) {
    for (const { domain } of BLUEPRINT[section].domains) {
      insert.run(`${section}-${domain}-easy`, section, domain, "Skill A", "easy", "A");
      insert.run(`${section}-${domain}-hard`, section, domain, "Skill B", "hard", "B");
    }
  }

  return db;
}

test("listDrillDomainOptions returns domains with skills", () => {
  const db = makeTestDb();
  const options = listDrillDomainOptions(db);
  assert.ok(options.length >= 8);
  const algebra = options.find((row) => row.domain === "Algebra");
  assert.ok(algebra);
  assert.equal(algebra.section, "math");
  assert.deepEqual(algebra.skills.sort(), ["Skill A", "Skill B"]);
});

test("startDrillSession serves first question and grades with instant feedback", () => {
  const db = makeTestDb();
  const { sessionId, state } = startDrillSession(db, {
    domain: "Algebra",
    skill: null,
    difficulty: "easy",
  });

  assert.ok(sessionId > 0);
  assert.ok(state.question);
  assert.equal(state.feedback, null);
  assert.equal(state.stats.answered, 0);

  const afterCorrect = saveDrillAnswer(db, sessionId, state.question!.id, "A");
  assert.ok(afterCorrect.feedback);
  assert.equal(afterCorrect.feedback!.isCorrect, true);
  assert.equal(afterCorrect.stats.answered, 1);
  assert.equal(afterCorrect.stats.correct, 1);
});

test("saveDrillAnswer records incorrect responses", () => {
  const db = makeTestDb();
  const { sessionId, state } = startDrillSession(db, {
    domain: "Algebra",
    skill: null,
    difficulty: "hard",
  });
  const wrong = saveDrillAnswer(db, sessionId, state.question!.id, "A");
  assert.equal(wrong.feedback!.isCorrect, false);
  assert.equal(wrong.stats.correct, 0);
});

test("addDrillTimeSpent accumulates on the active question row", () => {
  const db = makeTestDb();
  const { sessionId, state } = startDrillSession(db, {
    domain: "Algebra",
    skill: null,
    difficulty: "easy",
  });
  addDrillTimeSpent(db, sessionId, state.question!.id, 12);
  addDrillTimeSpent(db, sessionId, state.question!.id, 8);
  saveDrillAnswer(db, sessionId, state.question!.id, "A");
  const summary = getDrillSessionSummary(db, sessionId);
  assert.equal(summary.answered, 1);
  assert.equal(summary.correct, 1);
  assert.equal(summary.accuracyPercent, 100);

  const runner = getDrillRunnerState(db, sessionId);
  assert.equal(runner.feedback!.timeSpentSeconds, 20);
});

test("serveNextDrillQuestion stops when the filtered pool is exhausted", () => {
  const db = makeTestDb();
  const { sessionId, state } = startDrillSession(db, {
    domain: "Algebra",
    skill: "Skill A",
    difficulty: "easy",
  });
  saveDrillAnswer(db, sessionId, state.question!.id, "A");
  const next = serveNextDrillQuestion(db, sessionId);
  assert.equal(next.question, null);
  assert.equal(next.canLoadMore, false);
});
