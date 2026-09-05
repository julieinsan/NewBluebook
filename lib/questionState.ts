/**
 * Epic 3 (Task 1.3): per-question state writes for a module in progress.
 *
 * Three write paths back the two "the student did something to one question" endpoints
 * in the plan's §5.5 HTTP contract:
 *
 *  - `saveAnswerWithDeadline` -- `POST /api/attempts/:id/answers` -> `{saved, isLate}`
 *  - `setFlag`                -- `POST /api/attempts/:id/questions/:qid/state` (D5/3.4)
 *  - `setChoiceState`         -- the same endpoint's cross-out / highlight fields (D5)
 *
 * Everything here is one UPDATE against one already-served `test_attempt_questions`
 * row. Nothing in this file creates a row, stamps a clock, or advances the attempt:
 * assembly owns the former (`attemptService.ts`), and per D3a every timestamp stamp is
 * write-if-null and owned by a transition (Task 1.1). A save that could stamp
 * `started_at` would restart the countdown of any module a straggling autosave reached.
 *
 * ## Why the answer path is deadline-checked and the state path is not
 *
 * D3 makes the server the timer authority: the deadline is a *derived* fact
 * (`{section}_module{n}_started_at` + the blueprint limit), never a stored one, so it
 * survives a refresh and cannot be moved by the client. Enforcement is deliberately
 * soft -- `LATE_ANSWER_GRACE_MS` past the deadline an answer is still written, and the
 * caller is told it was late. That window is not extra time; it exists because the
 * student's last click of a module has to travel a network, possibly as a coalesced
 * autosave flushed on unload, and without it the final answer of every module is
 * routinely lost, which reads to the student as the app eating their work.
 *
 * D12 then says flagging is *not* deadline-checked, and that asymmetry is the point:
 * a flag is a navigation aid, not a graded artifact. A student tidying flags a second
 * after the buzzer has gained nothing, so there is nothing to enforce against, and a
 * grace window on the flag endpoint would only produce mysterious failures on the
 * review screen. Cross-out and highlights ride the same argument.
 *
 * ## Deadline arithmetic lives in `testFlow.ts`, not here
 *
 * `moduleDeadline` / `checkAgainstDeadline` / `LATE_ANSWER_GRACE_MS` are imported from
 * the Wave 0 contract rather than reimplemented, for two reasons. The state machine
 * (Task 1.2) builds its `TimerInfo` from the same functions, so the deadline this file
 * enforces and the countdown the student watches cannot drift apart. And the parsing of
 * `started_at` is the single sharpest hazard in this epic (plan §6 rule 7): SQLite writes
 * `"2026-09-05 14:23:11"` -- UTC, but with no `T` and no `Z` -- and V8 reads that as
 * *local* time, so `new Date(startedAt)` shifts every deadline by the machine's UTC
 * offset. Measured here that is 240 minutes against a 32-minute module: every answer
 * either lands hours early or is rejected the instant the module loads, and a UTC CI run
 * never sees it. `parseSqliteTimestamp` (inside `moduleDeadline`) is the only parser
 * allowed, and it throws on a malformed stamp rather than returning `NaN` -- `now <= NaN`
 * is `false`, so a bad stamp would otherwise present silently as "your time is up".
 *
 * ## `now` is a parameter
 *
 * Every function that cares about time takes `now` as its last argument, defaulting to
 * `Date.now()` at the call site. The clock is therefore injectable from the route
 * handler and from tests, and no clock read happens deep inside the logic where a test
 * would have to fake global time to reach it. This is the same purity argument that put
 * the deadline functions in Wave 0.
 *
 * better-sqlite3 is synchronous; every function here is synchronous and must stay that
 * way, and every `db.transaction` callback below is sync (plan §6 rule 3). Nested
 * transactions become SAVEPOINTs, so wrapping a call to `attemptService.saveAnswer`
 * simply joins the outer transaction.
 */
import type Database from "better-sqlite3";
import type { ModuleNumber, Section } from "./blueprint";
import { saveAnswer } from "./attemptService";
import { getAttemptState } from "./attemptState";
import {
  checkAgainstDeadline,
  effectiveModuleDeadline,
  effectiveNow,
  modulePausePhase,
  moduleStartedAtColumn,
  pauseSecondsForPhase,
  type EpochMillis,
} from "./testFlow";

/**
 * What the answer endpoint reports back, exactly as the §5.5 contract spells it.
 *
 * The two fields are genuinely independent and neither implies the other: an answer can
 * be late and saved (inside the grace window), late and not saved (past it), or on time
 * and saved. Collapsing them into one boolean would make a saved-but-late answer
 * indistinguishable from an on-time one, and the client needs the difference to decide
 * whether to keep retrying a queued autosave or to stop and let the module end.
 *
 * Correctness is deliberately absent: the answer endpoint "never returns correctness"
 * per §5.5, because that response goes straight to the browser mid-test. `saveAnswer`
 * still grades and stores `is_correct` on the row; it just does not travel back up.
 */
export interface SaveAnswerResult {
  /** Whether the answer was actually written. False only when past the grace window. */
  saved: boolean;
  /** Whether it arrived after the deadline, regardless of whether it was saved. */
  isLate: boolean;
}

/**
 * The cross-out / highlight payload (D5 plumbing).
 *
 * Both fields are **raw JSON text**, stored exactly as handed over and never parsed.
 * That is Wave 0's decision carried forward -- `QuestionSavedState` reads them back
 * unparsed for the same reason -- and it is not laziness: Epic 4 owns the shape of these
 * columns, and inventing it here would mean a whole epic of guessing, plus a validation
 * path that could start rejecting rows a future writer wrote slightly differently. Epic 3
 * only has to prove the persistence path works end to end.
 *
 * Both are *optional*, and absent is not the same as `null`. A field omitted from the
 * update leaves its column untouched; a field explicitly set to `null` clears it. The
 * endpoint body has the same shape (`{flagged?, crossedOut?, highlights?}`), so a client
 * clearing every cross-out on a question must send `null`, not omit the field -- and a
 * client that only touched highlights must not silently wipe the cross-outs it never
 * mentioned.
 */
export interface ChoiceStateUpdate {
  /** Raw JSON text for `crossed_out_choices`; omit to leave unchanged, null to clear. */
  crossedOutChoices?: string | null;
  /** Raw JSON text for `highlights`; omit to leave unchanged, null to clear. */
  highlights?: string | null;
}

/**
 * Throws unless (attempt, section, module, question) names a row that actually exists.
 *
 * Every public function here calls this *first*, before any deadline arithmetic, and the
 * ordering is deliberate. A late answer for a question that was never served is two bugs,
 * and if the deadline check ran first it would swallow the interesting one: the call
 * would return `{saved: false}` -- indistinguishable from an honest expiry -- and the
 * caller bug would never surface. Membership is a fact about the attempt, timing is a
 * fact about the request; the structural error always wins.
 *
 * The message matches `attemptService.saveAnswer`'s deliberately, so the two paths are
 * indistinguishable to a caller matching on it and there is one thing to map to a 4xx.
 */
function assertQuestionInModule(
  db: Database.Database,
  attemptId: number,
  section: Section,
  module: ModuleNumber,
  questionId: string,
): void {
  const row = db
    .prepare(
      `SELECT 1 AS present FROM test_attempt_questions
       WHERE attempt_id = ? AND section = ? AND module = ? AND question_id = ?`,
    )
    .get(attemptId, section, module, questionId) as { present: number } | undefined;

  if (!row) {
    throw new Error(
      `Question ${questionId} is not part of attempt ${attemptId}'s Module ${module} for section "${section}"`,
    );
  }
}

/**
 * Reads the server-stamped start of a module's clock, or throws.
 *
 * Two failure modes, both thrown rather than defaulted, because every available default
 * is wrong in the permissive direction:
 *
 *  - **No such attempt.** Nothing to time.
 *  - **The stamp is null.** The module's clock was never started, so there is no
 *    deadline to enforce. Treating that as "unlimited time" would hand out an untimed
 *    module, and it is a reachable state rather than a theoretical one: `startNewAttempt`
 *    assembles Module 1 for *both* sections up front, so Math's Module 1 rows exist from
 *    the very beginning while `math_module1_started_at` stays null until `end-break`
 *    stamps it (D3a). An answer arriving for a module whose clock has not started means
 *    the client is posting into a module the student has not been let into yet -- a
 *    routing bug worth surfacing loudly, not silently rewarding.
 *
 * The column name is interpolated because SQLite cannot parameterise an identifier. It is
 * safe here for the reason `testFlow.ts` documents: `moduleStartedAtColumn` takes a typed
 * `Section`/`ModuleNumber` and returns a literal from a closed map, so no request string
 * ever reaches this SQL.
 */
function readModuleStartedAt(
  db: Database.Database,
  attemptId: number,
  section: Section,
  module: ModuleNumber,
): string {
  const column = moduleStartedAtColumn(section, module);
  const row = db
    .prepare(`SELECT ${column} AS startedAt FROM test_attempts WHERE id = ?`)
    .get(attemptId) as { startedAt: string | null } | undefined;

  if (!row) {
    throw new Error(`Attempt ${attemptId} does not exist`);
  }
  if (row.startedAt == null) {
    throw new Error(
      `Module ${module} of section "${section}" has not been started for attempt ${attemptId} ` +
        `-- ${column} is null, so there is no deadline to enforce; a transition must stamp ` +
        `the clock (D3a) before answers can be saved against it`,
    );
  }

  return row.startedAt;
}

/**
 * Saves one answer under D3's soft deadline enforcement.
 *
 * Wraps `attemptService.saveAnswer` -- which owns the grading and the upsert -- with the
 * one thing that call cannot know: whether the module's time is up. The sequence is
 * membership check, deadline check, then delegate, all inside a single transaction so a
 * concurrent transition cannot stamp a submission between the check and the write.
 *
 * Deliberately *not* here: any check that the module is still un-submitted. An answer
 * that beats the end-module request by milliseconds is exactly the straggler D3's grace
 * window exists to keep (the plan's own autosave-races-end-module risk), and the deadline
 * is the authority on whether it is still welcome -- not the submission stamp, which the
 * timer's auto-submit may have written a fraction of a second earlier.
 *
 * Rejection past the grace window is a *return value*, not a throw: an expired module is
 * an ordinary, expected outcome of a real student's last click, and the endpoint answers
 * it with a 200 and `{saved: false}`. Throws are reserved for the caller being wrong --
 * an unknown question, an unstarted clock, an attempt that does not exist.
 *
 * @param now Injectable clock (epoch ms, UTC). Defaults to the wall clock at call time.
 */
export function saveAnswerWithDeadline(
  db: Database.Database,
  attemptId: number,
  section: Section,
  module: ModuleNumber,
  questionId: string,
  userAnswer: string | null,
  now: EpochMillis = Date.now(),
): SaveAnswerResult {
  const run = db.transaction((): SaveAnswerResult => {
    assertQuestionInModule(db, attemptId, section, module, questionId);

    const state = getAttemptState(db, attemptId);
    if (state.pausedAt != null) {
      return { saved: false, isLate: false };
    }

    const startedAt = readModuleStartedAt(db, attemptId, section, module);
    const phase = modulePausePhase(section, module);
    const pauseSeconds = pauseSecondsForPhase(state, phase);
    const deadline = effectiveModuleDeadline(section, module, startedAt, pauseSeconds);
    const clockNow = effectiveNow(now, state.pausedAt, state.pausedPhase, phase);
    const { accepted, isLate } = checkAgainstDeadline(deadline, clockNow);

    if (!accepted) {
      // Past the grace window: leave whatever the student had saved before the buzzer
      // exactly as it is. Overwriting it here would let a stale queued autosave replace
      // a later, better answer that did land in time.
      return { saved: false, isLate };
    }

    saveAnswer(db, attemptId, section, module, questionId, userAnswer);
    return { saved: true, isLate };
  });

  return run();
}

/**
 * Sets or clears the flag on one served question (Story 3.4).
 *
 * **No deadline check, by D12.** This is the whole of the asymmetry with
 * `saveAnswerWithDeadline`, and it is intentional: a flag is a navigation aid that drives
 * the review grid's "flagged" bubbles, not a graded artifact, so there is nothing for a
 * deadline to protect. Adding a grace window here would buy no fairness and would make
 * un-flagging fail confusingly on the review screen, which the student reaches *after*
 * the module's clock is already the least of anyone's concerns.
 *
 * Idempotent: flagging an already-flagged question is a plain UPDATE to the same value.
 * The `flagged` column is `NOT NULL DEFAULT 0 CHECK (flagged IN (0, 1))` (migration
 * 0003), so the boolean is written as 1/0 and read back through `readModuleQuestions`.
 */
export function setFlag(
  db: Database.Database,
  attemptId: number,
  section: Section,
  module: ModuleNumber,
  questionId: string,
  flagged: boolean,
): void {
  const run = db.transaction(() => {
    assertQuestionInModule(db, attemptId, section, module, questionId);
    db.prepare(
      `UPDATE test_attempt_questions SET flagged = ?
       WHERE attempt_id = ? AND section = ? AND module = ? AND question_id = ?`,
    ).run(flagged ? 1 : 0, attemptId, section, module, questionId);
  });

  run();
}

/**
 * Persists cross-out and/or highlight state for one served question (D5 plumbing).
 *
 * Stores the given strings verbatim. This function has no opinion whatsoever about their
 * contents -- see `ChoiceStateUpdate` for why Epic 4, not Epic 3, gets to decide what
 * that JSON looks like. Not parsing it is what makes this endpoint forward-compatible
 * with a shape nobody has designed yet.
 *
 * Like `setFlag` and per D12, no deadline check.
 *
 * Only the fields actually present on `update` appear in the SET clause, so a client
 * touching highlights cannot clobber cross-outs it never mentioned. An update with
 * neither field is a no-op *after* the membership check, so a malformed request still
 * fails loudly rather than quietly doing nothing.
 */
export function setChoiceState(
  db: Database.Database,
  attemptId: number,
  section: Section,
  module: ModuleNumber,
  questionId: string,
  update: ChoiceStateUpdate,
): void {
  const assignments: string[] = [];
  const values: (string | null)[] = [];

  // `in`, not a truthiness or `!= null` test: absent means "leave it alone" and an
  // explicit null means "clear it", and those are different requests.
  if ("crossedOutChoices" in update) {
    assignments.push("crossed_out_choices = ?");
    values.push(update.crossedOutChoices ?? null);
  }
  if ("highlights" in update) {
    assignments.push("highlights = ?");
    values.push(update.highlights ?? null);
  }

  const run = db.transaction(() => {
    assertQuestionInModule(db, attemptId, section, module, questionId);
    if (assignments.length === 0) return;

    db.prepare(
      `UPDATE test_attempt_questions SET ${assignments.join(", ")}
       WHERE attempt_id = ? AND section = ? AND module = ? AND question_id = ?`,
    ).run(...values, attemptId, section, module, questionId);
  });

  run();
}
