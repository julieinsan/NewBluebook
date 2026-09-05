/**
 * Epic 6: drill session lifecycle — picker metadata, question serve, grading, summary.
 *
 * Drill selection draws randomly from the filtered pool (PRD §3.3: drill is exempt from
 * full-test recycling constraints). Serves are still logged to `question_serve_log`.
 */
import type Database from "better-sqlite3";
import { isAnswerCorrect } from "./adaptiveRouting";
import type { Difficulty, Section } from "./blueprint";
import type {
  DrillAnswerFeedback,
  DrillDomainOption,
  DrillFilters,
  DrillQuestion,
  DrillRunnerState,
  DrillSessionSummary,
} from "./drillContract";
import type { RunnerChoice } from "./testFlow";

const CHOICE_LETTERS = ["A", "B", "C", "D"] as const;

type QuestionRow = {
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
};

function buildChoices(row: QuestionRow): RunnerChoice[] {
  const texts: Record<(typeof CHOICE_LETTERS)[number], string | null> = {
    A: row.choice_a,
    B: row.choice_b,
    C: row.choice_c,
    D: row.choice_d,
  };
  return CHOICE_LETTERS.filter((letter) => texts[letter] != null).map((letter) => ({
    letter,
    text: texts[letter] as string,
  }));
}

function toDrillQuestion(row: QuestionRow): DrillQuestion {
  return {
    id: row.id,
    section: row.section,
    domain: row.domain,
    skill: row.skill,
    difficulty: row.difficulty,
    questionType: row.question_type,
    stimulusText: row.stimulus_text,
    choices: buildChoices(row),
    figureAssetPath: row.figure_asset_path,
  };
}

function parseFiltersJson(raw: string): DrillFilters {
  const parsed = JSON.parse(raw) as DrillFilters;
  if (
    typeof parsed !== "object" ||
    parsed == null ||
    (parsed.section !== "rw" && parsed.section !== "math") ||
    typeof parsed.domain !== "string"
  ) {
    throw new Error("Invalid drill session filters");
  }
  return parsed;
}

function getSessionRow(db: Database.Database, sessionId: number) {
  const row = db
    .prepare("SELECT id, started_at, filters FROM drill_sessions WHERE id = ?")
    .get(sessionId) as { id: number; started_at: string; filters: string } | undefined;
  if (!row) {
    throw new Error(`Drill session ${sessionId} does not exist`);
  }
  return { ...row, filters: parseFiltersJson(row.filters) };
}

function resolveSectionForDomain(db: Database.Database, domain: string): Section {
  const row = db
    .prepare("SELECT section FROM questions WHERE domain = ? LIMIT 1")
    .get(domain) as { section: Section } | undefined;
  if (!row) {
    throw new Error(`Unknown domain "${domain}"`);
  }
  return row.section;
}

function sessionQuestionIds(db: Database.Database, sessionId: number): string[] {
  return (
    db
      .prepare("SELECT question_id FROM drill_session_questions WHERE session_id = ?")
      .all(sessionId) as { question_id: string }[]
  ).map((row) => row.question_id);
}

function sessionStats(db: Database.Database, sessionId: number): { answered: number; correct: number } {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS answered,
              SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct
       FROM drill_session_questions
       WHERE session_id = ? AND user_answer IS NOT NULL`,
    )
    .get(sessionId) as { answered: number; correct: number | null };
  return { answered: row.answered, correct: row.correct ?? 0 };
}

function buildFilterSql(
  filters: DrillFilters,
  excludeIds: string[],
): { sql: string; args: (string | number)[] } {
  const conditions = ["q.section = ?", "q.domain = ?"];
  const args: (string | number)[] = [filters.section, filters.domain];

  if (filters.skill) {
    conditions.push("q.skill = ?");
    args.push(filters.skill);
  }
  if (filters.difficulty !== "any") {
    conditions.push("q.difficulty = ?");
    args.push(filters.difficulty);
  }
  if (excludeIds.length > 0) {
    conditions.push(`q.id NOT IN (${excludeIds.map(() => "?").join(",")})`);
    args.push(...excludeIds);
  }

  return {
    sql: `SELECT q.* FROM questions q WHERE ${conditions.join(" AND ")} ORDER BY RANDOM() LIMIT 1`,
    args,
  };
}

function pickNextQuestionRow(
  db: Database.Database,
  filters: DrillFilters,
  excludeIds: string[],
): QuestionRow | undefined {
  const { sql, args } = buildFilterSql(filters, excludeIds);
  return db.prepare(sql).get(...args) as QuestionRow | undefined;
}

function insertServedQuestion(
  db: Database.Database,
  sessionId: number,
  questionId: string,
): void {
  db.prepare(
    "INSERT INTO drill_session_questions (session_id, question_id) VALUES (?, ?)",
  ).run(sessionId, questionId);
  db.prepare(
    "INSERT INTO question_serve_log (question_id, attempt_id, session_id) VALUES (?, NULL, ?)",
  ).run(questionId, sessionId);
}

/** Domains and skills for the home drill picker (Story 6.1). */
export function listDrillDomainOptions(db: Database.Database): DrillDomainOption[] {
  const rows = db
    .prepare(
      `SELECT section, domain, skill
       FROM questions
       GROUP BY section, domain, skill
       ORDER BY CASE section WHEN 'rw' THEN 0 ELSE 1 END, domain, skill`,
    )
    .all() as { section: Section; domain: string; skill: string }[];

  const byDomain = new Map<string, DrillDomainOption>();
  for (const row of rows) {
    const key = `${row.section}:${row.domain}`;
    const existing = byDomain.get(key);
    if (existing) {
      existing.skills.push(row.skill);
    } else {
      byDomain.set(key, { section: row.section, domain: row.domain, skills: [row.skill] });
    }
  }
  return [...byDomain.values()];
}

/** Creates a session and serves the first question (Story 6.1). */
export function startDrillSession(
  db: Database.Database,
  partialFilters: Omit<DrillFilters, "section">,
): { sessionId: number; state: DrillRunnerState } {
  const section = resolveSectionForDomain(db, partialFilters.domain);
  const filters: DrillFilters = { section, ...partialFilters };

  const run = db.transaction(() => {
    const info = db
      .prepare("INSERT INTO drill_sessions (filters) VALUES (?)")
      .run(JSON.stringify(filters));
    const sessionId = Number(info.lastInsertRowid);

    const row = pickNextQuestionRow(db, filters, []);
    if (!row) {
      throw new Error("No questions match the selected filters");
    }
    insertServedQuestion(db, sessionId, row.id);

    return sessionId;
  });

  const sessionId = run();
  return { sessionId, state: getDrillRunnerState(db, sessionId) };
}

function getLatestSessionQuestion(
  db: Database.Database,
  sessionId: number,
): {
  question_id: string;
  user_answer: string | null;
  is_correct: number | null;
  time_spent_seconds: number;
} | undefined {
  return db
    .prepare(
      `SELECT question_id, user_answer, is_correct, time_spent_seconds
       FROM drill_session_questions
       WHERE session_id = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(sessionId) as
    | {
        question_id: string;
        user_answer: string | null;
        is_correct: number | null;
        time_spent_seconds: number;
      }
    | undefined;
}

function loadQuestionRow(db: Database.Database, questionId: string): QuestionRow {
  const row = db.prepare("SELECT * FROM questions WHERE id = ?").get(questionId) as
    | QuestionRow
    | undefined;
  if (!row) {
    throw new Error(`Question ${questionId} does not exist`);
  }
  return row;
}

function buildFeedback(
  row: QuestionRow,
  userAnswer: string | null,
  isCorrect: boolean,
  timeSpentSeconds: number,
): DrillAnswerFeedback {
  return {
    questionId: row.id,
    userAnswer,
    correctAnswer: row.correct_answer,
    isCorrect,
    rationale: row.rationale,
    timeSpentSeconds,
  };
}

/** Read model for the drill runner page. */
export function getDrillRunnerState(db: Database.Database, sessionId: number): DrillRunnerState {
  const session = getSessionRow(db, sessionId);
  const stats = sessionStats(db, sessionId);
  const latest = getLatestSessionQuestion(db, sessionId);

  if (!latest) {
    throw new Error(`Drill session ${sessionId} has no questions`);
  }

  const row = loadQuestionRow(db, latest.question_id);
  const usedIds = sessionQuestionIds(db, sessionId);
  const canLoadMore =
    latest.user_answer != null &&
    pickNextQuestionRow(db, session.filters, usedIds) != null;

  if (latest.user_answer == null) {
    return {
      sessionId,
      filters: session.filters,
      question: toDrillQuestion(row),
      feedback: null,
      stats,
      canLoadMore: true,
    };
  }

  return {
    sessionId,
    filters: session.filters,
    question: null,
    feedback: buildFeedback(
      row,
      latest.user_answer,
      latest.is_correct === 1,
      latest.time_spent_seconds,
    ),
    stats,
    canLoadMore,
  };
}

/** Grades the current unanswered question (Story 6.2). */
export function saveDrillAnswer(
  db: Database.Database,
  sessionId: number,
  questionId: string,
  userAnswer: string | null,
): DrillRunnerState {
  const latest = getLatestSessionQuestion(db, sessionId);
  if (!latest || latest.question_id !== questionId) {
    throw new Error(`Question ${questionId} is not the active drill question`);
  }
  if (latest.user_answer != null) {
    throw new Error(`Question ${questionId} was already answered in this session`);
  }

  const row = loadQuestionRow(db, questionId);
  const isCorrect = isAnswerCorrect(row.correct_answer, userAnswer);

  db.prepare(
    `UPDATE drill_session_questions
     SET user_answer = ?, is_correct = ?
     WHERE session_id = ? AND question_id = ? AND user_answer IS NULL`,
  ).run(userAnswer, isCorrect ? 1 : 0, sessionId, questionId);

  return getDrillRunnerState(db, sessionId);
}

/** Serves the next question after the previous one was answered. */
export function serveNextDrillQuestion(
  db: Database.Database,
  sessionId: number,
): DrillRunnerState {
  const session = getSessionRow(db, sessionId);
  const latest = getLatestSessionQuestion(db, sessionId);
  if (!latest || latest.user_answer == null) {
    throw new Error("Answer the current question before loading the next one");
  }

  const usedIds = sessionQuestionIds(db, sessionId);
  const row = pickNextQuestionRow(db, session.filters, usedIds);
  if (!row) {
    return {
      sessionId,
      filters: session.filters,
      question: null,
      feedback: null,
      stats: sessionStats(db, sessionId),
      canLoadMore: false,
    };
  }

  insertServedQuestion(db, sessionId, row.id);
  return getDrillRunnerState(db, sessionId);
}

/** Adds active-view seconds (Story 6.4). */
export function addDrillTimeSpent(
  db: Database.Database,
  sessionId: number,
  questionId: string,
  deltaSeconds: number,
): void {
  if (!Number.isInteger(deltaSeconds) || deltaSeconds <= 0) {
    throw new Error("deltaSeconds must be a positive integer");
  }

  const updated = db
    .prepare(
      `UPDATE drill_session_questions
       SET time_spent_seconds = time_spent_seconds + ?
       WHERE session_id = ? AND question_id = ?`,
    )
    .run(deltaSeconds, sessionId, questionId);
  if (updated.changes === 0) {
    throw new Error(`Question ${questionId} is not part of drill session ${sessionId}`);
  }
}

/** Session rollup for the summary screen (Story 6.3). */
export function getDrillSessionSummary(
  db: Database.Database,
  sessionId: number,
): DrillSessionSummary {
  const session = getSessionRow(db, sessionId);
  const stats = sessionStats(db, sessionId);
  const accuracyPercent =
    stats.answered > 0 ? Math.round((stats.correct / stats.answered) * 100) : 0;

  return {
    sessionId,
    startedAt: session.started_at,
    filters: session.filters,
    answered: stats.answered,
    correct: stats.correct,
    accuracyPercent,
  };
}

/** Count of matching questions for empty-pool validation in the picker. */
export function countMatchingDrillQuestions(
  db: Database.Database,
  filters: DrillFilters,
): number {
  const { sql, args } = buildFilterSql(filters, []);
  const countSql = sql.replace("SELECT q.*", "SELECT COUNT(*) AS count").replace(
    " ORDER BY RANDOM() LIMIT 1",
    "",
  );
  const row = db.prepare(countSql).get(...args) as { count: number };
  return row.count;
}

export { resolveSectionForDomain };
