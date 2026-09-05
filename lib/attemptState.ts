/**
 * Epic 3 (Task 1.2): the attempt state machine and the runner's read models.
 *
 * Three questions get answered here, and nowhere else:
 *
 *  1. *What does `test_attempts` say about this attempt?* -- `getAttemptState`, which
 *     turns one row into Wave 0's `AttemptState`.
 *  2. *Where is the student?* -- `resolveCurrentPosition`, D4's single canonical
 *     position, which every test route redirects against.
 *  3. *What does the runner need to render?* -- `getRunnerModule`, D1's whole-module
 *     payload, and `listAttempts` for the home screen's resume/history list.
 *
 * ## This file never writes
 *
 * Not one INSERT, one UPDATE or one `datetime('now')` appears below, and none may be
 * added. Every stamp in this epic is owned by a transition in `lib/moduleTransition.ts`
 * and reached only through a Route Handler (D3a), for a reason that is easy to
 * rediscover the hard way: the natural caller of these functions is a Server Component,
 * a Server Component re-renders on every refresh, and a stamp written during render
 * would reset the module's countdown every time the student reloaded the page. Reads are
 * safe to repeat; that is the entire property this separation buys. If something here
 * ever seems to need a write, the missing write belongs to a transition, not to a read
 * model.
 *
 * ## Position is derived, never stored
 *
 * There is no `current_module` column and there must not be one. Position is a pure
 * function of the stamps already on the row, so it cannot drift out of sync with them,
 * cannot be left stale by a crash between two writes, and needs no migration when the
 * flow changes. `resolveCurrentPosition` is that function, and it is pure over
 * `AttemptState` -- no `Database`, no clock -- so route guards, tests and the home
 * screen all get the same answer from the same input.
 *
 * ## Timestamps
 *
 * Every timestamp read here is a SQLite `datetime('now')` string and is parsed only by
 * `parseSqliteTimestamp` (via `moduleDeadline`). `new Date(stamp)` is banned repo-wide
 * (plan §6 rule 7): V8 reads a space-separated date-time as *local* time, which shifts
 * every deadline by the machine's UTC offset -- 240 minutes against a 32-minute module
 * here, and invisible in CI, which runs UTC.
 */
import type Database from "better-sqlite3";
import type { DifficultyPath } from "./adaptiveRouting";
import { BREAK_DURATION_SECONDS, type ModuleNumber, type Section } from "./blueprint";
import { readModuleQuestions } from "./attemptService";
import {
  effectiveModuleDeadline,
  effectiveNow,
  modulePausePhase,
  moduleTimeLimitSeconds,
  pathForPosition,
  pauseSecondsForPhase,
  isAttemptPaused,
  effectiveBreakDeadline,
  type AttemptState,
  type AttemptStatus,
  type EpochMillis,
  type ModulePosition,
  type RunnerChoice,
  type RunnerModule,
  type RunnerQuestion,
  type SectionState,
  type TimerInfo,
} from "./testFlow";

// ---------------------------------------------------------------------------
// getAttemptState
// ---------------------------------------------------------------------------

/** Exactly the `test_attempts` columns the flow depends on, as SQLite returns them. */
interface AttemptFlowRow {
  id: number;
  status: AttemptStatus;
  started_at: string;
  submitted_at: string | null;
  break_started_at: string | null;
  rw_module1_started_at: string | null;
  rw_module1_submitted_at: string | null;
  rw_module2_started_at: string | null;
  rw_module2_submitted_at: string | null;
  rw_module2_difficulty_path: DifficultyPath | null;
  math_module1_started_at: string | null;
  math_module1_submitted_at: string | null;
  math_module2_started_at: string | null;
  math_module2_submitted_at: string | null;
  math_module2_difficulty_path: DifficultyPath | null;
  paused_at: string | null;
  paused_phase: string | null;
  rw_module1_pause_seconds: number;
  rw_module2_pause_seconds: number;
  break_pause_seconds: number;
  math_module1_pause_seconds: number;
  math_module2_pause_seconds: number;
}

/**
 * The flow columns, named explicitly rather than selected with `*`.
 *
 * `SELECT *` would be shorter and would also silently widen this read model every time
 * a later epic adds a column (Epic 5's scaled scores are already on this table), which
 * is how an answer key eventually ends up in a payload nobody meant to widen. The list
 * below is the whole contract between migrations 0002/0008/0009 and `AttemptState`.
 */
const ATTEMPT_FLOW_COLUMNS = `
  id, status, started_at, submitted_at, break_started_at,
  rw_module1_started_at, rw_module1_submitted_at,
  rw_module2_started_at, rw_module2_submitted_at, rw_module2_difficulty_path,
  math_module1_started_at, math_module1_submitted_at,
  math_module2_started_at, math_module2_submitted_at, math_module2_difficulty_path,
  paused_at, paused_phase,
  rw_module1_pause_seconds, rw_module2_pause_seconds, break_pause_seconds,
  math_module1_pause_seconds, math_module2_pause_seconds`;

function sectionStateFrom(row: AttemptFlowRow, section: Section): SectionState {
  // Written out per section rather than built from `moduleStartedAtColumn(...)` lookups:
  // the column names are interpolated into SQL above as a fixed list, and reading them
  // back off a typed row keeps the mapping checkable by the compiler. A dynamic index
  // would compile fine against a typo and fail at runtime as "the timer never starts".
  if (section === "rw") {
    return {
      section: "rw",
      module1StartedAt: row.rw_module1_started_at,
      module1SubmittedAt: row.rw_module1_submitted_at,
      module2StartedAt: row.rw_module2_started_at,
      module2SubmittedAt: row.rw_module2_submitted_at,
      module2DifficultyPath: row.rw_module2_difficulty_path,
    };
  }
  return {
    section: "math",
    module1StartedAt: row.math_module1_started_at,
    module1SubmittedAt: row.math_module1_submitted_at,
    module2StartedAt: row.math_module2_started_at,
    module2SubmittedAt: row.math_module2_submitted_at,
    module2DifficultyPath: row.math_module2_difficulty_path,
  };
}

function attemptStateFromRow(row: AttemptFlowRow): AttemptState {
  return {
    attemptId: row.id,
    status: row.status,
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
    breakStartedAt: row.break_started_at,
    pausedAt: row.paused_at,
    pausedPhase: row.paused_phase as AttemptState["pausedPhase"],
    rwModule1PauseSeconds: row.rw_module1_pause_seconds,
    rwModule2PauseSeconds: row.rw_module2_pause_seconds,
    breakPauseSeconds: row.break_pause_seconds,
    mathModule1PauseSeconds: row.math_module1_pause_seconds,
    mathModule2PauseSeconds: row.math_module2_pause_seconds,
    rw: sectionStateFrom(row, "rw"),
    math: sectionStateFrom(row, "math"),
  };
}

/**
 * Reads one attempt's flow state: both sections' module stamps, the break stamp, the
 * routed difficulty paths and `status`.
 *
 * Throws when the attempt does not exist. The alternative -- returning null and letting
 * every caller decide -- would put a "what if it's missing" branch in the D4 guard of
 * every test route, and the honest answer at that point is a 404, which the caller can
 * derive from the throw just as well.
 *
 * Note what is *not* read: no `test_attempt_questions` are counted. Section progress is
 * fully derivable from this one row (that is what migration 0009 bought), and counting
 * answered rows would be actively wrong -- answers are saved continuously while a module
 * is still in progress, so their presence never means "finished".
 */
export function getAttemptState(db: Database.Database, attemptId: number): AttemptState {
  const row = db
    .prepare(`SELECT ${ATTEMPT_FLOW_COLUMNS} FROM test_attempts WHERE id = ?`)
    .get(attemptId) as AttemptFlowRow | undefined;

  if (!row) {
    throw new Error(`Attempt ${attemptId} does not exist`);
  }

  return attemptStateFromRow(row);
}

// ---------------------------------------------------------------------------
// resolveCurrentPosition (D4, D10)
// ---------------------------------------------------------------------------

/**
 * D4's canonical position for an attempt: which module the student is in, or the break,
 * or done.
 *
 * Pure over `AttemptState`, so the Server Component guard, the route handlers' `next`
 * field and the home screen's resume link all agree by construction.
 *
 * ## Module granularity, deliberately (D4)
 *
 * The result never says which *question* the student is on, and never says whether they
 * are on a module's review screen. Both are **sub-position**: they live in client state
 * and in the URL, and `test_attempts` cannot see them. A guard that tried to resolve
 * sub-position from here would compare `/test/42/review` against `{module, rw, 1}`,
 * conclude they disagree and bounce the student off the review screen back into the
 * runner on every render. Guards compare the module part only and pass sub-position
 * through untouched.
 *
 * ## Why the first check is a stamp and not `status` (D10)
 *
 * Finishing the test is two writes: `end-module` stamps `math_module2_submitted_at`,
 * then `submit` sets `status='submitted'`. Between them -- a crashed request, a closed
 * laptop, a retry -- the row says `in_progress` while the last module is definitively
 * over. Keying position off `status` would send that student back into Math Module 2, a
 * module whose submitted-at stamp is already set, with a clock that expired and a Submit
 * button that changes nothing: stranded inside a finalized module. Keying off the stamp
 * lands them on the confirmation page, where an idempotent `submit` can finish the job.
 *
 * `status` stays the field Epics 5 and 7 query for "is this attempt scoreable /
 * historical". It is not the field the runner routes on.
 *
 * ## Why the break is defined by Math's clock and not by `break_started_at`
 *
 * `break_started_at` says the break *began*; nothing ever clears it, so it cannot say
 * the break is over. `end-break` stamps `math_module1_started_at` (D3a), and that stamp
 * is the only durable evidence the student left the break -- including for a student who
 * skipped it early via "Resume testing", whose break stamp still sits there unexpired.
 * So: R&W finished and Math's clock not yet started means the break, whatever
 * `break_started_at` happens to hold.
 */
export function resolveCurrentPosition(state: AttemptState): ModulePosition {
  // D10: the attempt is over the moment the last module is stamped, regardless of
  // `status`. Checked first so no later branch can route into a finalized module even if
  // an earlier stamp is somehow missing.
  if (state.math.module2SubmittedAt != null) {
    return { kind: "submitted" };
  }

  if (state.rw.module1SubmittedAt == null) {
    return { kind: "module", section: "rw", module: 1 };
  }

  if (state.rw.module2SubmittedAt == null) {
    // Module 2's clock is stamped by endModule1; without it the transition did not finish.
    if (state.rw.module2StartedAt == null) {
      return { kind: "module", section: "rw", module: 1 };
    }
    return { kind: "module", section: "rw", module: 2 };
  }

  // R&W is done. The break runs until `end-break` starts Math's clock (see above).
  // Key off math_module1_started_at only — not math_module1_submitted_at, which must
  // never be set before Math begins but can be stale in a partially-written row.
  if (state.math.module1StartedAt == null) {
    return { kind: "break" };
  }

  if (state.math.module1SubmittedAt == null) {
    return { kind: "module", section: "math", module: 1 };
  }

  // Same rule as R&W Module 2: do not route into Module 2 until its clock has started.
  if (state.math.module2StartedAt == null) {
    return { kind: "module", section: "math", module: 1 };
  }
  return { kind: "module", section: "math", module: 2 };
}

/** Convenience for the common "read the row, then resolve" pair. */
export function resolvePositionForAttempt(
  db: Database.Database,
  attemptId: number,
): ModulePosition {
  return resolveCurrentPosition(getAttemptState(db, attemptId));
}

// ---------------------------------------------------------------------------
// getRunnerModule (D1)
// ---------------------------------------------------------------------------

const CHOICE_LETTERS = ["A", "B", "C", "D"] as const;

/**
 * Builds the client's view of one question from the read model's row.
 *
 * Every field is copied across by name. That is not ceremony: `readModuleQuestions`
 * returns a full `questions` row, which carries `correct_answer`, `rationale` and
 * `difficulty`, and this payload is handed to the student's browser while the module is
 * still running. A spread (`...question`) would ship the answer key the first time
 * anyone added a column, silently and with no test able to notice. An explicit
 * projection fails closed: a new column is simply absent until someone adds it here on
 * purpose.
 *
 * (`is_correct` never even reaches this point -- `readModuleQuestions` does not select
 * it, by the same argument. Both defences are deliberate.)
 */
function toRunnerQuestion(
  question: ReturnType<typeof readModuleQuestions>[number],
  index: number,
): RunnerQuestion {
  const q = question.question;

  // Grid-ins have no choices at all, so this comes out empty for them; a multiple-choice
  // row that is missing a choice column yields a shorter list rather than a `null` the
  // renderer would have to defend against.
  const choiceTexts: Record<(typeof CHOICE_LETTERS)[number], string | null> = {
    A: q.choice_a,
    B: q.choice_b,
    C: q.choice_c,
    D: q.choice_d,
  };
  const choices: RunnerChoice[] = CHOICE_LETTERS.filter(
    (letter) => choiceTexts[letter] != null,
  ).map((letter) => ({ letter, text: choiceTexts[letter] as string }));

  return {
    id: q.id,
    // 1-based display number. Derived from the array index rather than from
    // `order_index`, which is a per-(attempt, module) counter shared across both
    // sections -- Math Module 1's rows start at 27, so using it directly would show the
    // student "Question 28 of 22". See attemptService's order_index note.
    number: index + 1,
    orderIndex: question.orderIndex,
    questionType: q.question_type,
    stimulusText: q.stimulus_text,
    choices,
    figureAssetPath: q.figure_asset_path,
    userAnswer: question.state.userAnswer,
    flagged: question.state.flagged,
    crossedOutChoices: question.state.crossedOutChoices,
    highlights: question.state.highlights,
  };
}

/**
 * D1's payload: every question of one module, in order, with the student's saved work on
 * each, plus the server-authoritative countdown.
 *
 * The whole module ships at once (27 R&W / 22 Math) so that Next/Back and the review
 * grid's jump-to-question are pure client state with no network in the interaction path.
 * Answers flow back separately through the answer endpoint.
 *
 * `now` is injectable purely so a test can assert a `TimerInfo` without faking the
 * global clock; it defaults to the server's clock and production never passes it. Note
 * that `Date.now()` is a clock reading, not a parsed database timestamp -- the §6 rule 7
 * ban is on `new Date(stamp)`, and the module's `started_at` below goes through
 * `moduleDeadline`, which parses it correctly.
 *
 * Throws rather than degrading in two cases, because both mean the caller routed here
 * for a module the student cannot legitimately be in:
 *
 *  - **No questions.** Module 2 is assembled lazily at the section's `end-module`
 *    transition, so an unassembled Module 2 reads back as zero rows. Returning an empty
 *    module would render a runner with nothing in it and a live countdown.
 *  - **No `started_at`.** The deadline is derived from that stamp and there is no
 *    fallback worth inventing: substituting "now" would restart the clock on every
 *    refresh, which is exactly the bug D3a's handler-owned, write-if-null stamping
 *    exists to prevent. A missing stamp means a transition did not run.
 */
export function getRunnerModule(
  db: Database.Database,
  attemptId: number,
  section: Section,
  module: ModuleNumber,
  now: EpochMillis = Date.now(),
): RunnerModule {
  const state = getAttemptState(db, attemptId);
  const questions = readModuleQuestions(db, attemptId, section, module);

  if (questions.length === 0) {
    throw new Error(
      `Attempt ${attemptId} has no questions for section "${section}" Module ${module} -- ` +
        `Module 2 is assembled at the section's end-module transition, so this module has ` +
        `not been served yet`,
    );
  }

  const startedAt = state[section][module === 1 ? "module1StartedAt" : "module2StartedAt"];
  if (startedAt == null) {
    throw new Error(
      `Attempt ${attemptId}'s section "${section}" Module ${module} has no started_at stamp, ` +
        `so its deadline cannot be derived -- the transition that stamps this module's ` +
        `clock has not run`,
    );
  }

  const phase = modulePausePhase(section, module);
  const pauseSeconds = pauseSecondsForPhase(state, phase);
  const deadline = effectiveModuleDeadline(section, module, startedAt, pauseSeconds);
  const clockNow = effectiveNow(now, state.pausedAt, state.pausedPhase, phase);

  const timer: TimerInfo = {
    deadline,
    serverNow: clockNow,
    durationSeconds: moduleTimeLimitSeconds(section, module),
    paused: state.pausedAt != null && state.pausedPhase === phase,
  };

  return {
    attemptId,
    section,
    module,
    questions: questions.map(toRunnerQuestion),
    timer,
  };
}

// ---------------------------------------------------------------------------
// listAttempts (Story 3.1, D9)
// ---------------------------------------------------------------------------

/**
 * One row of the home screen's list: enough to render "resume" or a history entry, and
 * to deep-link without the caller re-deriving a route.
 */
export interface AttemptSummary {
  attemptId: number;
  /** Practice Test 1 (first-pass) or 2 (second-pass, excludes Test 1 questions). */
  practiceTest: 1 | 2;
  /** `test_attempts.status` -- what Epics 5/7 filter on. Not what routing uses (D10). */
  status: AttemptStatus;
  /** When the attempt row was created, not when R&W Module 1 began. */
  startedAt: string;
  /** Set by the final submit only; null in the D10 window even for a finished attempt. */
  submittedAt: string | null;
  /** D4's canonical position, so the caller can label the row ("R&W Module 2", "Break"). */
  position: ModulePosition;
  /**
   * Where this row links to, already rendered through `pathForPosition` (D11). The home
   * screen navigates to this string and never assembles a route itself -- the same rule
   * the HTTP contract's `next` field follows.
   */
  path: string;
  /**
   * D9's "is this the attempt to resume?", derived from `position`, not from `status`.
   *
   * The two disagree exactly in D10's window (last module stamped, `submit` not yet
   * run), and `position` is the one that is right there: that attempt is over and must
   * not be resumed, even though its row still reads `in_progress`. At most one row can
   * have this true, which is the invariant D9's idempotent `POST /api/attempts` exists
   * to preserve.
   */
  resumable: boolean;
  /** True when the student paused and must explicitly resume from home. */
  isPaused: boolean;
  /** Epic 5 fills this; null for every attempt until scoring exists. */
  totalScaledScore: number | null;
}

/**
 * Every attempt, newest first, for Story 3.1's home screen.
 *
 * Ordered by `id` rather than by `started_at`: `datetime('now')` has whole-second
 * granularity, so two attempts created in the same second would tie and order
 * arbitrarily, while `id` is the autoincrement insertion order and is exactly the
 * "newest" the student means.
 *
 * Unpaginated on purpose -- this is a single-user local app whose attempt count is in
 * the tens, and the home screen shows the whole history. If that ever stops being true,
 * the fix is a LIMIT here plus a separate "find the resumable attempt" query, not a
 * cached column.
 */
export function listAttempts(db: Database.Database): AttemptSummary[] {
  const rows = db
    .prepare(
      `SELECT ${ATTEMPT_FLOW_COLUMNS}, practice_test, total_scaled_score
       FROM test_attempts
       ORDER BY id DESC`,
    )
    .all() as (AttemptFlowRow & { practice_test: 1 | 2; total_scaled_score: number | null })[];

  return rows.map((row) => {
    const state = attemptStateFromRow(row);
    const position = resolveCurrentPosition(state);
    return {
      attemptId: state.attemptId,
      practiceTest: row.practice_test,
      status: state.status,
      startedAt: state.startedAt,
      submittedAt: state.submittedAt,
      position,
      path: pathForPosition(state.attemptId, position),
      resumable: position.kind !== "submitted",
      isPaused: isAttemptPaused(state),
      totalScaledScore: row.total_scaled_score,
    };
  });
}

/**
 * Break countdown payload with pause-adjusted deadline (D8 + migration 0010).
 */
export function getBreakTimer(
  db: Database.Database,
  attemptId: number,
  now: EpochMillis = Date.now(),
): TimerInfo {
  const state = getAttemptState(db, attemptId);
  if (state.breakStartedAt == null) {
    throw new Error(`Attempt ${attemptId} has no break_started_at stamp`);
  }

  const pauseSeconds = pauseSecondsForPhase(state, "break");
  const deadline = effectiveBreakDeadline(state.breakStartedAt, pauseSeconds);
  const clockNow = effectiveNow(now, state.pausedAt, state.pausedPhase, "break");

  return {
    deadline,
    serverNow: clockNow,
    durationSeconds: BREAK_DURATION_SECONDS,
    paused: state.pausedAt != null && state.pausedPhase === "break",
  };
}
