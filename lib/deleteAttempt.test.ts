/**
 * Unit tests for attempt deletion from the home screen.
 */
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";
import { BLUEPRINT, type Section } from "./blueprint";
import { MODULE1_DIFFICULTY_MIX, splitByDifficulty } from "./moduleAssembly";
import { startNewAttempt } from "./attemptService";
import { deleteAttempt } from "./deleteAttempt";

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
    for (const { domain, module1 } of BLUEPRINT[section].domains) {
      const targets = splitByDifficulty(module1, MODULE1_DIFFICULTY_MIX);
      for (const difficulty of ["easy", "medium", "hard"] as const) {
        for (let i = 0; i < targets[difficulty]; i++) {
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

test("deleteAttempt removes attempt rows and related records", () => {
  const db = makeTestDb();
  const { attemptId } = startNewAttempt(db, { practiceTest: 1 });

  assert.ok(countRows(db, "SELECT COUNT(*) AS c FROM test_attempts WHERE id = ?", attemptId) === 1);
  assert.ok(
    countRows(db, "SELECT COUNT(*) AS c FROM test_attempt_questions WHERE attempt_id = ?", attemptId) >
      0,
  );
  assert.ok(
    countRows(db, "SELECT COUNT(*) AS c FROM question_serve_log WHERE attempt_id = ?", attemptId) > 0,
  );

  deleteAttempt(db, attemptId);

  assert.equal(countRows(db, "SELECT COUNT(*) AS c FROM test_attempts WHERE id = ?", attemptId), 0);
  assert.equal(
    countRows(db, "SELECT COUNT(*) AS c FROM test_attempt_questions WHERE attempt_id = ?", attemptId),
    0,
  );
  assert.equal(
    countRows(db, "SELECT COUNT(*) AS c FROM question_serve_log WHERE attempt_id = ?", attemptId),
    0,
  );
});

test("deleteAttempt throws when attempt does not exist", () => {
  const db = makeTestDb();
  assert.throws(() => deleteAttempt(db, 999), /does not exist/);
});
