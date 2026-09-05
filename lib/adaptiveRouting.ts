/**
 * Story 2.4: adaptive Module 2 routing.
 *
 * After a section's Module 1 is submitted (answers recorded in `test_attempt_questions`),
 * computes the raw score and routes Module 2 to a "harder" or "easier" difficulty pool
 * per PRD Section 4.1's confirmed threshold (>=60% correct -> harder, else easier). The
 * routing decision is stored on `test_attempts` but never shown to the user.
 *
 * See `moduleAssembly.ts` for the documented Module 2 difficulty-mix percentages for
 * each path.
 */
import type Database from "better-sqlite3";
import type { Section } from "./blueprint";

export const ADAPTIVE_THRESHOLD = 0.6;
export type DifficultyPath = "harder" | "easier";

/**
 * Grades a single question given its `questions.correct_answer` field and the
 * student's raw `user_answer`.
 *
 * Handles grid-in questions whose `correct_answer` may be a comma-separated list of
 * equivalent accepted forms (e.g. `"6.5, 13/2"`) -- the student's answer is correct if
 * it matches ANY one of those forms after trimming whitespace and normalizing case.
 * For ordinary multiple-choice questions, `correct_answer` has no comma, so the same
 * logic degenerates to a plain (trimmed, case-insensitive) equality check against the
 * single accepted letter.
 *
 * This does not attempt deeper numeric-equivalence normalization (e.g. "6.50" vs "6.5",
 * or re-simplifying fractions) beyond whitespace/case -- the ingested `correct_answer`
 * field is expected to already enumerate every accepted literal form (per Story 1.2),
 * so exact (trimmed/case-insensitive) string matching against each listed alternative
 * is sufficient here.
 */
export function isAnswerCorrect(correctAnswerField: string, userAnswer: string | null): boolean {
  if (userAnswer == null) return false;
  const normalizedUserAnswer = userAnswer.trim().toLowerCase();
  if (normalizedUserAnswer === "") return false;

  const acceptedForms = correctAnswerField.split(",").map((form) => form.trim().toLowerCase());
  return acceptedForms.includes(normalizedUserAnswer);
}

export interface Module1ScoreResult {
  correctCount: number;
  totalCount: number;
  rawScore: number; // fraction correct, 0-1
  path: DifficultyPath;
}

/**
 * Scores a section's Module 1 for an attempt from `test_attempt_questions` (joined to
 * `questions` for `correct_answer`), and determines the Module 2 routing path. Does
 * NOT persist anything -- pure computation over already-submitted answers, so it can
 * be called for inspection without side effects. `assembleModule2ForSection` (in
 * `attemptService.ts`) is what actually stores the path.
 */
export function scoreModule1(
  db: Database.Database,
  attemptId: number,
  section: Section,
): Module1ScoreResult {
  const rows = db
    .prepare(
      `SELECT taq.user_answer AS user_answer, q.correct_answer AS correct_answer
       FROM test_attempt_questions taq
       JOIN questions q ON q.id = taq.question_id
       WHERE taq.attempt_id = ? AND taq.section = ? AND taq.module = 1`,
    )
    .all(attemptId, section) as { user_answer: string | null; correct_answer: string }[];

  if (rows.length === 0) {
    throw new Error(
      `No Module 1 questions found for attempt ${attemptId} / section "${section}" -- ` +
        `has Module 1 been assembled yet?`,
    );
  }

  const totalCount = rows.length;
  const correctCount = rows.filter((r) => isAnswerCorrect(r.correct_answer, r.user_answer)).length;
  const rawScore = correctCount / totalCount;
  const path: DifficultyPath = rawScore >= ADAPTIVE_THRESHOLD ? "harder" : "easier";

  return { correctCount, totalCount, rawScore, path };
}
