/**
 * Epic 3 (Task 1.1): the four transitions between modules, and the seam that makes them
 * safe to deliver twice.
 *
 * ## What a "transition" is here
 *
 * Everything in this file is a point where the attempt leaves one phase of the test and
 * enters the next: Module 1 ends and Module 2 is assembled; Module 2 ends and (for R&W)
 * the break begins; the break ends and Math's clock starts; the attempt is submitted.
 * Each one is driven by exactly one Route Handler (§5.5), each one writes to
 * `test_attempts`, and each one is the *only* writer of the columns it touches.
 *
 * ## Idempotence is the requirement, not a nicety
 *
 * Every function here is written for the case where it is called twice with the same
 * arguments, because in Epic 3 that is the normal case rather than the edge case:
 *
 *  - the student double-clicks "Submit";
 *  - the browser retries a POST whose response was lost;
 *  - Story 3.3's expiry auto-submit fires at the same moment the student clicks Submit
 *    -- by design, since D3 makes auto-submit POST *the same request* the button does;
 *  - React StrictMode double-invokes an effect in development;
 *  - the student refreshes the "loading Module 2" screen.
 *
 * So a second delivery must return the same answer as the first and must not move a
 * single timestamp. "Same answer" is load-bearing: the handler returns the student's next
 * position, and a transition that failed on retry would leave a student with a valid,
 * fully-assembled Module 2 sitting in the database staring at a 500 with no way in.
 *
 * ## The finalize/assemble seam (plan §4, epic-3-module-transition-seam.md)
 *
 * `finalizeModule1` throws on a repeat call; `assembleModule2ForSection` is idempotent.
 * Both are individually correct -- finalize is loud because a duplicate submit usually
 * means a bug worth seeing, assemble is quiet because it once inserted a *second* full
 * Module 2 (54 R&W rows for one attempt). Together they make the naive pair
 *
 *     finalizeModule1(...); assembleModule2ForSection(...);
 *
 * fail on every second delivery: the retry dies at finalize and never reaches the
 * assemble call that would have handed back the correct existing module.
 *
 * `endModule1` closes that seam *at the transition*, without weakening either primitive:
 * it catches `ModuleAlreadySubmittedError` specifically -- by type, never by matching the
 * message text -- and falls through. Any other error still propagates, so a nonexistent
 * attempt or a starved question bank fails as loudly as before.
 *
 * ## Write-if-null stamping (D3a)
 *
 * Every timestamp written here is written *only if the column is still null*. This is
 * what stops a retried request from restarting a clock that is already running: a second
 * delivery of `end-module` must not hand the student a fresh 32 minutes on a Module 2
 * they started five minutes ago. The same rule is why no stamp may ever be written during
 * render -- a Server Component that stamped `started_at` would re-stamp on every refresh.
 * Stamps are handler-owned; this file is the domain code those handlers call.
 *
 * Note that each transition stamps the *next* phase's clock, which is what makes "no
 * stamping during render" possible at all: by the time a page renders, the clock it counts
 * down is already running. One consequence, per D3a: Module 2's countdown starts at the
 * `end-module` request, not when the runner page loads.
 *
 * ## Ordering guards
 *
 * `endModule2` and `endBreak` refuse to stamp when the phase they claim to be ending
 * never started. This is not defensive noise: `math_module2_submitted_at` is what D10
 * makes "this attempt is over" mean, so an out-of-order POST that stamped it would end a
 * test the student had not taken. The guards make each transition's precondition a fact
 * on the attempt row rather than an assumption about the client.
 *
 * ## Concurrency, or rather the lack of it
 *
 * `better-sqlite3` is synchronous and Route Handlers run on one thread in one process, so
 * two deliveries of the same request cannot interleave *within* a call -- the second one
 * begins only after the first has fully returned. Idempotence here therefore has to
 * survive sequential repetition, not concurrent execution. Each function is still wrapped
 * in a transaction so that its several writes commit together (nested `db.transaction`
 * calls become SAVEPOINTs and simply join the outer transaction), and every stamp carries
 * its `IS NULL` guard into the UPDATE itself rather than relying on the read that
 * preceded it.
 *
 * ## Timestamps
 *
 * Every stamp is written by SQLite's own `datetime('now')`, so the server's clock is the
 * authority and no caller can inject a time. The strings returned here are SQLite's
 * `"YYYY-MM-DD HH:MM:SS"` UTC format, which is *not* ISO-8601: never hand one to
 * `new Date()` (§6 rule 7 -- V8 reads it as local time, measured at 240 minutes of skew
 * against a 32-minute module). Use `parseSqliteTimestamp` from `lib/testFlow.ts`.
 */
import type Database from "better-sqlite3";
import { scoreAttempt } from "./scoring";
import type { Section } from "./blueprint";
import {
  assembleModule2ForSection,
  finalizeModule1,
  ModuleAlreadySubmittedError,
  type Module2Result,
} from "./attemptService";
import {
  BREAK_STARTED_AT_COLUMN,
  moduleStartedAtColumn,
  moduleSubmittedAtColumn,
} from "./testFlow";

// ---------------------------------------------------------------------------
// Stamping primitives (D3a)
// ---------------------------------------------------------------------------

/**
 * The outcome of one write-if-null stamp.
 *
 * `at` is always the stamp that is now on the row -- the one this call wrote, or the one
 * an earlier delivery wrote. Callers can therefore report a timestamp unconditionally and
 * never have to branch on whether they were first.
 */
interface StampResult {
  /** The value now in the column: SQLite `datetime('now')` text, UTC. */
  at: string;
  /** True only if *this* call wrote it. Useful for tests and logging; not for control flow. */
  stampedNow: boolean;
}

/**
 * Reads one `test_attempts` timestamp column, throwing if the attempt does not exist.
 *
 * The distinction matters to every guard below: "this attempt has no such stamp yet" is a
 * recoverable ordering problem, while "there is no such attempt" is a bad request or a bug
 * in the caller, and the two must not be reported the same way.
 *
 * `column` is interpolated rather than parameterised because SQLite cannot bind an
 * identifier. That is safe here *only* because every call site passes a literal from
 * `testFlow.ts`'s closed column map, whose accessors take a typed `Section`/`ModuleNumber`.
 * Nothing may ever build one of these names from request input.
 */
function readStamp(db: Database.Database, attemptId: number, column: string): string | null {
  const row = db
    .prepare(`SELECT ${column} AS at FROM test_attempts WHERE id = ?`)
    .get(attemptId) as { at: string | null } | undefined;

  if (!row) {
    throw new Error(`Attempt ${attemptId} does not exist`);
  }
  return row.at;
}

/**
 * Stamps `column` with the server's clock **only if it is still null** (D3a).
 *
 * The `IS NULL` predicate lives in the UPDATE, not just in the read above it, so the
 * write itself is the guard: even if a future caller reached this without the preceding
 * read, the column could not be overwritten. That is the whole safety property -- a
 * timestamp this file has written is immutable, which is what lets a deadline derived
 * from it survive a refresh, a retry, and a duplicate delivery.
 *
 * Uses `datetime('now')` rather than a JS-supplied time so the stamp is the *server's*
 * clock, consistent with every other stamp in the schema and immune to a caller passing
 * one in.
 */
function stampIfNull(db: Database.Database, attemptId: number, column: string): StampResult {
  const apply = db.transaction((): StampResult => {
    const existing = readStamp(db, attemptId, column);
    if (existing != null) {
      return { at: existing, stampedNow: false };
    }

    db.prepare(
      `UPDATE test_attempts SET ${column} = datetime('now') WHERE id = ? AND ${column} IS NULL`,
    ).run(attemptId);

    const written = readStamp(db, attemptId, column);
    if (written == null) {
      // Unreachable short of the row vanishing mid-transaction; asserted rather than
      // returned as `null` so a broken stamp can never be mistaken for "not started yet",
      // which is precisely the state the ordering guards below key off.
      throw new Error(`Failed to stamp ${column} on attempt ${attemptId}`);
    }
    return { at: written, stampedNow: true };
  });

  return apply();
}

// ---------------------------------------------------------------------------
// End of Module 1 -- the seam
// ---------------------------------------------------------------------------

export interface EndModule1Result {
  attemptId: number;
  section: Section;
  /**
   * The section's Module 2: freshly assembled on the first delivery, read back from the
   * database on every later one. The two are structurally identical by construction (see
   * `AssembledModuleQuestion.state`), so a caller cannot tell -- and must not try to tell
   * -- which it received.
   *
   * Carries the Module 1 score and the routed difficulty path. **Neither may cross the
   * wire**: the routing decision is never surfaced to the student (Story 2.4) and
   * correctness is not returned mid-test. The route handler picks off `questions` only.
   */
  module2: Module2Result;
  /** `{section}_module2_started_at` as it now stands -- this call's stamp or an earlier one. */
  module2StartedAt: string;
  /**
   * False when an earlier delivery of this same transition had already finalized Module 1
   * -- i.e. this call took the seam path. The HTTP response is identical either way (§5.5:
   * the same 200 on every delivery); this is here for tests and logging.
   */
  finalizedNow: boolean;
}

/**
 * Ends a section's Module 1: finalize, assemble Module 2, start Module 2's clock.
 *
 * This is the one call in the codebase that legitimately expects to be delivered twice,
 * and the only place `ModuleAlreadySubmittedError` is swallowed. The catch is deliberately
 * narrow -- one `instanceof` check, no message matching, everything else rethrown -- so a
 * nonexistent attempt or an unfillable question bank still fails loudly.
 *
 * ## Why the whole thing is one transaction
 *
 * Three writes happen here: Module 1's submitted-at stamp, Module 2's rows, and Module 2's
 * clock. Committing them together rules out the two states that would actually hurt a
 * student. A clock without a module means Module 2's time is burning before Module 2
 * exists; a module without a clock means its deadline is underivable and the runner has no
 * countdown to render. Neither is reachable if the three writes share a transaction.
 *
 * The cost is that a failed assembly (a starved bank) rolls back Module 1's stamp too, so
 * a retry re-finalizes and the submitted-at moves by however long the retry took. That is
 * the right trade: a couple of seconds of drift on a stamp nobody counts down against,
 * versus a section wedged between "finalized" and "has a Module 2".
 *
 * Catching inside a transaction is safe: a nested `db.transaction` is a SAVEPOINT, so
 * `finalizeModule1`'s throw rolls back only its own savepoint (which wrote nothing) and
 * leaves the enclosing transaction usable.
 *
 * The Module 2 clock is stamped *after* assembly, so the ordering of the statements
 * matches the ordering of the facts even though the transaction makes them simultaneous.
 */
export function endModule1(
  db: Database.Database,
  attemptId: number,
  section: Section,
): EndModule1Result {
  const run = db.transaction((): EndModule1Result => {
    let finalizedNow = true;
    try {
      finalizeModule1(db, attemptId, section);
    } catch (err) {
      if (!(err instanceof ModuleAlreadySubmittedError)) throw err;
      // An earlier delivery of this same request already finalized this module. Fall
      // through to assembly, which is idempotent and returns the Module 2 on record.
      finalizedNow = false;
    }

    const module2 = assembleModule2ForSection(db, attemptId, section);
    const started = stampIfNull(db, attemptId, moduleStartedAtColumn(section, 2));

    return {
      attemptId,
      section,
      module2,
      module2StartedAt: started.at,
      finalizedNow,
    };
  });

  return run();
}

// ---------------------------------------------------------------------------
// End of Module 2 -- and, for R&W, the start of the break
// ---------------------------------------------------------------------------

export interface EndModule2Result {
  attemptId: number;
  section: Section;
  /** `{section}_module2_submitted_at` as it now stands. */
  submittedAt: string;
  /**
   * `break_started_at` for R&W; `null` for Math, which has no break after it. Not merely
   * "unset" -- Math deliberately never stamps this column.
   */
  breakStartedAt: string | null;
  /** False when an earlier delivery had already ended this module. */
  submittedNow: boolean;
}

/**
 * Ends a section's Module 2.
 *
 * For R&W this also starts D8's 10-minute break clock, in the same transaction: the break
 * screen counts down against `break_started_at`, so if the submitted-at stamp committed
 * without it the student would land on a break with no deadline to count down. Math stamps
 * no break -- there is nothing after it but the submit.
 *
 * Ending Math's Module 2 is what makes the attempt finished as far as the runner is
 * concerned (D10): `resolveCurrentPosition` keys off `math_module2_submitted_at`, not off
 * `status`. Flipping `status` is a separate, separately-idempotent call
 * (`submitAttempt`), so a crash between the two leaves the student on the confirmation
 * page rather than stranded inside a finalized module.
 *
 * Refuses to stamp a module that never started. Without that guard a hand-crafted or
 * misrouted `end-module` for Math Module 2 would mark a brand-new attempt complete, since
 * D10 reads exactly this column as "the test is over".
 */
export function endModule2(
  db: Database.Database,
  attemptId: number,
  section: Section,
): EndModule2Result {
  const run = db.transaction((): EndModule2Result => {
    const startedAt = readStamp(db, attemptId, moduleStartedAtColumn(section, 2));
    if (startedAt == null) {
      throw new Error(
        `Module 2 for section "${section}" of attempt ${attemptId} has not started -- ` +
          `end Module 1 first (endModule1), which assembles Module 2 and starts its clock`,
      );
    }

    const submitted = stampIfNull(db, attemptId, moduleSubmittedAtColumn(section, 2));
    const breakStamp =
      section === "rw" ? stampIfNull(db, attemptId, BREAK_STARTED_AT_COLUMN) : null;

    return {
      attemptId,
      section,
      submittedAt: submitted.at,
      breakStartedAt: breakStamp?.at ?? null,
      submittedNow: submitted.stampedNow,
    };
  });

  return run();
}

// ---------------------------------------------------------------------------
// End of the break
// ---------------------------------------------------------------------------

export interface EndBreakResult {
  attemptId: number;
  /** When the break began -- stamped by `endModule2("rw")`, never here. */
  breakStartedAt: string;
  /** `math_module1_started_at` as it now stands: Math's clock is now running. */
  mathModule1StartedAt: string;
  /** False when an earlier delivery had already ended the break. */
  startedNow: boolean;
}

/**
 * Ends D8's inter-section break and starts Math Module 1's clock.
 *
 * The break is skippable and its expiry is advisory, so this is called both by the
 * "Resume testing" button and by the break screen's own countdown reaching zero -- two
 * paths that can easily fire within milliseconds of each other. Hence write-if-null: the
 * second one must not restart Math's 35 minutes.
 *
 * Nothing here checks whether the break's ten minutes have actually elapsed. Ending it
 * early is a feature (D8), and there is no rule that could be enforced on the other side
 * either -- a student who leaves the break screen open simply resumes late, having spent
 * their own time.
 *
 * Requires the break to have started, which is another way of saying it requires R&W to be
 * over: `break_started_at` is stamped only by `endModule2("rw")`. Without the guard an
 * `end-break` delivered early would start Math's clock while the student was still in R&W,
 * burning a module they had not reached.
 */
export function endBreak(db: Database.Database, attemptId: number): EndBreakResult {
  const run = db.transaction((): EndBreakResult => {
    const breakStartedAt = readStamp(db, attemptId, BREAK_STARTED_AT_COLUMN);
    if (breakStartedAt == null) {
      throw new Error(
        `The break for attempt ${attemptId} has not started -- end R&W Module 2 first ` +
          `(endModule2 with section "rw"), which stamps break_started_at`,
      );
    }

    const mathStart = stampIfNull(db, attemptId, moduleStartedAtColumn("math", 1));

    return {
      attemptId,
      breakStartedAt,
      mathModule1StartedAt: mathStart.at,
      startedNow: mathStart.stampedNow,
    };
  });

  return run();
}

// ---------------------------------------------------------------------------
// Final submit
// ---------------------------------------------------------------------------

export interface SubmitAttemptResult {
  attemptId: number;
  /** `test_attempts.submitted_at` as it now stands. */
  submittedAt: string;
  /** False when an earlier delivery had already submitted this attempt. */
  submittedNow: boolean;
}

/**
 * Marks the attempt submitted: `status = 'submitted'` plus `submitted_at`.
 *
 * ## Why this is separate from ending Math Module 2 (D10)
 *
 * Because it has a different audience. `status` is what Epics 5 and 7 query for "is this
 * attempt scoreable / historical"; it is *not* what the runner routes on. The runner keys
 * off `math_module2_submitted_at`, so the window between the two POSTs -- last module over,
 * row still `in_progress` -- resolves to `{kind:"submitted"}` regardless, and a crash in
 * that window leaves the student on the confirmation page instead of being redirected back
 * into a module they have already finished. Retrying `submit` then closes the gap, which is
 * only possible because this call is idempotent in its own right.
 *
 * `submitted_at` is written with COALESCE so it keeps D3a's write-if-null discipline even
 * on the second delivery, while `status` is set unconditionally -- that way a row that
 * somehow held a `submitted_at` without the matching status is repaired rather than
 * skipped.
 *
 * Deliberately *not* guarded on Math Module 2 being finished. Unlike the ordering guards
 * above, an early submit cannot strand anyone: position is derived from
 * `math_module2_submitted_at` (D10), so a prematurely submitted attempt still routes the
 * student back into their unfinished module, and the eventual real submit is a no-op. A
 * guard here would instead make the crash-recovery path depend on exactly the ordering it
 * exists to repair.
 */
export function submitAttempt(db: Database.Database, attemptId: number): SubmitAttemptResult {
  const run = db.transaction((): SubmitAttemptResult => {
    const row = db
      .prepare("SELECT submitted_at AS submittedAt, status FROM test_attempts WHERE id = ?")
      .get(attemptId) as { submittedAt: string | null; status: string } | undefined;

    if (!row) {
      throw new Error(`Attempt ${attemptId} does not exist`);
    }
    if (row.submittedAt != null && row.status === "submitted") {
      return { attemptId, submittedAt: row.submittedAt, submittedNow: false };
    }

    db.prepare(
      `UPDATE test_attempts
       SET status = 'submitted', submitted_at = COALESCE(submitted_at, datetime('now'))
       WHERE id = ?`,
    ).run(attemptId);

    scoreAttempt(db, attemptId);

    const submittedAt = db
      .prepare("SELECT submitted_at AS submittedAt FROM test_attempts WHERE id = ?")
      .get(attemptId) as { submittedAt: string };

    return { attemptId, submittedAt: submittedAt.submittedAt, submittedNow: true };
  });

  return run();
}

/**
 * Re-exported so callers that need to distinguish "already finalized" from a real failure
 * -- Task 2.1's `end-module` handler, chiefly -- can import the seam and its error from
 * one place. It stays *defined* in `attemptService.ts`, where it is thrown.
 */
export { ModuleAlreadySubmittedError };
