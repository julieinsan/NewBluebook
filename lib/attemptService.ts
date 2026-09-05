/**
 * Story 2.5: full attempt assembly service.
 *
 * Single entry point (`startNewAttempt`) that creates a `test_attempts` row and
 * assembles both sections' Module 1 (Story 2.3), inserting the results into
 * `test_attempt_questions` (module=1). Module 2 for each section is assembled lazily,
 * once that section's Module 1 has been *finalized* (`finalizeModule1`), via
 * `assembleModule2ForSection`, which scores Module 1 (Story 2.4), stores the routed
 * difficulty path on the attempt, assembles Module 2, and inserts those rows
 * (module=2).
 *
 * ## Why the answer API is split (saveAnswer vs finalizeModule1)
 *
 * PRD Story 3.2 requires the module runner to persist "each answer as it's given
 * (survives a refresh mid-module)". That makes *saving an answer* a continuous,
 * per-question, repeatable event -- the student changes their mind, navigates Back,
 * overwrites a choice -- while *declaring the module finished* happens exactly once.
 * The original `submitModule1Answers` conflated the two, which meant there was no
 * durable state anywhere saying "Module 1 is actually done", and therefore nothing
 * `assembleModule2ForSection` could check. So:
 *
 *  - `saveAnswer`     -- upsert one answer. Idempotent, callable on every keystroke/click.
 *  - `finalizeModule1` -- stamp `{section}_module1_submitted_at` (migration 0008). Once only.
 *  - `submitModule1Answers` -- thin backward-compatible wrapper: save all, then finalize.
 *
 * `saveAnswer` takes an explicit `module` because Epic 3's Module 2 runner needs the
 * exact same per-question persistence path; nothing here may assume module 1.
 *
 * ## The runner read model
 *
 * `readModuleQuestions` is the read counterpart to assembly: it returns an
 * already-served module's questions *and* the student's saved work on them, in
 * `order_index` order. Epic 3's runner, review screen and resume path all read through
 * it, so the `wasRecycled` reconstruction below has exactly one owner.
 *
 * ## Invariants this module now guarantees
 *
 * These are latent-but-harmless while the only caller is the smoke test, and load-bearing
 * the moment Epic 3 calls this from HTTP handlers, where double-submits, refreshes and
 * mid-request failures are routine:
 *
 *  1. **Module 2 requires a finalized Module 1.** `assembleModule2ForSection` throws if
 *     `{section}_module1_submitted_at` is null, rather than scoring an unanswered module
 *     as 0/27 and persisting a bogus "easier" routing.
 *  2. **Module 2 assembly is idempotent.** A second call for the same (attempt, section)
 *     returns the module-2 questions already on record instead of assembling and
 *     inserting a second full module (which previously produced e.g. 54 R&W module-2
 *     rows for one attempt).
 *  3. **Assembly is atomic.** `startNewAttempt` and `assembleModule2ForSection` each run
 *     inside a single `db.transaction(...)`. `assembleModuleForSection` genuinely throws
 *     (when a domain cannot be filled even after difficulty fallback), and before this
 *     that throw left behind a committed half-attempt -- and, worse, `question_serve_log`
 *     rows written by `selectQuestions` for questions that were never shown to anyone,
 *     silently degrading the LRU freshness Story 2.2 exists to protect. Rolling back the
 *     whole call takes those serve-log rows with it.
 *
 * better-sqlite3 transactions require a fully synchronous callback; every function here
 * is synchronous and must stay that way. Nested `db.transaction` calls become SAVEPOINTs,
 * so the inner transactions inside `insertModuleQuestions` and `selectQuestions` keep
 * working unchanged and simply join the outer transaction.
 *
 * ## order_index note
 *
 * `test_attempt_questions` has `UNIQUE (attempt_id, module, order_index)` -- note this
 * is scoped by `module` only, NOT by `section`. Since R&W and Math both use module
 * numbers 1 and 2, a naive per-section 0-based `order_index` would collide across
 * sections within the same module. To satisfy the constraint, `order_index` is a
 * single counter per (attempt, module) that continues across whichever sections have
 * been inserted into that module so far -- e.g. if R&W module 1 is inserted first
 * (order_index 0..26), Math module 1 continues from 27. Each section's own questions
 * remain contiguous and ordered correctly when queried with
 * `WHERE attempt_id = ? AND section = ? AND module = ? ORDER BY order_index`, which is
 * how the UI will always read them -- the shared numbering is an implementation detail
 * to satisfy the schema, not a meaningful cross-section ordering.
 */
import type Database from "better-sqlite3";
import { getDb } from "./db";
import type { Section } from "./blueprint";
import { assembleModule1, assembleModuleForSection, MODULE2_DIFFICULTY_MIX } from "./moduleAssembly";
import { scoreModule1, isAnswerCorrect, type DifficultyPath, type Module1ScoreResult } from "./adaptiveRouting";
import type { QuestionRow, SelectedQuestion } from "./questionSelector";

/**
 * The student's saved work on one served question, as stored on its
 * `test_attempt_questions` row.
 *
 * `is_correct` is deliberately absent. It lives on the same row, but this shape feeds
 * the runner (Epic 3 D1 ships the whole module to the client at once), and correctness
 * must not reach the client mid-test -- see the HTTP contract's "never returns
 * correctness" note on the answer endpoint. Scoring reads the column directly.
 *
 * `crossedOutChoices` and `highlights` are carried as the raw JSON text held in the
 * columns, not parsed. Epic 3 only plumbs them (D5); Epic 4 owns their shape, and
 * parsing them here would mean inventing that shape a whole epic early -- and would give
 * this read path a way to throw on a row a future writer wrote slightly differently.
 */
export interface QuestionSavedState {
  userAnswer: string | null;
  flagged: boolean;
  /** Raw JSON text from `crossed_out_choices`; unparsed on purpose (see above). */
  crossedOutChoices: string | null;
  /** Raw JSON text from `highlights`; unparsed on purpose (see above). */
  highlights: string | null;
}

/**
 * The saved state of a question that was just inserted by assembly.
 *
 * This is not a guess: `insertModuleQuestions` INSERTs only
 * (attempt_id, question_id, module, section, order_index), so the remaining columns take
 * their schema defaults -- `user_answer` NULL, `flagged` 0, `crossed_out_choices` NULL,
 * `highlights` NULL (migration 0003). Stating it explicitly is what lets a freshly
 * assembled module and a read-back module share one type, which matters because
 * `assembleModule2ForSection` returns whichever of the two applies and its caller cannot
 * tell them apart.
 */
const FRESHLY_INSERTED_STATE: QuestionSavedState = {
  userAnswer: null,
  flagged: false,
  crossedOutChoices: null,
  highlights: null,
};

export interface AssembledModuleQuestion {
  orderIndex: number;
  question: SelectedQuestion;
  /**
   * The student's work on this question. Always present, so the two producers of this
   * type -- `insertModuleQuestions` (fresh, always the defaults above) and
   * `readModuleQuestions` (whatever is on the row now) -- are structurally identical.
   */
  state: QuestionSavedState;
}

export interface NewAttemptResult {
  attemptId: number;
  rw: AssembledModuleQuestion[];
  math: AssembledModuleQuestion[];
}

export interface AnswerSubmission {
  questionId: string;
  userAnswer: string | null;
}

export interface Module2Result extends Module1ScoreResult {
  questions: AssembledModuleQuestion[];
}

/** Next order_index to use for (attemptId, module), continuing across sections. */
function nextOrderIndexStart(db: Database.Database, attemptId: number, module: 1 | 2): number {
  const row = db
    .prepare(
      "SELECT COALESCE(MAX(order_index), -1) AS maxIndex FROM test_attempt_questions WHERE attempt_id = ? AND module = ?",
    )
    .get(attemptId, module) as { maxIndex: number };
  return row.maxIndex + 1;
}

function insertModuleQuestions(
  db: Database.Database,
  attemptId: number,
  section: Section,
  module: 1 | 2,
  questions: SelectedQuestion[],
): AssembledModuleQuestion[] {
  let orderIndex = nextOrderIndexStart(db, attemptId, module);
  const insert = db.prepare(
    `INSERT INTO test_attempt_questions (attempt_id, question_id, module, section, order_index)
     VALUES (?, ?, ?, ?, ?)`,
  );

  const inserted: AssembledModuleQuestion[] = [];
  const insertAll = db.transaction((qs: SelectedQuestion[]) => {
    for (const q of qs) {
      insert.run(attemptId, q.id, module, section, orderIndex);
      inserted.push({ orderIndex, question: q, state: { ...FRESHLY_INSERTED_STATE } });
      orderIndex += 1;
    }
  });
  insertAll(questions);

  return inserted;
}

/**
 * Creates a new `test_attempts` row and assembles + persists Module 1 for both
 * sections (R&W first, then Math). Returns everything the UI needs to render R&W
 * Module 1 first, per Story 2.5's acceptance criteria.
 *
 * The whole thing is one transaction: if Math's assembly throws after R&W's succeeded,
 * the attempt row, R&W's `test_attempt_questions` rows AND both sections'
 * `question_serve_log` entries all roll back, rather than leaving a half-built attempt
 * behind and burning serve-log freshness on questions nobody ever saw.
 */
export function startNewAttempt(db: Database.Database = getDb()): NewAttemptResult {
  const run = db.transaction((): NewAttemptResult => {
    const info = db.prepare("INSERT INTO test_attempts DEFAULT VALUES").run();
    const attemptId = info.lastInsertRowid as number;

    const rwQuestions = assembleModule1(db, "rw", attemptId);
    const rw = insertModuleQuestions(db, attemptId, "rw", 1, rwQuestions);

    const mathQuestions = assembleModule1(db, "math", attemptId);
    const math = insertModuleQuestions(db, attemptId, "math", 1, mathQuestions);

    return { attemptId, rw, math };
  });

  return run();
}

/**
 * Persists a single answer (`user_answer` + the graded `is_correct`) onto the one
 * `test_attempt_questions` row for (attempt, section, module, question).
 *
 * Idempotent by construction -- it's a plain UPDATE of that row, so calling it
 * repeatedly as the student changes their mind just overwrites the previous value.
 * This is the call Story 3.2's module runner makes per answer so that a refresh
 * mid-module loses nothing. It deliberately does NOT touch the module's submitted-at
 * stamp: saving an answer never means the module is finished (see `finalizeModule1`).
 *
 * `module` is a parameter, not a constant: Module 2 answers go through this exact same
 * path in Epic 3.
 *
 * Throws if the question isn't part of that attempt/section/module -- an answer for a
 * question the student was never served is a bug in the caller, not something to record.
 */
export function saveAnswer(
  db: Database.Database,
  attemptId: number,
  section: Section,
  module: 1 | 2,
  questionId: string,
  userAnswer: string | null,
): void {
  const row = db
    .prepare(
      `SELECT q.correct_answer AS correct_answer
       FROM test_attempt_questions taq
       JOIN questions q ON q.id = taq.question_id
       WHERE taq.attempt_id = ? AND taq.section = ? AND taq.module = ? AND taq.question_id = ?`,
    )
    .get(attemptId, section, module, questionId) as { correct_answer: string } | undefined;

  if (!row) {
    throw new Error(
      `Question ${questionId} is not part of attempt ${attemptId}'s Module ${module} for section "${section}"`,
    );
  }

  const isCorrect = isAnswerCorrect(row.correct_answer, userAnswer);
  db.prepare(
    `UPDATE test_attempt_questions SET user_answer = ?, is_correct = ?
     WHERE attempt_id = ? AND section = ? AND module = ? AND question_id = ?`,
  ).run(userAnswer, isCorrect ? 1 : 0, attemptId, section, module, questionId);
}

const MODULE1_SUBMITTED_AT_COLUMN: Record<Section, string> = {
  rw: "rw_module1_submitted_at",
  math: "math_module1_submitted_at",
};

const MODULE2_PATH_COLUMN: Record<Section, string> = {
  rw: "rw_module2_difficulty_path",
  math: "math_module2_difficulty_path",
};

/**
 * Declares a section's Module 1 finished by stamping `{section}_module1_submitted_at`
 * (migration 0008). This is the single event that unlocks `assembleModule2ForSection`,
 * and it is the *only* durable evidence that the student actually ended the module --
 * answers alone can't say that, since they're saved continuously while the module is
 * still in progress.
 *
 * Throws if that section's Module 1 is already stamped. A module cannot be submitted
 * twice, and treating a duplicate submit as a no-op would hide the far more likely
 * cause: a double-submitted form or a retried request that would otherwise be silently
 * accepted.
 */
export function finalizeModule1(db: Database.Database, attemptId: number, section: Section): void {
  const column = MODULE1_SUBMITTED_AT_COLUMN[section];

  const finalize = db.transaction(() => {
    const row = db
      .prepare(`SELECT ${column} AS submittedAt FROM test_attempts WHERE id = ?`)
      .get(attemptId) as { submittedAt: string | null } | undefined;

    if (!row) {
      throw new Error(`Attempt ${attemptId} does not exist`);
    }
    if (row.submittedAt != null) {
      throw new Error(
        `Module 1 for section "${section}" of attempt ${attemptId} was already submitted ` +
          `at ${row.submittedAt} -- a module cannot be submitted twice`,
      );
    }

    db.prepare(`UPDATE test_attempts SET ${column} = datetime('now') WHERE id = ?`).run(attemptId);
  });

  finalize();
}

/**
 * Records the student's Module 1 answers for a section and marks that Module 1
 * submitted, in one shot.
 *
 * Retained with its original signature purely for backward compatibility (the Epic 2
 * smoke test and any pre-split caller). It is now a thin wrapper over `saveAnswer` +
 * `finalizeModule1`; Epic 3's runner should call those two directly instead, since it
 * saves answers continuously and finalizes exactly once at the end. Inherits
 * `finalizeModule1`'s "cannot be submitted twice" throw.
 */
export function submitModule1Answers(
  db: Database.Database,
  attemptId: number,
  section: Section,
  answers: AnswerSubmission[],
): void {
  const applyAll = db.transaction((subs: AnswerSubmission[]) => {
    for (const { questionId, userAnswer } of subs) {
      saveAnswer(db, attemptId, section, 1, questionId, userAnswer);
    }
    finalizeModule1(db, attemptId, section);
  });

  applyAll(answers);
}

/**
 * Reads an already-assembled module back out of `test_attempt_questions`, in
 * `order_index` order, shaped exactly like a fresh assembly's return value -- question
 * content *and* the student's saved work on it.
 *
 * This is the single read model behind the Epic 3 runner (D1 ships a whole module to the
 * client in one payload) and behind any resume-after-refresh: it is exported rather than
 * private specifically so nothing else has to re-derive the `wasRecycled` CTE below,
 * which is the one query in this file with a non-obvious correctness argument.
 *
 * The saved-state columns (`user_answer`, `flagged`, `crossed_out_choices`,
 * `highlights`) are read into `AssembledModuleQuestion.state`, the same field a
 * fresh insert fills with the schema defaults. That is what keeps
 * `assembleModule2ForSection`'s two return paths -- newly assembled vs. read back --
 * structurally identical; a caller must never have to ask which one it got.
 *
 * `is_correct` is on these rows and is deliberately not selected: it would ride a
 * runner payload straight to the client mid-test. Scoring reads it directly.
 *
 * ## Recovering `wasRecycled`
 *
 * `SelectedQuestion.wasRecycled` means "this question had already been served at least
 * once before the selection that put it in this module" -- a fact about
 * `question_serve_log` at selection time, which `test_attempt_questions` does not store.
 * Rather than hardcode a value (which would silently lie to the review screen that
 * consumes this flag, per PRD 3.3/5.4), it is reconstructed from the serve log itself:
 * find this attempt's own serve-log entry for the question, and ask whether any serve
 * entry for that question predates it.
 *
 * The comparison is on the log's autoincrement `id`, not `served_at`: `served_at` is
 * `datetime('now')`, i.e. whole-second granularity, so an attempt assembled in the same
 * second as a prior serve would produce ties that could flip the answer either way. `id`
 * is strictly monotonic per insert and gives the exact ordering the original selection
 * saw. This reproduces the original value faithfully as long as the serve log is intact.
 *
 * Fallback: if this attempt has no serve-log entry for the question at all (only
 * possible if the log were pruned or rows were hand-edited -- assembly always writes
 * one), we degrade to "has this question ever been served by anything other than this
 * attempt", which is the same question asked with the ordering information missing.
 */
export function readModuleQuestions(
  db: Database.Database,
  attemptId: number,
  section: Section,
  module: 1 | 2,
): AssembledModuleQuestion[] {
  const rows = db
    .prepare(
      `WITH own_serve AS (
         SELECT question_id, MIN(id) AS min_id
         FROM question_serve_log
         WHERE attempt_id = ?
         GROUP BY question_id
       )
       SELECT q.*, taq.order_index AS order_index,
         taq.user_answer AS user_answer,
         taq.flagged AS flagged,
         taq.crossed_out_choices AS crossed_out_choices,
         taq.highlights AS highlights,
         CASE WHEN own_serve.min_id IS NULL THEN
           EXISTS (
             SELECT 1 FROM question_serve_log sl
             WHERE sl.question_id = q.id AND (sl.attempt_id IS NULL OR sl.attempt_id <> ?)
           )
         ELSE
           EXISTS (
             SELECT 1 FROM question_serve_log sl
             WHERE sl.question_id = q.id AND sl.id < own_serve.min_id
           )
         END AS was_recycled
       FROM test_attempt_questions taq
       JOIN questions q ON q.id = taq.question_id
       LEFT JOIN own_serve ON own_serve.question_id = q.id
       WHERE taq.attempt_id = ? AND taq.section = ? AND taq.module = ?
       ORDER BY taq.order_index`,
    )
    .all(attemptId, attemptId, attemptId, section, module) as (QuestionRow & {
    order_index: number;
    was_recycled: number;
    user_answer: string | null;
    flagged: number;
    crossed_out_choices: string | null;
    highlights: string | null;
  })[];

  return rows.map((row) => {
    const {
      order_index,
      was_recycled,
      user_answer,
      flagged,
      crossed_out_choices,
      highlights,
      ...question
    } = row;
    return {
      orderIndex: order_index,
      question: { ...question, wasRecycled: was_recycled === 1 },
      state: {
        userAnswer: user_answer,
        flagged: flagged === 1,
        crossedOutChoices: crossed_out_choices,
        highlights,
      },
    };
  });
}

/**
 * Scores a section's submitted Module 1 (Story 2.4), stores the routed difficulty
 * path on the attempt, assembles Module 2 from that path's difficulty mix, and
 * persists it (module=2). Never surfaces the routing decision to the user -- it's
 * stored purely for the assembly/scoring engine.
 *
 * Requires that section's Module 1 to have been finalized (`finalizeModule1`, or the
 * `submitModule1Answers` wrapper) -- otherwise it throws instead of scoring a module
 * of nulls as 0/27 and permanently routing the student to the "easier" pool.
 *
 * Idempotent: if Module 2 already exists for (attempt, section), the stored questions
 * and the stored path are returned as-is, with no re-scoring, no re-assembly and no
 * second set of rows. The `correctCount`/`totalCount`/`rawScore` half of the result is
 * recomputed via `scoreModule1` (pure, no side effects), but `path` is read from the
 * attempt row rather than recomputed, so a re-read can never report a path that
 * disagrees with the Module 2 that was actually assembled and served.
 *
 * The whole body is one transaction, so a throw from `assembleModuleForSection` rolls
 * back the stored routing path, any partially inserted questions, and the
 * `question_serve_log` rows `selectQuestions` had already written.
 */
export function assembleModule2ForSection(
  db: Database.Database,
  attemptId: number,
  section: Section,
): Module2Result {
  const pathColumn = MODULE2_PATH_COLUMN[section];
  const submittedAtColumn = MODULE1_SUBMITTED_AT_COLUMN[section];

  const run = db.transaction((): Module2Result => {
    const attempt = db
      .prepare(
        `SELECT ${submittedAtColumn} AS module1SubmittedAt, ${pathColumn} AS storedPath
         FROM test_attempts WHERE id = ?`,
      )
      .get(attemptId) as { module1SubmittedAt: string | null; storedPath: string | null } | undefined;

    if (!attempt) {
      throw new Error(`Attempt ${attemptId} does not exist`);
    }
    if (attempt.module1SubmittedAt == null) {
      throw new Error(
        `Module 1 for section "${section}" has not been submitted yet for attempt ${attemptId} -- ` +
          `call finalizeModule1 (or submitModule1Answers) first; scoring an unsubmitted module ` +
          `would route Module 2 off an incomplete answer set`,
      );
    }

    const score = scoreModule1(db, attemptId, section);

    const existing = db
      .prepare(
        "SELECT COUNT(*) AS count FROM test_attempt_questions WHERE attempt_id = ? AND section = ? AND module = 2",
      )
      .get(attemptId, section) as { count: number };

    if (existing.count > 0) {
      // Already assembled -- return what was actually served, never a second module.
      // `path` comes from the stored column (falling back to the freshly computed one
      // only for rows written before assembly was atomic, where the path could in
      // principle be missing); the counts come from the pure re-score.
      return {
        ...score,
        path: (attempt.storedPath as DifficultyPath | null) ?? score.path,
        questions: readModuleQuestions(db, attemptId, section, 2),
      };
    }

    db.prepare(`UPDATE test_attempts SET ${pathColumn} = ? WHERE id = ?`).run(score.path, attemptId);

    // Hard-exclude every question this section's Module 1 already used in this same
    // attempt, so Module 2 can never repeat one of them (see moduleAssembly.ts's
    // AssembleParams.excludeIds doc comment).
    const alreadyUsed = db
      .prepare("SELECT question_id FROM test_attempt_questions WHERE attempt_id = ? AND section = ?")
      .all(attemptId, section) as { question_id: string }[];

    const mix = MODULE2_DIFFICULTY_MIX[score.path as DifficultyPath];
    const module2Questions = assembleModuleForSection(db, {
      section,
      module: 2,
      mix,
      attemptId,
      excludeIds: alreadyUsed.map((r) => r.question_id),
    });
    const questions = insertModuleQuestions(db, attemptId, section, 2, module2Questions);

    return { ...score, questions };
  });

  return run();
}
