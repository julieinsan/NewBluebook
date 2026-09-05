/**
 * Epic 3 Wave 4 end-to-end smoke test against the REAL local database.
 *
 * Drives the full test-taking flow through the domain layer the route handlers call:
 * start (with D9 idempotence and the R&W Module 1 clock stamp), answer saves, both
 * end-module transitions (with double delivery at each section boundary), the break,
 * final submit, and position/deadline invariants.
 *
 * Creates a real `test_attempts` row in `data/bluebook.db`, same as a student would.
 * Safe to re-run repeatedly.
 *
 * Usage: `npm run smoke:flow`
 */
import { getDb } from "../lib/db";
import { moduleQuestionCount, type ModuleNumber, type Section } from "../lib/blueprint";
import {
  startNewAttempt,
  saveAnswer,
  readModuleQuestions,
} from "../lib/attemptService";
import {
  getAttemptState,
  getRunnerModule,
  listAttempts,
  resolveCurrentPosition,
} from "../lib/attemptState";
import { saveAnswerWithDeadline } from "../lib/questionState";
import { endBreak, endModule1, endModule2, submitAttempt } from "../lib/moduleTransition";
import {
  LATE_ANSWER_GRACE_MS,
  formatSqliteTimestamp,
  moduleDeadline,
  moduleStartedAtColumn,
  moduleSubmittedAtColumn,
  pathForPosition,
  runnerPath,
} from "../lib/testFlow";

let failures = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  OK   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

function countModuleQuestions(
  db: ReturnType<typeof getDb>,
  attemptId: number,
  section: Section,
  module: ModuleNumber,
): number {
  return (
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM test_attempt_questions WHERE attempt_id = ? AND section = ? AND module = ?",
      )
      .get(attemptId, section, module) as { c: number }
  ).c;
}

function answerModule(
  db: ReturnType<typeof getDb>,
  attemptId: number,
  section: Section,
  module: ModuleNumber,
  questions: { question: { id: string; correct_answer: string } }[],
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

/** Mirrors POST /api/attempts. */
function startOrResumeAttempt(db: ReturnType<typeof getDb>): {
  attemptId: number;
  reused: boolean;
} {
  const existing = listAttempts(db).find((attempt) => attempt.resumable);
  if (existing) {
    return { attemptId: existing.attemptId, reused: true };
  }

  const { attemptId } = startNewAttempt(db);
  const column = moduleStartedAtColumn("rw", 1);
  db.prepare(
    `UPDATE test_attempts SET ${column} = datetime('now') WHERE id = ? AND ${column} IS NULL`,
  ).run(attemptId);

  return { attemptId, reused: false };
}

function main() {
  const db = getDb();

  const preExistingResumables = listAttempts(db).filter((attempt) => attempt.resumable);
  if (preExistingResumables.length > 0) {
    console.log(
      `NOTE: ${preExistingResumables.length} in-progress attempt(s) already in DB ` +
        `(ids: ${preExistingResumables.map((a) => a.attemptId).join(", ")}) — ` +
        `D9 checks skipped (covered by lib/testFlowLifecycle.test.ts)`,
    );
  }
  const skipD9 = preExistingResumables.length > 0;

  console.log("\n=== Start new attempt (fresh row for deterministic smoke) ===");
  const { attemptId } = startNewAttempt(db);
  const column = moduleStartedAtColumn("rw", 1);
  db.prepare(
    `UPDATE test_attempts SET ${column} = datetime('now') WHERE id = ? AND ${column} IS NULL`,
  ).run(attemptId);
  console.log(`attemptId = ${attemptId}`);
  check("startNewAttempt returns a positive attempt id", attemptId > 0);

  console.log("\n=== Module 1 question counts ===");
  for (const section of ["rw", "math"] as Section[]) {
    const expected = moduleQuestionCount(section, 1);
    const got = countModuleQuestions(db, attemptId, section, 1);
    check(`${section} Module 1 = ${expected}`, got === expected, `got ${got}`);
  }

  console.log("\n=== Answer Module 1 for both sections ===");
  const rwModule1 = readModuleQuestions(db, attemptId, "rw", 1);
  const mathModule1 = readModuleQuestions(db, attemptId, "math", 1);
  answerModule(db, attemptId, "rw", 1, rwModule1, 0.7);
  answerModule(db, attemptId, "math", 1, mathModule1, 0.4);

  console.log("\n=== R&W endModule1 with double delivery ===");
  const rwEnd1First = endModule1(db, attemptId, "rw");
  const rwEnd1Second = endModule1(db, attemptId, "rw");
  check("R&W endModule1 first delivery finalizes", rwEnd1First.finalizedNow);
  check("R&W endModule1 second delivery takes seam path", !rwEnd1Second.finalizedNow);
  check(
    "R&W Module 2 question count = 27",
    countModuleQuestions(db, attemptId, "rw", 2) === 27,
    `got ${countModuleQuestions(db, attemptId, "rw", 2)}`,
  );
  check(
    "double delivery returns the same Module 2 ids",
    rwEnd1Second.module2.questions.map((q) => q.question.id).join(",") ===
      rwEnd1First.module2.questions.map((q) => q.question.id).join(","),
  );

  const rwModule2StartedAt = (
    db
      .prepare("SELECT rw_module2_started_at AS v FROM test_attempts WHERE id = ?")
      .get(attemptId) as { v: string }
  ).v;
  check("R&W Module 2 clock is stamped", Boolean(rwModule2StartedAt));

  console.log("\n=== Resume position and deadline stability ===");
  const positionBefore = resolveCurrentPosition(getAttemptState(db, attemptId));
  const runnerBefore = getRunnerModule(db, attemptId, "rw", 2);
  const positionAfter = resolveCurrentPosition(getAttemptState(db, attemptId));
  const runnerAfter = getRunnerModule(db, attemptId, "rw", 2, Date.now() + 5000);
  check(
    "position is stable across re-read (refresh)",
    positionBefore.kind === "module" &&
      positionAfter.kind === "module" &&
      positionBefore.section === "rw" &&
      positionBefore.module === 2,
  );
  check(
    "deadline is stable across re-read (refresh)",
    runnerBefore.timer.deadline === runnerAfter.timer.deadline,
  );
  check(
    "deadline matches the stored stamp",
    runnerBefore.timer.deadline === moduleDeadline("rw", 2, rwModule2StartedAt),
  );
  check(
    "pathForPosition matches runner route",
    pathForPosition(attemptId, positionBefore) === runnerPath(attemptId, "rw", 2),
  );

  console.log("\n=== Expired-module answer rejection ===");
  db.prepare("UPDATE test_attempts SET rw_module2_started_at = ? WHERE id = ?").run(
    formatSqliteTimestamp(Date.UTC(2020, 0, 1, 0, 0, 0)),
    attemptId,
  );
  const expiredQuestionId = readModuleQuestions(db, attemptId, "rw", 2)[0].question.id;
  const expiredDeadline = moduleDeadline(
    "rw",
    2,
    formatSqliteTimestamp(Date.UTC(2020, 0, 1, 0, 0, 0)),
  );
  const lateResult = saveAnswerWithDeadline(
    db,
    attemptId,
    "rw",
    2,
    expiredQuestionId,
    "C",
    expiredDeadline + LATE_ANSWER_GRACE_MS + 1,
  );
  check("answer past grace window is not saved", !lateResult.saved);
  check("answer past grace window is reported late", lateResult.isLate);

  console.log("\n=== R&W Module 2 -> break (double delivery) ===");
  answerModule(db, attemptId, "rw", 2, readModuleQuestions(db, attemptId, "rw", 2), 0.6);
  const rwEnd2First = endModule2(db, attemptId, "rw");
  const breakStartedAt = rwEnd2First.breakStartedAt;
  const rwEnd2Second = endModule2(db, attemptId, "rw");
  check("R&W Module 2 ends and stamps break_started_at", Boolean(breakStartedAt));
  check("R&W endModule2 second delivery is idempotent", !rwEnd2Second.submittedNow);
  check("break_started_at unchanged on retry", rwEnd2Second.breakStartedAt === breakStartedAt);
  check(
    "position resolves to break",
    resolveCurrentPosition(getAttemptState(db, attemptId)).kind === "break",
  );

  console.log("\n=== Break -> Math Module 1 ===");
  const breakEndFirst = endBreak(db, attemptId);
  const breakEndSecond = endBreak(db, attemptId);
  check("endBreak starts Math Module 1", Boolean(breakEndFirst.mathModule1StartedAt));
  check("endBreak second delivery is idempotent", !breakEndSecond.startedNow);
  check(
    "Math Module 1 question count = 22",
    countModuleQuestions(db, attemptId, "math", 1) === 22,
    `got ${countModuleQuestions(db, attemptId, "math", 1)}`,
  );

  console.log("\n=== Math endModule1 with double delivery ===");
  answerModule(db, attemptId, "math", 1, mathModule1, 0.5);
  const mathEnd1First = endModule1(db, attemptId, "math");
  const mathEnd1Second = endModule1(db, attemptId, "math");
  check("Math endModule1 first delivery finalizes", mathEnd1First.finalizedNow);
  check("Math endModule1 second delivery takes seam path", !mathEnd1Second.finalizedNow);
  check(
    "Math Module 2 question count = 22",
    countModuleQuestions(db, attemptId, "math", 2) === 22,
    `got ${countModuleQuestions(db, attemptId, "math", 2)}`,
  );

  console.log("\n=== Math Module 2 -> submit (double delivery) ===");
  answerModule(db, attemptId, "math", 2, readModuleQuestions(db, attemptId, "math", 2), 0.5);
  const mathEnd2First = endModule2(db, attemptId, "math");
  const mathEnd2Second = endModule2(db, attemptId, "math");
  check("Math Module 2 ends (D10)", Boolean(mathEnd2First.submittedAt));
  check("Math endModule2 second delivery is idempotent", !mathEnd2Second.submittedNow);
  check(
    "position resolves to submitted before status flip",
    resolveCurrentPosition(getAttemptState(db, attemptId)).kind === "submitted",
  );
  check(
    "status still in_progress in D10 window",
    (db.prepare("SELECT status FROM test_attempts WHERE id = ?").get(attemptId) as { status: string })
      .status === "in_progress",
  );

  const submitFirst = submitAttempt(db, attemptId);
  const submitSecond = submitAttempt(db, attemptId);
  check("submitAttempt marks status submitted", submitFirst.submittedNow);
  check("submitAttempt second delivery is idempotent", !submitSecond.submittedNow);
  check(
    "all four module submitted-at stamps are set",
    ["rw", "math"].every((section) =>
      [1, 2].every((module) => {
        const column = moduleSubmittedAtColumn(section as Section, module as ModuleNumber);
        return Boolean(
          (db.prepare(`SELECT ${column} AS v FROM test_attempts WHERE id = ?`).get(attemptId) as {
            v: string | null;
          }).v,
        );
      }),
    ),
  );

  console.log("\n=== Double-start idempotence (D9) ===");
  if (skipD9) {
    console.log("  SKIP D9 smoke — pre-existing in-progress attempts in DB");
  } else {
    const d9First = startOrResumeAttempt(db);
    check("after submit, start creates a new in-progress attempt", !d9First.reused);
    const d9Second = startOrResumeAttempt(db);
    check("immediate second start reuses that attempt (D9)", d9Second.reused);
    check(
      "D9 returns the same attemptId twice",
      d9Second.attemptId === d9First.attemptId,
      `got ${d9Second.attemptId} vs ${d9First.attemptId}`,
    );
  }

  console.log(`\n=== Result: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
