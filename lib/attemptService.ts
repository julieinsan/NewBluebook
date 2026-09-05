/**
 * Story 2.5: full attempt assembly service.
 *
 * Single entry point (`startNewAttempt`) that creates a `test_attempts` row and
 * assembles both sections' Module 1 (Story 2.3), inserting the results into
 * `test_attempt_questions` (module=1). Module 2 for each section is assembled lazily,
 * once that section's Module 1 answers are submitted (`submitModule1Answers`), via
 * `assembleModule2ForSection`, which scores Module 1 (Story 2.4), stores the routed
 * difficulty path on the attempt, assembles Module 2, and inserts those rows
 * (module=2).
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
import type { SelectedQuestion } from "./questionSelector";

export interface AssembledModuleQuestion {
  orderIndex: number;
  question: SelectedQuestion;
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
      inserted.push({ orderIndex, question: q });
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
 */
export function startNewAttempt(db: Database.Database = getDb()): NewAttemptResult {
  const info = db.prepare("INSERT INTO test_attempts DEFAULT VALUES").run();
  const attemptId = info.lastInsertRowid as number;

  const rwQuestions = assembleModule1(db, "rw", attemptId);
  const rw = insertModuleQuestions(db, attemptId, "rw", 1, rwQuestions);

  const mathQuestions = assembleModule1(db, "math", attemptId);
  const math = insertModuleQuestions(db, attemptId, "math", 1, mathQuestions);

  return { attemptId, rw, math };
}

/**
 * Records the student's Module 1 answers for a section (user_answer + computed
 * is_correct on each `test_attempt_questions` row). Must be called before
 * `assembleModule2ForSection` for that section, since routing depends on these
 * answers.
 */
export function submitModule1Answers(
  db: Database.Database,
  attemptId: number,
  section: Section,
  answers: AnswerSubmission[],
): void {
  const getCorrectAnswer = db.prepare(
    `SELECT q.correct_answer AS correct_answer
     FROM test_attempt_questions taq
     JOIN questions q ON q.id = taq.question_id
     WHERE taq.attempt_id = ? AND taq.section = ? AND taq.module = 1 AND taq.question_id = ?`,
  );
  const update = db.prepare(
    `UPDATE test_attempt_questions SET user_answer = ?, is_correct = ?
     WHERE attempt_id = ? AND section = ? AND module = 1 AND question_id = ?`,
  );

  const applyAll = db.transaction((subs: AnswerSubmission[]) => {
    for (const { questionId, userAnswer } of subs) {
      const row = getCorrectAnswer.get(attemptId, section, questionId) as
        | { correct_answer: string }
        | undefined;
      if (!row) {
        throw new Error(
          `Question ${questionId} is not part of attempt ${attemptId}'s Module 1 for section "${section}"`,
        );
      }
      const isCorrect = isAnswerCorrect(row.correct_answer, userAnswer);
      update.run(userAnswer, isCorrect ? 1 : 0, attemptId, section, questionId);
    }
  });
  applyAll(answers);
}

const MODULE2_PATH_COLUMN: Record<Section, string> = {
  rw: "rw_module2_difficulty_path",
  math: "math_module2_difficulty_path",
};

/**
 * Scores a section's submitted Module 1 (Story 2.4), stores the routed difficulty
 * path on the attempt, assembles Module 2 from that path's difficulty mix, and
 * persists it (module=2). Never surfaces the routing decision to the user -- it's
 * stored purely for the assembly/scoring engine.
 */
export function assembleModule2ForSection(
  db: Database.Database,
  attemptId: number,
  section: Section,
): Module2Result {
  const score = scoreModule1(db, attemptId, section);

  const column = MODULE2_PATH_COLUMN[section];
  db.prepare(`UPDATE test_attempts SET ${column} = ? WHERE id = ?`).run(score.path, attemptId);

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
}
