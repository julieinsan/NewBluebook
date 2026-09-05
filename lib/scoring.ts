/**
 * Epic 5: scoring types, aggregation, and persistence (Stories 5.1–5.2).
 *
 * Raw counts come from `test_attempt_questions.is_correct` (graded on save in Epic 3).
 * Scaled scores use the approximate curves in `scoringCurve.ts`.
 */
import type Database from "better-sqlite3";
import { BLUEPRINT, type Section } from "./blueprint";
import { rawToScaledMath, rawToScaledRw } from "./scoringCurve";

export interface ModuleRawScore {
  section: Section;
  module: 1 | 2;
  correct: number;
  total: number;
}

export interface DomainRawScore {
  section: Section;
  domain: string;
  correct: number;
  total: number;
}

export interface SectionRawScore {
  section: Section;
  correct: number;
  total: number;
}

export interface AttemptRawBreakdown {
  modules: ModuleRawScore[];
  sections: SectionRawScore[];
  domains: DomainRawScore[];
}

/** Full scored result for a submitted attempt — returned by the results API (Story 5.3). */
export interface AttemptScores {
  attemptId: number;
  rwScaled: number;
  mathScaled: number;
  totalScaled: number;
  raw: AttemptRawBreakdown;
}

const SECTIONS: Section[] = ["rw", "math"];
const MODULES = [1, 2] as const;

/**
 * Aggregates raw correct/total counts for a submitted attempt (Story 5.1).
 */
export function computeRawScores(db: Database.Database, attemptId: number): AttemptRawBreakdown {
  const moduleRows = db
    .prepare(
      `SELECT section, module,
              SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct,
              COUNT(*) AS total
       FROM test_attempt_questions
       WHERE attempt_id = ?
       GROUP BY section, module`,
    )
    .all(attemptId) as { section: Section; module: 1 | 2; correct: number; total: number }[];

  const sectionRows = db
    .prepare(
      `SELECT section,
              SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct,
              COUNT(*) AS total
       FROM test_attempt_questions
       WHERE attempt_id = ?
       GROUP BY section`,
    )
    .all(attemptId) as { section: Section; correct: number; total: number }[];

  const domainRows = db
    .prepare(
      `SELECT taq.section, q.domain,
              SUM(CASE WHEN taq.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
              COUNT(*) AS total
       FROM test_attempt_questions taq
       JOIN questions q ON q.id = taq.question_id
       WHERE taq.attempt_id = ?
       GROUP BY taq.section, q.domain`,
    )
    .all(attemptId) as { section: Section; domain: string; correct: number; total: number }[];

  const moduleMap = new Map(
    moduleRows.map((row) => [`${row.section}:${row.module}`, row] as const),
  );
  const modules: ModuleRawScore[] = [];
  for (const section of SECTIONS) {
    for (const mod of MODULES) {
      const row = moduleMap.get(`${section}:${mod}`);
      modules.push({
        section,
        module: mod,
        correct: row?.correct ?? 0,
        total: row?.total ?? 0,
      });
    }
  }

  const sectionMap = new Map(sectionRows.map((row) => [row.section, row]));
  const sections: SectionRawScore[] = SECTIONS.map((section) => {
    const row = sectionMap.get(section);
    const expectedTotal = BLUEPRINT[section].domains.reduce((sum, d) => sum + d.total, 0);
    return {
      section,
      correct: row?.correct ?? 0,
      total: row?.total ?? expectedTotal,
    };
  });

  const domains: DomainRawScore[] = [];
  for (const section of SECTIONS) {
    for (const { domain, total } of BLUEPRINT[section].domains) {
      const row = domainRows.find((r) => r.section === section && r.domain === domain);
      domains.push({
        section,
        domain,
        correct: row?.correct ?? 0,
        total: row?.total ?? total,
      });
    }
  }

  return { modules, sections, domains };
}

/**
 * Applies approximate scaled curves to a raw breakdown (Story 5.2).
 */
export function computeScaledScores(
  attemptId: number,
  raw: AttemptRawBreakdown,
): AttemptScores {
  const rwSection = raw.sections.find((s) => s.section === "rw");
  const mathSection = raw.sections.find((s) => s.section === "math");
  const rwScaled = rawToScaledRw(rwSection?.correct ?? 0);
  const mathScaled = rawToScaledMath(mathSection?.correct ?? 0);

  return {
    attemptId,
    rwScaled,
    mathScaled,
    totalScaled: rwScaled + mathScaled,
    raw,
  };
}

/**
 * Computes scores and persists scaled columns on `test_attempts`.
 * Called from `submitAttempt` on first delivery (Epic 5 D1).
 */
export function scoreAttempt(db: Database.Database, attemptId: number): AttemptScores {
  const raw = computeRawScores(db, attemptId);
  const scores = computeScaledScores(attemptId, raw);

  db.prepare(
    `UPDATE test_attempts
     SET rw_scaled_score = ?, math_scaled_score = ?, total_scaled_score = ?
     WHERE id = ?`,
  ).run(scores.rwScaled, scores.mathScaled, scores.totalScaled, attemptId);

  return scores;
}

/**
 * Returns scores for a submitted attempt. Scaled values are read from the attempt row;
 * raw breakdown is always recomputed from answer rows.
 */
export function getAttemptScores(db: Database.Database, attemptId: number): AttemptScores {
  const row = db
    .prepare(
      `SELECT status, rw_scaled_score AS rwScaled, math_scaled_score AS mathScaled,
              total_scaled_score AS totalScaled
       FROM test_attempts WHERE id = ?`,
    )
    .get(attemptId) as
    | {
        status: string;
        rwScaled: number | null;
        mathScaled: number | null;
        totalScaled: number | null;
      }
    | undefined;

  if (!row) {
    throw new Error(`Attempt ${attemptId} does not exist`);
  }
  if (row.status !== "submitted") {
    throw new Error(`Attempt ${attemptId} is not submitted`);
  }

  const raw = computeRawScores(db, attemptId);

  if (row.rwScaled != null && row.mathScaled != null && row.totalScaled != null) {
    return {
      attemptId,
      rwScaled: row.rwScaled,
      mathScaled: row.mathScaled,
      totalScaled: row.totalScaled,
      raw,
    };
  }

  return scoreAttempt(db, attemptId);
}
