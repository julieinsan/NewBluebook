/**
 * Unit tests for Epic 3 Task 1.3 -- per-question state writes (`lib/questionState.ts`).
 *
 * Three things are under test and only one of them is ordinary CRUD:
 *
 *  1. **D3's soft deadline.** An answer before the buzzer saves and reports on-time; one
 *     inside `LATE_ANSWER_GRACE_MS` saves and reports late; one past it is refused and
 *     leaves the previously saved answer alone.
 *  2. **§6 rule 7 -- the timezone hazard.** This whole file runs under a deliberately
 *     non-UTC `TZ`, because the bug it guards against is invisible in a UTC-only run and
 *     the grace window is a five-second target sitting in front of a four-hour error.
 *  3. **D12's asymmetry.** Flagging and cross-out are *not* deadline-checked, and the
 *     test for that is only meaningful if the module is genuinely expired when it runs.
 *
 * Time is injected, never faked: every function under test takes `now` as a parameter and
 * every module clock is stamped by writing a chosen timestamp into `test_attempts`. There
 * is no clock manipulation anywhere in this file, which is what lets a test place an
 * event exactly one millisecond past the grace window.
 *
 * Uses an in-memory SQLite DB built from the real migration files and seeded with
 * synthetic questions, exactly like `attemptService.test.ts`; nothing here touches
 * `data/bluebook.db`.
 *
 * Run with: `npm test`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";
import { BLUEPRINT, type ModuleNumber, type Section } from "./blueprint";
import {
  startNewAttempt,
  submitModule1Answers,
  assembleModule2ForSection,
  readModuleQuestions,
  type AssembledModuleQuestion,
} from "./attemptService";
import {
  LATE_ANSWER_GRACE_MS,
  formatSqliteTimestamp,
  moduleStartedAtColumn,
  parseSqliteTimestamp,
  type EpochMillis,
} from "./testFlow";
import { saveAnswerWithDeadline, setChoiceState, setFlag, addTimeSpent } from "./questionState";

/**
 * Run the whole file outside UTC.
 *
 * This is the point of the exercise, not a detail. `datetime('now')` writes
 * `"2026-09-05 09:00:00"` -- UTC with no `T` and no `Z` -- and V8 parses that as *local*
 * time, so any deadline computed with `new Date(startedAt)` shifts by the machine's UTC
 * offset. In US Eastern that is 240 minutes against a 32-minute module: every answer
 * would be either refused on load or accepted hours late, and CI (UTC) would show nothing
 * at all. Setting `TZ` here means every deadline assertion below, not just the one test
 * that names timezones, is executed against a clock that would expose the bug.
 *
 * `node --test` runs each test file in its own process, so this cannot leak into the
 * other suites.
 */
process.env.TZ = "America/New_York";

/** Generous per-(domain, difficulty) supply so no domain is ever the constraint. */
const PER_BUCKET = 20;

/** A fixed, arbitrary UTC instant to start module clocks from. */
const MODULE_START: EpochMillis = Date.UTC(2026, 8, 5, 9, 0, 0);

/**
 * R&W's deadline for a module started at `MODULE_START`, written out by hand.
 *
 * Deliberately not `moduleDeadline(...)`: if the deadline under test and the deadline the
 * test expects came from the same function, a timezone bug inside it would cancel out and
 * every assertion here would pass while the student's clock was four hours wrong. This
 * literal is the independent check.
 */
const RW_DEADLINE: EpochMillis = MODULE_START + 32 * 60 * 1000;

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

/**
 * Stamps a module's clock directly, standing in for the Route Handler that owns the stamp
 * in production (D3a). Writing a chosen instant is what makes an "expired module" a
 * one-line fixture instead of a faked global clock.
 */
function startModuleClock(
  db: Database.Database,
  attemptId: number,
  section: Section,
  module: ModuleNumber,
  startedAt: EpochMillis,
): void {
  db.prepare(
    `UPDATE test_attempts SET ${moduleStartedAtColumn(section, module)} = ? WHERE id = ?`,
  ).run(formatSqliteTimestamp(startedAt), attemptId);
}

/** An attempt whose R&W Module 1 clock started at `MODULE_START`. */
function attemptWithRunningRwModule1(): {
  db: Database.Database;
  attemptId: number;
  rw: AssembledModuleQuestion[];
} {
  const db = makeTestDb();
  const { attemptId, rw } = startNewAttempt(db);
  startModuleClock(db, attemptId, "rw", 1, MODULE_START);
  return { db, attemptId, rw };
}

/** The stored columns, read raw so the tests assert against the database, not a mapper. */
interface StoredQuestionRow {
  user_answer: string | null;
  is_correct: number | null;
  flagged: number;
  crossed_out_choices: string | null;
  highlights: string | null;
  time_spent_seconds: number;
}

function readRow(
  db: Database.Database,
  attemptId: number,
  questionId: string,
  module: ModuleNumber = 1,
): StoredQuestionRow {
  return db
    .prepare(
      `SELECT user_answer, is_correct, flagged, crossed_out_choices, highlights, time_spent_seconds
       FROM test_attempt_questions
       WHERE attempt_id = ? AND question_id = ? AND module = ?`,
    )
    .get(attemptId, questionId, module) as StoredQuestionRow;
}

// ---------------------------------------------------------------------------
// D3 -- the grace window
// ---------------------------------------------------------------------------

test("an answer well before the deadline is saved and reported on time", () => {
  const { db, attemptId, rw } = attemptWithRunningRwModule1();
  const questionId = rw[0].question.id;

  const result = saveAnswerWithDeadline(
    db,
    attemptId,
    "rw",
    1,
    questionId,
    "A",
    MODULE_START + 60_000,
  );

  assert.deepEqual(result, { saved: true, isLate: false });
  const row = readRow(db, attemptId, questionId);
  assert.equal(row.user_answer, "A");
  // Grading still happens -- this wraps saveAnswer, it does not replace it -- even though
  // correctness never travels back to the caller (§5.5: "never returns correctness").
  assert.equal(row.is_correct, 1);
  assert.ok(!Object.prototype.hasOwnProperty.call(result, "isCorrect"));
});

test("an answer inside the 5-second grace window is saved but reported late", () => {
  const { db, attemptId, rw } = attemptWithRunningRwModule1();
  const questionId = rw[0].question.id;

  // The buzzer has gone; the student's last click is still in flight. D3 keeps it.
  const justLate = saveAnswerWithDeadline(
    db,
    attemptId,
    "rw",
    1,
    questionId,
    "B",
    RW_DEADLINE + 1,
  );
  assert.deepEqual(justLate, { saved: true, isLate: true });
  assert.equal(readRow(db, attemptId, questionId).user_answer, "B");

  // The last millisecond of the window is still inside it.
  const atEdge = saveAnswerWithDeadline(
    db,
    attemptId,
    "rw",
    1,
    questionId,
    "C",
    RW_DEADLINE + LATE_ANSWER_GRACE_MS,
  );
  assert.deepEqual(atEdge, { saved: true, isLate: true });
  assert.equal(readRow(db, attemptId, questionId).user_answer, "C");

  // And the deadline itself is not late -- an answer landing exactly on it is on time.
  const onTheDot = saveAnswerWithDeadline(
    db,
    attemptId,
    "rw",
    1,
    questionId,
    "D",
    RW_DEADLINE,
  );
  assert.deepEqual(onTheDot, { saved: true, isLate: false });
});

test("an answer past the grace window is refused and leaves the saved answer alone", () => {
  const { db, attemptId, rw } = attemptWithRunningRwModule1();
  const questionId = rw[0].question.id;

  saveAnswerWithDeadline(db, attemptId, "rw", 1, questionId, "B", MODULE_START + 60_000);

  const refused = saveAnswerWithDeadline(
    db,
    attemptId,
    "rw",
    1,
    questionId,
    "D",
    RW_DEADLINE + LATE_ANSWER_GRACE_MS + 1,
  );

  assert.deepEqual(refused, { saved: false, isLate: true });
  const row = readRow(db, attemptId, questionId);
  assert.equal(
    row.user_answer,
    "B",
    "a stale save arriving after the window must not overwrite work that landed in time",
  );
  assert.equal(row.is_correct, 0, "the refused answer must not be re-graded either");

  // Refusal is a return value, not a throw: an expired module is an ordinary outcome of a
  // real student's last click and the endpoint answers it with a 200.
  assert.doesNotThrow(() =>
    saveAnswerWithDeadline(db, attemptId, "rw", 1, questionId, "D", RW_DEADLINE + 60_000),
  );
});

test("the deadline and its grace window do not move with the process timezone", () => {
  // Guard the guard: if TZ never took effect this test would silently degrade into the
  // UTC-only run it exists to be different from.
  assert.notEqual(
    new Date(MODULE_START).getTimezoneOffset(),
    0,
    "this suite must run outside UTC or it cannot detect the local-time parsing bug",
  );

  // The hazard, demonstrated live in this process: the naive parse is off by a whole UTC
  // offset. Everything below would be wrong by this much if the deadline used `new Date`.
  const naive = new Date("2026-09-05 09:00:00").getTime();
  assert.notEqual(naive, MODULE_START);
  assert.equal(parseSqliteTimestamp("2026-09-05 09:00:00"), MODULE_START);
  assert.ok(
    Math.abs(naive - MODULE_START) > 32 * 60 * 1000,
    "the skew is larger than a whole module -- this is why it cannot be tolerated",
  );

  const { db, attemptId, rw } = attemptWithRunningRwModule1();
  const questionId = rw[0].question.id;

  // Boundary assertions against hand-computed epoch instants, so nothing here can be
  // rescued by the same timezone mistake it is checking for.
  assert.deepEqual(
    saveAnswerWithDeadline(db, attemptId, "rw", 1, questionId, "A", RW_DEADLINE - 1),
    { saved: true, isLate: false },
  );
  assert.deepEqual(
    saveAnswerWithDeadline(
      db,
      attemptId,
      "rw",
      1,
      questionId,
      "B",
      RW_DEADLINE + LATE_ANSWER_GRACE_MS,
    ),
    { saved: true, isLate: true },
  );
  assert.deepEqual(
    saveAnswerWithDeadline(
      db,
      attemptId,
      "rw",
      1,
      questionId,
      "C",
      RW_DEADLINE + LATE_ANSWER_GRACE_MS + 1,
    ),
    { saved: false, isLate: true },
  );
  assert.equal(
    readRow(db, attemptId, questionId).user_answer,
    "B",
    "the refused save must not have landed",
  );
});

test("each module is timed against its own clock column", () => {
  // The failure this catches is reading `rw_module1_started_at` for a Module 2 answer:
  // Module 1's clock expired long ago, so Module 2 would be dead on arrival.
  const db = makeTestDb();
  const { attemptId, rw } = startNewAttempt(db);
  startModuleClock(db, attemptId, "rw", 1, MODULE_START);
  submitModule1Answers(
    db,
    attemptId,
    "rw",
    rw.map(({ question }) => ({ questionId: question.id, userAnswer: question.correct_answer })),
  );

  const module2 = assembleModule2ForSection(db, attemptId, "rw");
  const module2Start = RW_DEADLINE + 30_000;
  startModuleClock(db, attemptId, "rw", 2, module2Start);
  const questionId = module2.questions[0].question.id;

  const result = saveAnswerWithDeadline(
    db,
    attemptId,
    "rw",
    2,
    questionId,
    "A",
    module2Start + 60_000,
  );

  assert.deepEqual(
    result,
    { saved: true, isLate: false },
    "a Module 2 answer must be timed against Module 2's clock, not Module 1's",
  );
  assert.equal(readRow(db, attemptId, questionId, 2).user_answer, "A");
});

test("an answer for a module whose clock was never started throws rather than being untimed", () => {
  // Reachable, not hypothetical: startNewAttempt assembles Module 1 for *both* sections,
  // so Math's rows exist from the beginning while `math_module1_started_at` stays null
  // until end-break stamps it. Treating that as "no deadline" would hand out an untimed
  // module; it means the client is posting into a module the student is not in yet.
  const db = makeTestDb();
  const { attemptId, math } = startNewAttempt(db);

  assert.throws(
    () =>
      saveAnswerWithDeadline(
        db,
        attemptId,
        "math",
        1,
        math[0].question.id,
        "A",
        MODULE_START,
      ),
    /has not been started/,
  );
  assert.equal(readRow(db, attemptId, math[0].question.id).user_answer, null);
});

// ---------------------------------------------------------------------------
// D12 -- flagging is not deadline-checked
// ---------------------------------------------------------------------------

test("setFlag works after the deadline has passed and round-trips through readModuleQuestions", () => {
  const { db, attemptId, rw } = attemptWithRunningRwModule1();
  const questionId = rw[3].question.id;

  // Well past the deadline *and* past the grace window -- an answer here would be refused.
  assert.deepEqual(
    saveAnswerWithDeadline(db, attemptId, "rw", 1, questionId, "A", RW_DEADLINE + 60_000),
    { saved: false, isLate: true },
    "precondition: this module is genuinely expired",
  );

  // D12: a flag is a navigation aid, not a graded artifact, so there is nothing to
  // enforce -- setFlag takes no clock at all and cannot be refused for lateness.
  setFlag(db, attemptId, "rw", 1, questionId, true);

  const flagged = readModuleQuestions(db, attemptId, "rw", 1).find(
    (q) => q.question.id === questionId,
  )!;
  assert.equal(flagged.state.flagged, true);
  assert.equal(readRow(db, attemptId, questionId).flagged, 1);

  // Un-flagging is the same act in reverse, and repeating it is a no-op, not an error.
  setFlag(db, attemptId, "rw", 1, questionId, false);
  setFlag(db, attemptId, "rw", 1, questionId, false);
  const unflagged = readModuleQuestions(db, attemptId, "rw", 1).find(
    (q) => q.question.id === questionId,
  )!;
  assert.equal(unflagged.state.flagged, false);

  // Only the named question moved.
  const others = readModuleQuestions(db, attemptId, "rw", 1).filter(
    (q) => q.question.id !== questionId,
  );
  assert.ok(others.every((q) => q.state.flagged === false));

  // Flagging must never disturb the answer on the row.
  assert.equal(readRow(db, attemptId, questionId).user_answer, null);
});

// ---------------------------------------------------------------------------
// D5 -- cross-out / highlight plumbing
// ---------------------------------------------------------------------------

test("setChoiceState round-trips raw JSON text without parsing it", () => {
  const { db, attemptId, rw } = attemptWithRunningRwModule1();
  const questionId = rw[1].question.id;

  const crossedOut = '["A","C"]';
  const highlights = '[{"start":0,"end":9,"note":"epic 4 owns this shape"}]';
  setChoiceState(db, attemptId, "rw", 1, questionId, {
    crossedOutChoices: crossedOut,
    highlights,
  });

  const state = readModuleQuestions(db, attemptId, "rw", 1).find(
    (q) => q.question.id === questionId,
  )!.state;
  assert.equal(state.crossedOutChoices, crossedOut);
  assert.equal(state.highlights, highlights);

  // Byte-for-byte, not merely JSON-equivalent: Epic 3 stores what it is given and has no
  // opinion about the shape, so it must not normalise, re-serialise or validate it.
  const raw = readRow(db, attemptId, questionId);
  assert.equal(raw.crossed_out_choices, crossedOut);
  assert.equal(raw.highlights, highlights);

  // Not even syntactically valid JSON is rejected -- validating here would mean inventing
  // Epic 4's shape a whole epic early.
  setChoiceState(db, attemptId, "rw", 1, questionId, { highlights: "not json at all" });
  assert.equal(readRow(db, attemptId, questionId).highlights, "not json at all");
});

test("setChoiceState updates only the fields present, and clears on an explicit null", () => {
  const { db, attemptId, rw } = attemptWithRunningRwModule1();
  const questionId = rw[2].question.id;

  setChoiceState(db, attemptId, "rw", 1, questionId, {
    crossedOutChoices: '["B"]',
    highlights: '["h"]',
  });

  // Omitted means "leave it alone": a client that only touched highlights must not wipe
  // the cross-outs it never mentioned.
  setChoiceState(db, attemptId, "rw", 1, questionId, { highlights: '["h2"]' });
  let raw = readRow(db, attemptId, questionId);
  assert.equal(raw.crossed_out_choices, '["B"]');
  assert.equal(raw.highlights, '["h2"]');

  // Explicit null means "clear it", which is a different request from omitting it.
  setChoiceState(db, attemptId, "rw", 1, questionId, { crossedOutChoices: null });
  raw = readRow(db, attemptId, questionId);
  assert.equal(raw.crossed_out_choices, null);
  assert.equal(raw.highlights, '["h2"]');

  // An empty update is a no-op rather than a malformed UPDATE with no SET clause.
  assert.doesNotThrow(() => setChoiceState(db, attemptId, "rw", 1, questionId, {}));
  assert.equal(readRow(db, attemptId, questionId).highlights, '["h2"]');
});

test("cross-out and highlights are not deadline-checked either (D12)", () => {
  const { db, attemptId, rw } = attemptWithRunningRwModule1();
  const questionId = rw[1].question.id;

  setChoiceState(db, attemptId, "rw", 1, questionId, { crossedOutChoices: '["D"]' });
  assert.equal(readRow(db, attemptId, questionId).crossed_out_choices, '["D"]');
});

// ---------------------------------------------------------------------------
// Membership -- all three paths
// ---------------------------------------------------------------------------

test("every write rejects a question that was not served in that attempt/section/module", () => {
  const { db, attemptId, rw } = attemptWithRunningRwModule1();
  const rwQuestionId = rw[0].question.id;
  const onTime = MODULE_START + 60_000;

  // Wrong section, wrong module, and a question that does not exist at all.
  const wrongTargets: [Section, ModuleNumber, string][] = [
    ["math", 1, rwQuestionId],
    ["rw", 2, rwQuestionId],
    ["rw", 1, "no-such-question"],
  ];

  for (const [section, module, questionId] of wrongTargets) {
    const where = `${section}/${module}/${questionId}`;
    assert.throws(
      () => saveAnswerWithDeadline(db, attemptId, section, module, questionId, "A", onTime),
      /is not part of attempt/,
      `saveAnswerWithDeadline must reject ${where}`,
    );
    assert.throws(
      () => setFlag(db, attemptId, section, module, questionId, true),
      /is not part of attempt/,
      `setFlag must reject ${where}`,
    );
    assert.throws(
      () => setChoiceState(db, attemptId, section, module, questionId, { highlights: "[]" }),
      /is not part of attempt/,
      `setChoiceState must reject ${where}`,
    );
  }

  // Nothing was written by any of the rejected calls.
  const row = readRow(db, attemptId, rwQuestionId);
  assert.equal(row.user_answer, null);
  assert.equal(row.flagged, 0);
  assert.equal(row.highlights, null);
});

test("an unserved question is rejected even when the module has already expired", () => {
  // Ordering matters: if the deadline check ran before the membership check, this would
  // return {saved: false} -- indistinguishable from an honest expiry -- and the caller
  // bug would never surface. The structural error has to win.
  const { db, attemptId } = attemptWithRunningRwModule1();

  assert.throws(
    () =>
      saveAnswerWithDeadline(
        db,
        attemptId,
        "rw",
        1,
        "no-such-question",
        "A",
        RW_DEADLINE + 60_000,
      ),
    /is not part of attempt/,
  );
});

test("writes are scoped to one attempt, not to a question id", () => {
  // The bank is small enough that two attempts are expected to be served the same
  // question (PRD 3.3), so every write must match on attempt_id as well. The second
  // attempt's row is inserted by hand rather than assembled, because with a generous
  // synthetic bank the selector would hand attempt 2 entirely fresh questions and the
  // overlap this test needs would be accidental.
  const { db, attemptId, rw } = attemptWithRunningRwModule1();
  const shared = rw[0].question.id;

  const otherAttemptId = db
    .prepare("INSERT INTO test_attempts DEFAULT VALUES")
    .run().lastInsertRowid as number;
  db.prepare(
    `INSERT INTO test_attempt_questions (attempt_id, question_id, module, section, order_index)
     VALUES (?, ?, 1, 'rw', 0)`,
  ).run(otherAttemptId, shared);
  startModuleClock(db, otherAttemptId, "rw", 1, MODULE_START);

  setFlag(db, attemptId, "rw", 1, shared, true);
  setChoiceState(db, attemptId, "rw", 1, shared, { crossedOutChoices: '["A"]' });
  saveAnswerWithDeadline(db, attemptId, "rw", 1, shared, "A", MODULE_START + 60_000);

  const other = readRow(db, otherAttemptId, shared);
  assert.equal(other.flagged, 0, "the other attempt's row must be untouched");
  assert.equal(other.user_answer, null);
  assert.equal(other.crossed_out_choices, null);

  // And the stamp really is the one this fixture wrote -- parsed as UTC, not local.
  const stamp = db
    .prepare("SELECT rw_module1_started_at AS startedAt FROM test_attempts WHERE id = ?")
    .get(otherAttemptId) as { startedAt: string };
  assert.equal(parseSqliteTimestamp(stamp.startedAt), MODULE_START);
});

// ---------------------------------------------------------------------------
// Story 3.7 -- per-question time tracking
// ---------------------------------------------------------------------------

test("addTimeSpent accumulates seconds on the served row", () => {
  const { db, attemptId, rw } = attemptWithRunningRwModule1();
  const questionId = rw[0].question.id;

  addTimeSpent(db, attemptId, "rw", 1, questionId, 12);
  addTimeSpent(db, attemptId, "rw", 1, questionId, 8);

  assert.equal(readRow(db, attemptId, questionId).time_spent_seconds, 20);
});

test("addTimeSpent is not deadline-checked", () => {
  const { db, attemptId, rw } = attemptWithRunningRwModule1();
  const questionId = rw[0].question.id;

  // Module is long expired; time still persists (unlike answers).
  saveAnswerWithDeadline(db, attemptId, "rw", 1, questionId, "A", RW_DEADLINE + 60_000);
  addTimeSpent(db, attemptId, "rw", 1, questionId, 5);

  assert.equal(readRow(db, attemptId, questionId).time_spent_seconds, 5);
  assert.equal(readRow(db, attemptId, questionId).user_answer, null);
});

test("addTimeSpent rejects non-positive deltas", () => {
  const { db, attemptId, rw } = attemptWithRunningRwModule1();
  const questionId = rw[0].question.id;

  assert.throws(() => addTimeSpent(db, attemptId, "rw", 1, questionId, 0), /positive integer/);
  assert.throws(() => addTimeSpent(db, attemptId, "rw", 1, questionId, -3), /positive integer/);
});

test("addTimeSpent rejects an unserved question", () => {
  const { db, attemptId } = attemptWithRunningRwModule1();

  assert.throws(
    () => addTimeSpent(db, attemptId, "rw", 1, "no-such-question", 10),
    /is not part of attempt/,
  );
});
