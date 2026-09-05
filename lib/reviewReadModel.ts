/**
 * Epic 5 (Story 5.4): post-submit answer review read model.
 *
 * Returns the full answer key, rationales, recycle flags, and pacing data for every
 * question in a submitted attempt. Never used mid-test — review routes guard on
 * `status === 'submitted'`.
 */
import type Database from "better-sqlite3";
import type { Section } from "./blueprint";
import type { ReviewQuestion } from "./resultsContract";
import type { RunnerChoice } from "./testFlow";

const CHOICE_LETTERS = ["A", "B", "C", "D"] as const;

function buildChoices(row: {
  choice_a: string | null;
  choice_b: string | null;
  choice_c: string | null;
  choice_d: string | null;
}): RunnerChoice[] {
  const choiceTexts: Record<(typeof CHOICE_LETTERS)[number], string | null> = {
    A: row.choice_a,
    B: row.choice_b,
    C: row.choice_c,
    D: row.choice_d,
  };
  return CHOICE_LETTERS.filter((letter) => choiceTexts[letter] != null).map((letter) => ({
    letter,
    text: choiceTexts[letter] as string,
  }));
}

const REVIEW_ORDER_SQL = `
  CASE taq.section WHEN 'rw' THEN 0 ELSE 1 END,
  taq.module,
  taq.order_index
`;

/**
 * Reads all questions for a submitted attempt in test order (R&W M1 → M2 → Math M1 → M2).
 */
export function readReviewQuestions(db: Database.Database, attemptId: number): ReviewQuestion[] {
  const rows = db
    .prepare(
      `WITH own_serve AS (
         SELECT question_id, MIN(id) AS min_id
         FROM question_serve_log
         WHERE attempt_id = ?
         GROUP BY question_id
       )
       SELECT q.id, q.section, taq.module, q.question_type, q.stimulus_text,
         q.choice_a, q.choice_b, q.choice_c, q.choice_d, q.figure_asset_path,
         q.correct_answer, q.rationale,
         taq.user_answer, taq.is_correct, taq.flagged, taq.time_spent_seconds,
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
       WHERE taq.attempt_id = ?
       ORDER BY ${REVIEW_ORDER_SQL}`,
    )
    .all(attemptId, attemptId, attemptId) as {
    id: string;
    section: Section;
    module: 1 | 2;
    question_type: "mc" | "grid_in";
    stimulus_text: string;
    choice_a: string | null;
    choice_b: string | null;
    choice_c: string | null;
    choice_d: string | null;
    figure_asset_path: string | null;
    correct_answer: string;
    rationale: string | null;
    user_answer: string | null;
    is_correct: number | null;
    flagged: number;
    time_spent_seconds: number;
    was_recycled: number;
  }[];

  return rows.map((row, index) => ({
    id: row.id,
    number: index + 1,
    section: row.section,
    module: row.module,
    questionType: row.question_type,
    stimulusText: row.stimulus_text,
    choices: buildChoices(row),
    figureAssetPath: row.figure_asset_path,
    userAnswer: row.user_answer,
    correctAnswer: row.correct_answer,
    isCorrect: row.is_correct === 1,
    rationale: row.rationale,
    wasRecycled: row.was_recycled === 1,
    timeSpentSeconds: row.time_spent_seconds,
    flagged: row.flagged === 1,
  }));
}
