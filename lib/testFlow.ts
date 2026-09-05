/**
 * Epic 3 (Wave 0): the shared contract every later wave codes against.
 *
 * This file is deliberately the *only* thing in Epic 3 that has no dependencies of its
 * own beyond `blueprint.ts` and two type-only imports. It contains no database access,
 * no `Date.now()`, no React and no Next -- it is types, pure functions over their
 * arguments, and string constants. That is what lets Waves 1-3 be written in parallel:
 * every task can import from here, and none of them has to wait on another agent's
 * unmerged file.
 *
 * ## Why the deadline functions live here rather than with the code that uses them
 *
 * Two Wave 1 tasks need the same answer to "when does this module end?": the state
 * machine builds a `TimerInfo` from it, and the per-question save path uses it to decide
 * whether a late answer falls inside D3's grace window. If that logic lived in either
 * task's file, the other would be blocked on unmerged work by a different agent in the
 * same wave. As a pure function of (blueprint, timestamp) both import it and neither
 * waits. The same reasoning puts the stamp *column names* here: Wave 1's transition code
 * writes them and Wave 1's read models read them, and neither owns the other's file.
 *
 * ## Purity is a requirement, not a style preference
 *
 * `moduleDeadline` and `breakDeadline` must stay pure. A deadline that closed over
 * `Date.now()` would be untestable without faking the clock, would differ between the
 * server that computed it and the client that displays it, and -- worst -- would tempt a
 * caller into treating "now" as the module start, which is exactly the bug D3a's
 * write-if-null stamping exists to prevent. Deadlines are derived from a stored
 * `started_at`; nothing here may invent one.
 *
 * ## Times on the wire
 *
 * SQLite stamps are TEXT written by `datetime('now')`, i.e. `"YYYY-MM-DD HH:MM:SS"` in
 * **UTC with no zone marker**. Everything computed here is epoch milliseconds
 * (`EpochMillis`), which is unambiguous, JSON-safe and directly subtractable. See
 * `parseSqliteTimestamp` for the trap that makes this worth spelling out.
 */
import {
  BREAK_DURATION_SECONDS,
  BLUEPRINT,
  type ModuleNumber,
  type Section,
} from "./blueprint";
import type { DifficultyPath } from "./adaptiveRouting";

/**
 * Milliseconds since the Unix epoch, UTC. Every instant this module produces or accepts
 * is one of these -- never a `Date`, which would carry a local-timezone rendering into
 * comparisons, and never a formatted string, which would have to be re-parsed.
 */
export type EpochMillis = number;

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

/**
 * Matches the two timestamp shapes that can legitimately reach this module:
 * SQLite's `datetime('now')` output (`2026-09-05 14:23:11`) and an ISO-8601 string with
 * `T` and/or a `Z` suffix and/or fractional seconds. Both are read as **UTC**.
 */
const SQLITE_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3})\d*)?Z?$/;

/**
 * Parses a `test_attempts` timestamp column into epoch milliseconds.
 *
 * ## Why this exists instead of `new Date(startedAt)`
 *
 * `datetime('now')` writes `"2026-09-05 14:23:11"` -- UTC, but with no `Z` and no `T`.
 * That is not an ISO-8601 date-time, so `Date`'s parsing of it is implementation-defined,
 * and V8 in particular interprets a space-separated date-time as **local time**. On a
 * machine running anywhere but UTC, `new Date(startedAt)` therefore silently shifts every
 * stamp by the UTC offset: a 32-minute module would appear to have started hours ago and
 * the runner would auto-submit the instant it loaded, or hand out hours of extra time.
 * The failure is invisible in CI (typically UTC) and immediate in local development.
 *
 * Throws on anything it cannot parse rather than returning `NaN`, because `NaN`
 * propagates into a deadline, and `now < NaN` is `false` -- a malformed stamp would
 * present as "time expired" with no explanation anywhere.
 */
export function parseSqliteTimestamp(timestamp: string): EpochMillis {
  const match = SQLITE_TIMESTAMP_PATTERN.exec(timestamp.trim());
  if (!match) {
    throw new Error(
      `Cannot parse "${timestamp}" as a timestamp -- expected SQLite datetime('now') ` +
        `format ("YYYY-MM-DD HH:MM:SS", UTC) or an ISO-8601 equivalent`,
    );
  }

  const [, year, month, day, hour, minute, second, millis] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millis ?? 0),
  );
}

/**
 * Formats an instant the way `datetime('now')` would, for the rare caller that needs to
 * hand SQLite a specific time (tests constructing an already-expired module, chiefly).
 * Production stamps are written by SQLite itself so that the server clock, not the
 * caller's, is the authority.
 */
export function formatSqliteTimestamp(at: EpochMillis): string {
  return new Date(at).toISOString().replace("T", " ").slice(0, 19);
}

// ---------------------------------------------------------------------------
// Deadlines (D3, D8)
// ---------------------------------------------------------------------------

/**
 * D3's grace window, in milliseconds: an answer whose request arrives up to this long
 * after a module's deadline is still saved.
 *
 * It absorbs the unavoidable gap between "the client's countdown hit zero" and "the
 * server finished handling the answer the student clicked at 0:01" -- network latency,
 * a coalesced autosave flushing on unload, and residual clock skew after the client
 * corrects against `TimerInfo.serverNow`. Without it, the last answer of a module is
 * routinely lost, which reads to the student as the app eating their work.
 *
 * Exported in milliseconds, deliberately, because every other quantity in this module is
 * milliseconds and a seconds-vs-millis mixup in a deadline comparison is a silent
 * 1000x error in the permissive direction. It is *not* extra time: the deadline the
 * student sees and the deadline auto-submit fires on are both the ungraced one.
 */
export const LATE_ANSWER_GRACE_MS = 5_000;

/** Per-module time limit in seconds, from the blueprint (PRD 3.2: R&W 32min, Math 35min). */
export function moduleTimeLimitSeconds(section: Section, module: ModuleNumber): number {
  // Both modules of a section currently share one limit; the parameter is here because
  // the deadline API is per-(section, module) and callers should not have to know that
  // the two happen to be equal today.
  void module;
  return BLUEPRINT[section].moduleTimeLimitSeconds;
}

/**
 * When a module's time is up: its server-stamped `{section}_module{n}_started_at` plus
 * the section's blueprint limit.
 *
 * Pure, per this module's header: the answer depends only on the arguments, so the
 * server and the client compute the same instant, a refresh recomputes the identical
 * deadline (which is what makes a countdown survive one), and a test can construct an
 * expired module by passing a timestamp instead of faking a clock.
 */
export function moduleDeadline(
  section: Section,
  module: ModuleNumber,
  startedAt: string,
): EpochMillis {
  return parseSqliteTimestamp(startedAt) + moduleTimeLimitSeconds(section, module) * 1000;
}

/**
 * When the inter-section break is up: `break_started_at` plus D8's 10 minutes.
 *
 * Unlike a module deadline this is advisory -- the student may end the break early, and
 * expiry just means the break screen stops waiting. Math's clock starts at `end-break`
 * either way, never here.
 */
export function breakDeadline(breakStartedAt: string): EpochMillis {
  return parseSqliteTimestamp(breakStartedAt) + BREAK_DURATION_SECONDS * 1000;
}

/**
 * Whether an event at `at` is still acceptable against `deadline`, including D3's grace.
 *
 * Returns `{ accepted, isLate }` rather than a bare boolean because the two facts are
 * genuinely different and the HTTP contract reports both: `accepted` decides whether the
 * write happens, `isLate` tells the client its answer landed after the buzzer (the
 * answer endpoint returns `{saved, isLate}`). Collapsing them would make a saved-but-late
 * answer indistinguishable from an on-time one.
 */
export function checkAgainstDeadline(
  deadline: EpochMillis,
  at: EpochMillis,
): { accepted: boolean; isLate: boolean } {
  const isLate = at > deadline;
  return { accepted: at <= deadline + LATE_ANSWER_GRACE_MS, isLate };
}

/** Seconds left on a deadline, floored at zero. For display only -- never for enforcement. */
export function secondsRemaining(deadline: EpochMillis, now: EpochMillis): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/**
 * The countdown payload D3 hands the client.
 *
 * `serverNow` is what makes this honest across a clock skew the browser cannot detect:
 * the client renders `deadline - serverNow` as the initial remaining time and ticks its
 * own monotonic clock from there, rather than trusting its own wall clock against a
 * server-derived deadline. Both fields are epoch milliseconds, UTC.
 */
export interface TimerInfo {
  /** When this module (or break) ends. Derived, never stored -- see `moduleDeadline`. */
  deadline: EpochMillis;
  /** The server's clock at the moment this payload was built. */
  serverNow: EpochMillis;
  /** The full allowance, for rendering "32:00" before the first tick. */
  durationSeconds: number;
  /** True when the attempt is paused on this phase (countdown frozen). */
  paused?: boolean;
}

// ---------------------------------------------------------------------------
// Attempt state
// ---------------------------------------------------------------------------

/** `test_attempts.status`. */
export type AttemptStatus = "in_progress" | "submitted";

/**
 * One section's progress, as recorded on the `test_attempts` row (migrations 0008/0009).
 *
 * Every field is a stamp or null, and every one of them is write-once (D3a). Together
 * they make section progress fully derivable from a single row: no counting of answered
 * `test_attempt_questions`, which would be wrong anyway -- answers are saved
 * continuously while a module is still in progress, so their presence never means
 * "finished".
 */
export interface SectionState {
  section: Section;
  /** Set when this section's Module 1 clock starts. Null = not reached yet. */
  module1StartedAt: string | null;
  /** Set when the student (or the timer) ends Module 1. Null = still in progress. */
  module1SubmittedAt: string | null;
  module2StartedAt: string | null;
  module2SubmittedAt: string | null;
  /** Null until Module 1 is scored. Never shown to the student. */
  module2DifficultyPath: DifficultyPath | null;
}

/**
 * The whole attempt's flow state: everything needed to answer "where is this student and
 * how much time do they have", read from one `test_attempts` row.
 *
 * Keyed by section name so `state[section]` works directly -- `Section` is `"rw" | "math"`
 * and these two properties are named to match.
 */
/** Which clock is frozen when the attempt is paused (migration 0010). */
export type PausePhase = "rw:1" | "rw:2" | "break" | "math:1" | "math:2";

export interface AttemptState {
  attemptId: number;
  status: AttemptStatus;
  /** `test_attempts.started_at` -- when the attempt row was created, not when R&W began. */
  startedAt: string;
  /** Set by the final submit only. */
  submittedAt: string | null;
  /** Set when R&W Module 2 ends; drives D8's break countdown. */
  breakStartedAt: string | null;
  /** When pause began; null = clocks running normally. */
  pausedAt: string | null;
  /** Which phase is frozen while `pausedAt` is set. */
  pausedPhase: PausePhase | null;
  /** Accumulated pause time per phase, in whole seconds (applied on resume). */
  rwModule1PauseSeconds: number;
  rwModule2PauseSeconds: number;
  breakPauseSeconds: number;
  mathModule1PauseSeconds: number;
  mathModule2PauseSeconds: number;
  rw: SectionState;
  math: SectionState;
}

/**
 * D4's canonical position: where the attempt is, at **module granularity only**.
 *
 * It stops at the module on purpose. Which question the student is on, and whether they
 * are looking at that module's review screen, is *sub-position* -- it lives in client
 * state and in the URL, and `test_attempts` cannot see it. A guard that tried to resolve
 * sub-position would bounce students off the review screen and back into the runner on
 * every render. Routes compare only the module part and pass sub-position through
 * untouched.
 */
export type ModulePosition =
  | { kind: "module"; section: Section; module: ModuleNumber }
  | { kind: "break" }
  | { kind: "submitted" };

/** The order sections are taken in: R&W, then the break, then Math. */
export const SECTION_ORDER: readonly Section[] = ["rw", "math"] as const;

/** Structural equality for two positions, for D4's "do these disagree?" redirect check. */
export function samePosition(a: ModulePosition, b: ModulePosition): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind !== "module" || b.kind !== "module") return true;
  return a.section === b.section && a.module === b.module;
}

// ---------------------------------------------------------------------------
// Pause-adjusted deadlines (practice app; migration 0010)
// ---------------------------------------------------------------------------

export const PAUSED_AT_COLUMN = "paused_at";
export const PAUSED_PHASE_COLUMN = "paused_phase";

const PAUSE_SECONDS_COLUMNS: Record<PausePhase, string> = {
  "rw:1": "rw_module1_pause_seconds",
  "rw:2": "rw_module2_pause_seconds",
  break: "break_pause_seconds",
  "math:1": "math_module1_pause_seconds",
  "math:2": "math_module2_pause_seconds",
};

/** SQL column holding accumulated pause seconds for one phase. */
export function pauseSecondsColumn(phase: PausePhase): string {
  return PAUSE_SECONDS_COLUMNS[phase];
}

/** Maps D4 position to the pause phase that should be frozen. */
export function pausePhaseFromPosition(position: ModulePosition): PausePhase | null {
  switch (position.kind) {
    case "module":
      return `${position.section}:${position.module}` as PausePhase;
    case "break":
      return "break";
    case "submitted":
      return null;
  }
}

export function modulePausePhase(section: Section, module: ModuleNumber): PausePhase {
  return `${section}:${module}` as PausePhase;
}

/** Module deadline extended by prior pause segments (not the in-flight pause). */
export function effectiveModuleDeadline(
  section: Section,
  module: ModuleNumber,
  startedAt: string,
  pauseSecondsAccumulated: number,
): EpochMillis {
  return moduleDeadline(section, module, startedAt) + pauseSecondsAccumulated * 1000;
}

/** Break deadline extended by prior pause segments. */
export function effectiveBreakDeadline(
  breakStartedAt: string,
  pauseSecondsAccumulated: number,
): EpochMillis {
  return breakDeadline(breakStartedAt) + pauseSecondsAccumulated * 1000;
}

/**
 * Clock reading for countdown/deadline checks. While paused on `expectedPhase`, returns
 * the pause instant so remaining time stays frozen until resume.
 */
export function effectiveNow(
  now: EpochMillis,
  pausedAt: string | null,
  pausedPhase: PausePhase | null,
  expectedPhase: PausePhase,
): EpochMillis {
  if (pausedAt != null && pausedPhase === expectedPhase) {
    return parseSqliteTimestamp(pausedAt);
  }
  return now;
}

export function isAttemptPaused(state: AttemptState): boolean {
  return state.pausedAt != null;
}

/** Reads accumulated pause seconds for a phase from AttemptState. */
export function pauseSecondsForPhase(state: AttemptState, phase: PausePhase): number {
  switch (phase) {
    case "rw:1":
      return state.rwModule1PauseSeconds;
    case "rw:2":
      return state.rwModule2PauseSeconds;
    case "break":
      return state.breakPauseSeconds;
    case "math:1":
      return state.mathModule1PauseSeconds;
    case "math:2":
      return state.mathModule2PauseSeconds;
  }
}

// ---------------------------------------------------------------------------
// Runner payload (D1)
// ---------------------------------------------------------------------------

/** One selectable choice on a multiple-choice question. Empty list for grid-ins. */
export interface RunnerChoice {
  letter: "A" | "B" | "C" | "D";
  text: string;
}

/**
 * One question as the *client* sees it, plus the student's saved work on it.
 *
 * Note what is absent: `correct_answer`, `rationale`, `difficulty` and `wasRecycled`.
 * The first two would put the answer key in a payload the student can read with devtools;
 * `difficulty` would expose the adaptive routing; `wasRecycled` is a review-screen fact
 * (Epic 5), not something to show mid-test. All four remain available server-side through
 * `readModuleQuestions` -- this type narrows what crosses the wire, it does not discard
 * anything from the read model.
 *
 * The four saved-work fields mirror `QuestionSavedState` from `attemptService.ts`,
 * flattened, because the client treats them as per-question fields rather than as a
 * nested object.
 */
export interface RunnerQuestion {
  id: string;
  /** 1-based position within this module, as the student sees it ("Question 7 of 27"). */
  number: number;
  /** The row's `order_index`. Not the same as `number` -- see attemptService's note on
   *  order_index being a per-(attempt, module) counter that spans both sections. */
  orderIndex: number;
  questionType: "mc" | "grid_in";
  /** Markdown + LaTeX. The passage for R&W, the problem statement for Math. */
  stimulusText: string;
  choices: RunnerChoice[];
  figureAssetPath: string | null;
  userAnswer: string | null;
  flagged: boolean;
  /** Raw JSON text; Epic 4 owns the shape (D5 plumbs it only). */
  crossedOutChoices: string | null;
  /** Raw JSON text; Epic 4 owns the shape (D5 plumbs it only). */
  highlights: string | null;
  /** Cumulative active-view seconds persisted server-side (Story 3.7). */
  timeSpentSeconds: number;
}

/**
 * Everything the runner page needs, in one payload.
 *
 * D1: the whole module ships at once -- 27 (R&W) or 22 (Math) questions -- so Next/Back
 * and the review grid's jump-to-question are pure client state with zero network in the
 * interaction path. Answers flow back separately in the background.
 */
export interface RunnerModule {
  attemptId: number;
  section: Section;
  module: ModuleNumber;
  /** In `order_index` order; `questions[i].number === i + 1`. */
  questions: RunnerQuestion[];
  timer: TimerInfo;
}

// ---------------------------------------------------------------------------
// Stamp columns (D3a)
// ---------------------------------------------------------------------------

/**
 * The `test_attempts` column each module clock and each module submission is stamped in.
 *
 * These are here rather than in either Wave 1 file because both need them and neither
 * owns the other: the transition code writes these columns and the read models read
 * them. Two hand-maintained copies of a column-name map would drift, and a drifted map
 * fails as "the timer resets on refresh", not as a compile error.
 *
 * They are interpolated into SQL by their callers (SQLite cannot parameterise an
 * identifier), which is safe *only* because every value below is a literal in this closed
 * map and the accessors take a typed `Section`/`ModuleNumber` rather than a string.
 * Nothing may build one of these names by concatenation from request input.
 */
const STARTED_AT_COLUMNS: Record<Section, Record<ModuleNumber, string>> = {
  rw: { 1: "rw_module1_started_at", 2: "rw_module2_started_at" },
  math: { 1: "math_module1_started_at", 2: "math_module2_started_at" },
};

const SUBMITTED_AT_COLUMNS: Record<Section, Record<ModuleNumber, string>> = {
  rw: { 1: "rw_module1_submitted_at", 2: "rw_module2_submitted_at" },
  math: { 1: "math_module1_submitted_at", 2: "math_module2_submitted_at" },
};

/** Column holding when this module's clock started (migration 0009). */
export function moduleStartedAtColumn(section: Section, module: ModuleNumber): string {
  return STARTED_AT_COLUMNS[section][module];
}

/** Column holding when this module was declared finished (migrations 0008 and 0009). */
export function moduleSubmittedAtColumn(section: Section, module: ModuleNumber): string {
  return SUBMITTED_AT_COLUMNS[section][module];
}

/** Column holding when the inter-section break started (migration 0009). */
export const BREAK_STARTED_AT_COLUMN = "break_started_at";

// ---------------------------------------------------------------------------
// Routes (D4)
// ---------------------------------------------------------------------------

/** Root of the test-taking routes. The `(test)` route group adds no URL segment. */
export const TEST_ROUTE_ROOT = "/test";

/**
 * The module runner: `/test/42/rw/1`.
 *
 * Section and module are in the URL because this is the one route the D4 guard compares
 * against the resolved position -- a hand-typed or back-buttoned URL naming a finalized
 * module has to be detectable before the page renders.
 */
export function runnerPath(attemptId: number, section: Section, module: ModuleNumber): string {
  return `${TEST_ROUTE_ROOT}/${attemptId}/${section}/${module}`;
}

/**
 * The end-of-module review screen: `/test/42/review`.
 *
 * No section/module segment, on purpose. Review is *sub-position* within the current
 * module (D4), so which module it reviews follows from the attempt's resolved position
 * rather than from the URL -- which also means a stale review URL can never disagree with
 * the attempt's actual state.
 *
 * This cannot collide with the runner route even though both hang off `/test/:id`:
 * `review`, `break` and `submitted` are each a single segment, while the runner is two
 * (`[section]/[module]`), so no URL matches both shapes. (Even at equal depth it would
 * be safe -- a static segment outranks a dynamic one, and `Section` is only ever
 * `"rw" | "math"` -- but the depth difference means it never comes up.)
 */
export function reviewPath(attemptId: number): string {
  return `${TEST_ROUTE_ROOT}/${attemptId}/review`;
}

/** D8's 10-minute inter-section break: `/test/42/break`. */
export function breakPath(attemptId: number): string {
  return `${TEST_ROUTE_ROOT}/${attemptId}/break`;
}

/** D6's post-submit confirmation stub: `/test/42/submitted`. */
export function submittedPath(attemptId: number): string {
  return `${TEST_ROUTE_ROOT}/${attemptId}/submitted`;
}

/**
 * Epic 5 (Story 5.3): post-submit score report — `/test/42/results`.
 *
 * Distinct from `reviewPath` (end-of-module review, Epic 3 Story 3.4). Static segment
 * `results` cannot collide with the runner's `[section]/[module]` shape for the same
 * reason `review` cannot.
 */
export function resultsPath(attemptId: number): string {
  return `${TEST_ROUTE_ROOT}/${attemptId}/results`;
}

/**
 * Epic 5 (Story 5.4): post-submit answer review — `/test/42/results/answers`.
 *
 * Nested under `results` so the dashboard and per-question review share a namespace and
 * guards can treat any `/results/*` path as post-submit-only.
 */
export function answerReviewPath(attemptId: number): string {
  return `${resultsPath(attemptId)}/answers`;
}

/**
 * The canonical URL for a position.
 *
 * This is what a D4 guard redirects to and what every route handler's `next` field is
 * rendered through, so "where does the student go now" has exactly one implementation and
 * the client never has to assemble a route itself.
 */
export function pathForPosition(attemptId: number, position: ModulePosition): string {
  switch (position.kind) {
    case "module":
      return runnerPath(attemptId, position.section, position.module);
    case "break":
      return breakPath(attemptId);
    case "submitted":
      return submittedPath(attemptId);
  }
}
