/**
 * Story 2.2: least-recently-used question selection with recycling.
 *
 * Given a (section, domain, [skill], difficulty) filter and a desired count, returns
 * up to `count` distinct `questions` rows, preferring rows that have never appeared in
 * `question_serve_log`. Once a domain/difficulty combination's never-served pool is
 * exhausted, falls back to the least-recently-served rows (oldest `served_at` first) --
 * this is expected to happen routinely against this bank (PRD Section 3.3).
 *
 * Every row returned is logged to `question_serve_log` immediately (in the same call),
 * stamped with whichever of attemptId/sessionId the caller supplied, so the next call
 * sees an up-to-date recency picture.
 *
 * This function never returns duplicates and never returns MORE than the number of
 * distinct matching rows in the bank -- if the filtered pool is smaller than `count`
 * (e.g. asking for 15 Algebra questions against a 23-question domain that a broader
 * selection has already partly consumed), it returns as many as are available and lets
 * the caller (module assembly, Stories 2.3/2.4) decide how to make up the shortfall
 * (e.g. widening to an adjacent difficulty). This function does not implement that
 * fallback itself -- it's a single-bucket primitive.
 */
import type Database from "better-sqlite3";
import type { Section, Difficulty } from "./blueprint";

export interface QuestionRow {
  id: string;
  section: Section;
  domain: string;
  skill: string;
  difficulty: Difficulty;
  question_type: "mc" | "grid_in";
  stimulus_text: string;
  choice_a: string | null;
  choice_b: string | null;
  choice_c: string | null;
  choice_d: string | null;
  correct_answer: string;
  rationale: string | null;
  figure_asset_path: string | null;
}

export interface SelectedQuestion extends QuestionRow {
  /** True if this question had at least one prior `question_serve_log` entry before
   * this selection -- i.e. it's being recycled, not served fresh. Callers (later, the
   * review-screen UI per PRD Section 3.3/5.4) can use this to flag it "seen before". */
  wasRecycled: boolean;
}

export interface SelectQuestionsParams {
  section: Section;
  domain: string;
  /** Optional: narrow to a specific skill within the domain. */
  skill?: string;
  difficulty: Difficulty;
  count: number;
  /** Exactly one of attemptId/sessionId must be supplied (app-level rule; the DB CHECK
   * only requires at least one, but every real caller in this codebase has exactly
   * one to attribute to). */
  attemptId?: number;
  sessionId?: number;
  /** Question IDs to skip, e.g. ones already selected earlier in the same assembly
   * pass (from a different difficulty fallback tier) so they can't be picked twice. */
  excludeIds?: string[];
}

/**
 * Selects and immediately logs up to `count` questions matching the given filter,
 * preferring never-served rows, then oldest-served-at.
 */
export function selectQuestions(
  db: Database.Database,
  params: SelectQuestionsParams,
): SelectedQuestion[] {
  const { section, domain, skill, difficulty, count, attemptId, sessionId, excludeIds } = params;

  if (count <= 0) return [];

  if (attemptId == null && sessionId == null) {
    throw new Error("selectQuestions requires either attemptId or sessionId");
  }
  if (attemptId != null && sessionId != null) {
    throw new Error("selectQuestions requires exactly one of attemptId/sessionId, not both");
  }

  const conditions = ["q.section = ?", "q.domain = ?", "q.difficulty = ?"];
  const args: (string | number)[] = [section, domain, difficulty];

  if (skill) {
    conditions.push("q.skill = ?");
    args.push(skill);
  }

  const exclude = excludeIds ?? [];
  if (exclude.length > 0) {
    conditions.push(`q.id NOT IN (${exclude.map(() => "?").join(",")})`);
    args.push(...exclude);
  }

  const sql = `
    SELECT q.*, sl.last_served AS last_served
    FROM questions q
    LEFT JOIN (
      SELECT question_id, MAX(served_at) AS last_served
      FROM question_serve_log
      GROUP BY question_id
    ) sl ON sl.question_id = q.id
    WHERE ${conditions.join(" AND ")}
    ORDER BY (sl.last_served IS NULL) DESC, sl.last_served ASC, q.id ASC
    LIMIT ?
  `;
  args.push(count);

  const rows = db.prepare(sql).all(...args) as (QuestionRow & { last_served: string | null })[];

  const selected: SelectedQuestion[] = rows.map((row) => {
    const { last_served, ...question } = row;
    return { ...question, wasRecycled: last_served != null };
  });

  if (selected.length === 0) return selected;

  const logInsert = db.prepare(
    "INSERT INTO question_serve_log (question_id, attempt_id, session_id) VALUES (?, ?, ?)",
  );
  const logAll = db.transaction((questions: SelectedQuestion[]) => {
    for (const q of questions) {
      logInsert.run(q.id, attemptId ?? null, sessionId ?? null);
    }
  });
  logAll(selected);

  return selected;
}
