/**
 * Story 2.2 unit tests: fresh pool, partially exhausted pool, fully exhausted pool.
 *
 * Uses an in-memory SQLite DB (schema loaded via the real migration files) seeded with
 * synthetic questions, so these tests don't touch the real `data/bluebook.db`.
 *
 * Run with: `npm test` (node's built-in test runner via tsx).
 */
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";
import { selectQuestions } from "./questionSelector";

function makeTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

function insertQuestion(
  db: Database.Database,
  id: string,
  overrides: Partial<{ domain: string; skill: string; difficulty: string }> = {},
) {
  db.prepare(
    `INSERT INTO questions
      (id, section, domain, skill, difficulty, question_type, stimulus_text, choice_a, choice_b, choice_c, choice_d, correct_answer, rationale)
     VALUES (?, 'math', ?, ?, ?, 'mc', 'stub stimulus', 'a', 'b', 'c', 'd', 'A', 'stub rationale')`,
  ).run(
    id,
    overrides.domain ?? "Algebra",
    overrides.skill ?? "Linear functions",
    overrides.difficulty ?? "medium",
  );
}

function makeAttempt(db: Database.Database): number {
  const info = db.prepare("INSERT INTO test_attempts DEFAULT VALUES").run();
  return info.lastInsertRowid as number;
}

test("fresh pool: never-served questions are all returned, and all get logged", () => {
  const db = makeTestDb();
  const attemptId = makeAttempt(db);
  for (let i = 0; i < 5; i++) insertQuestion(db, `q${i}`);

  const selected = selectQuestions(db, {
    section: "math",
    domain: "Algebra",
    difficulty: "medium",
    count: 3,
    attemptId,
  });

  assert.equal(selected.length, 3);
  const ids = selected.map((q) => q.id);
  assert.equal(new Set(ids).size, 3, "no duplicates");
  for (const q of selected) {
    assert.equal(q.wasRecycled, false, "fresh pool should not be flagged as recycled");
  }

  const loggedCount = db
    .prepare("SELECT COUNT(*) AS c FROM question_serve_log WHERE attempt_id = ?")
    .get(attemptId) as { c: number };
  assert.equal(loggedCount.c, 3, "every returned question is logged immediately");
});

test("partially exhausted pool: prefers never-served remainder over already-served ones", () => {
  const db = makeTestDb();
  const attempt1 = makeAttempt(db);
  const attempt2 = makeAttempt(db);
  for (let i = 0; i < 5; i++) insertQuestion(db, `q${i}`);

  // Serve 2 of the 5 questions first (attempt 1).
  const firstBatch = selectQuestions(db, {
    section: "math",
    domain: "Algebra",
    difficulty: "medium",
    count: 2,
    attemptId: attempt1,
  });
  assert.equal(firstBatch.length, 2);
  const servedIds = new Set(firstBatch.map((q) => q.id));

  // Now request all 5 for a new attempt: the 3 never-served ones must come first (in
  // whatever order), and only once those are exhausted should previously-served ones
  // reappear.
  const secondBatch = selectQuestions(db, {
    section: "math",
    domain: "Algebra",
    difficulty: "medium",
    count: 5,
    attemptId: attempt2,
  });
  assert.equal(secondBatch.length, 5, "all 5 distinct questions in the domain are returned");

  const firstThreeIds = secondBatch.slice(0, 3).map((q) => q.id);
  for (const id of firstThreeIds) {
    assert.equal(servedIds.has(id), false, "never-served questions come before recycled ones");
  }
  const lastTwoIds = secondBatch.slice(3).map((q) => q.id);
  for (const id of lastTwoIds) {
    assert.equal(servedIds.has(id), true, "recycled questions only appear once fresh ones are exhausted");
  }
  assert.equal(secondBatch[3].wasRecycled, true);
  assert.equal(secondBatch[4].wasRecycled, true);
});

test("fully exhausted pool: recycling kicks in and prefers oldest served_at", () => {
  const db = makeTestDb();
  const attempt1 = makeAttempt(db);
  const attempt2 = makeAttempt(db);
  for (let i = 0; i < 3; i++) insertQuestion(db, `q${i}`);

  // Serve all 3 in a known order, with distinct, controlled served_at timestamps so
  // recency order is unambiguous (avoids relying on same-second insert ordering).
  const order = ["q1", "q0", "q2"]; // q1 oldest, q2 most recent
  const insertLog = db.prepare(
    "INSERT INTO question_serve_log (question_id, attempt_id, served_at) VALUES (?, ?, ?)",
  );
  order.forEach((id, i) => {
    insertLog.run(id, attempt1, `2020-01-0${i + 1}T00:00:00Z`);
  });

  // Every question in the domain now has a serve_log entry -- pool is fully exhausted.
  const selected = selectQuestions(db, {
    section: "math",
    domain: "Algebra",
    difficulty: "medium",
    count: 2,
    attemptId: attempt2,
  });

  assert.equal(selected.length, 2);
  assert.deepEqual(
    selected.map((q) => q.id),
    ["q1", "q0"],
    "oldest served_at (q1) comes first, then next-oldest (q0); most-recent (q2) is last",
  );
  for (const q of selected) {
    assert.equal(q.wasRecycled, true);
  }

  // Confirm the recycling itself was logged (new rows, not just the original 3).
  const totalLogRows = db.prepare("SELECT COUNT(*) AS c FROM question_serve_log").get() as {
    c: number;
  };
  assert.equal(totalLogRows.c, 3 + 2, "recycled selections are logged as new serve_log rows too");
});

test("excludeIds and skill filters are respected, and count larger than the pool returns fewer", () => {
  const db = makeTestDb();
  const attemptId = makeAttempt(db);
  insertQuestion(db, "q0", { skill: "Linear functions" });
  insertQuestion(db, "q1", { skill: "Linear functions" });
  insertQuestion(db, "q2", { skill: "Linear equations in one variable" });

  const bySkill = selectQuestions(db, {
    section: "math",
    domain: "Algebra",
    skill: "Linear functions",
    difficulty: "medium",
    count: 5,
    attemptId,
  });
  assert.equal(bySkill.length, 2, "skill filter narrows the pool");

  const attempt2 = makeAttempt(db);
  const excluded = selectQuestions(db, {
    section: "math",
    domain: "Algebra",
    difficulty: "medium",
    count: 5,
    attemptId: attempt2,
    excludeIds: ["q0", "q1", "q2"],
  });
  assert.equal(excluded.length, 0, "excluding every matching id leaves nothing to return");
});

test("throws unless exactly one of attemptId/sessionId is supplied", () => {
  const db = makeTestDb();
  insertQuestion(db, "q0");
  assert.throws(() =>
    selectQuestions(db, { section: "math", domain: "Algebra", difficulty: "medium", count: 1 }),
  );

  const attemptId = makeAttempt(db);
  const sessionInfo = db.prepare("INSERT INTO drill_sessions DEFAULT VALUES").run();
  assert.throws(() =>
    selectQuestions(db, {
      section: "math",
      domain: "Algebra",
      difficulty: "medium",
      count: 1,
      attemptId,
      sessionId: sessionInfo.lastInsertRowid as number,
    }),
  );
});
