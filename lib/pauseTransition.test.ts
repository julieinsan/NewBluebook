/**
 * Unit tests for practice-app pause/resume (migration 0010).
 */
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";
import { BLUEPRINT, type Section } from "./blueprint";
import { startNewAttempt, saveAnswer, type AssembledModuleQuestion } from "./attemptService";
import { getAttemptState, getRunnerModule, resolveCurrentPosition } from "./attemptState";
import { endBreak, endModule1, endModule2 } from "./moduleTransition";
import { pauseAttempt, resumeAttempt } from "./pauseTransition";
import { saveAnswerWithDeadline } from "./questionState";
import {
  effectiveModuleDeadline,
  formatSqliteTimestamp,
  moduleStartedAtColumn,
  parseSqliteTimestamp,
  pauseSecondsColumn,
  secondsRemaining,
  type EpochMillis,
} from "./testFlow";

const PER_BUCKET = 20;
const MODULE_START: EpochMillis = Date.UTC(2026, 8, 5, 9, 0, 0);

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

function stampModule(
  db: Database.Database,
  attemptId: number,
  section: Section,
  module: 1 | 2,
  at: EpochMillis,
): void {
  db.prepare(
    `UPDATE test_attempts SET ${moduleStartedAtColumn(section, module)} = ? WHERE id = ?`,
  ).run(formatSqliteTimestamp(at), attemptId);
}

function runningAttempt(): {
  db: Database.Database;
  attemptId: number;
  rw: AssembledModuleQuestion[];
} {
  const db = makeTestDb();
  const { attemptId, rw } = startNewAttempt(db);
  stampModule(db, attemptId, "rw", 1, MODULE_START);
  return { db, attemptId, rw };
}

test("pauseAttempt freezes the module countdown until resume", () => {
  const { db, attemptId } = runningAttempt();
  const beforePause = Date.UTC(2026, 8, 5, 9, 10, 0);

  pauseAttempt(db, attemptId);
  db.prepare("UPDATE test_attempts SET paused_at = ? WHERE id = ?").run(
    formatSqliteTimestamp(beforePause),
    attemptId,
  );

  const state = getAttemptState(db, attemptId);
  assert.ok(state.pausedAt);

  const runnerWhilePaused = getRunnerModule(db, attemptId, "rw", 1, beforePause);
  assert.equal(runnerWhilePaused.timer.paused, true);
  assert.equal(
    secondsRemaining(runnerWhilePaused.timer.deadline, runnerWhilePaused.timer.serverNow),
    secondsRemaining(
      effectiveModuleDeadline("rw", 1, formatSqliteTimestamp(MODULE_START), 0),
      parseSqliteTimestamp(state.pausedAt!),
    ),
  );

  const remainingAtPause = secondsRemaining(
    runnerWhilePaused.timer.deadline,
    runnerWhilePaused.timer.serverNow,
  );

  // Ten minutes of wall time pass while paused — remaining must not move.
  const tenMinutesLater = beforePause + 10 * 60_000;
  const stillPaused = getRunnerModule(db, attemptId, "rw", 1, tenMinutesLater);
  assert.equal(
    secondsRemaining(stillPaused.timer.deadline, stillPaused.timer.serverNow),
    remainingAtPause,
  );

  const resumed = resumeAttempt(db, attemptId, tenMinutesLater);
  assert.equal(resumed.resumedNow, true);
  assert.deepEqual(resolveCurrentPosition(getAttemptState(db, attemptId)), {
    kind: "module",
    section: "rw",
    module: 1,
  });

  const afterResume = getRunnerModule(db, attemptId, "rw", 1, tenMinutesLater);
  assert.ok(!afterResume.timer.paused);
  assert.equal(
    secondsRemaining(afterResume.timer.deadline, afterResume.timer.serverNow),
    remainingAtPause,
  );
});

test("pause and resume are idempotent", () => {
  const { db, attemptId } = runningAttempt();

  const first = pauseAttempt(db, attemptId);
  const pausedAt = first.pausedAt;
  const second = pauseAttempt(db, attemptId);

  assert.equal(second.pausedNow, false);
  assert.equal(second.pausedAt, pausedAt);

  const resumed = resumeAttempt(db, attemptId);
  assert.equal(resumed.resumedNow, true);
  assert.equal(resumeAttempt(db, attemptId).resumedNow, false);
});

test("answers are not saved while paused", () => {
  const { db, attemptId, rw } = runningAttempt();
  const questionId = rw[0].question.id;

  saveAnswer(db, attemptId, "rw", 1, questionId, "A");
  pauseAttempt(db, attemptId);

  const result = saveAnswerWithDeadline(
    db,
    attemptId,
    "rw",
    1,
    questionId,
    "B",
    MODULE_START + 60_000,
  );
  assert.deepEqual(result, { saved: false, isLate: false });
  assert.equal(
    (
      db
        .prepare(
          "SELECT user_answer FROM test_attempt_questions WHERE attempt_id = ? AND question_id = ? AND module = 1",
        )
        .get(attemptId, questionId) as { user_answer: string }
    ).user_answer,
    "A",
  );
});

test("cannot pause a submitted attempt", () => {
  const db = makeTestDb();
  const { attemptId, rw, math } = startNewAttempt(db);
  stampModule(db, attemptId, "rw", 1, MODULE_START);
  for (const { question } of rw) {
    saveAnswer(db, attemptId, "rw", 1, question.id, "A");
  }
  for (const { question } of math) {
    saveAnswer(db, attemptId, "math", 1, question.id, "A");
  }
  endModule1(db, attemptId, "rw");
  endModule2(db, attemptId, "rw");
  endBreak(db, attemptId);
  endModule1(db, attemptId, "math");
  endModule2(db, attemptId, "math");

  assert.throws(() => pauseAttempt(db, attemptId), /finished/);
});

test("pause during break accumulates break_pause_seconds on resume", () => {
  const db = makeTestDb();
  const { attemptId, rw } = startNewAttempt(db);
  stampModule(db, attemptId, "rw", 1, MODULE_START);
  for (const { question } of rw) {
    saveAnswer(db, attemptId, "rw", 1, question.id, "A");
  }
  endModule1(db, attemptId, "rw");
  endModule2(db, attemptId, "rw");

  pauseAttempt(db, attemptId);
  assert.equal(getAttemptState(db, attemptId).pausedPhase, "break");

  const pausedAt = getAttemptState(db, attemptId).pausedAt!;
  db.prepare(`UPDATE test_attempts SET paused_at = ? WHERE id = ?`).run(
    formatSqliteTimestamp(parseSqliteTimestamp(pausedAt) - 120_000),
    attemptId,
  );

  const pausedAtMs = parseSqliteTimestamp(getAttemptState(db, attemptId).pausedAt!);
  resumeAttempt(db, attemptId, pausedAtMs + 120_000);

  const breakPause = (
    db
      .prepare(`SELECT ${pauseSecondsColumn("break")} AS v FROM test_attempts WHERE id = ?`)
      .get(attemptId) as { v: number }
  ).v;
  assert.ok(breakPause >= 120, `expected at least 120 pause seconds, got ${breakPause}`);
});
