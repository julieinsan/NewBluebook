/**
 * Epic 6: drill mode types — picker filters, runner payload, session summary.
 */
import type { Difficulty, Section } from "./blueprint";
import type { RunnerChoice } from "./testFlow";

/** Stored on `drill_sessions.filters` as JSON. */
export interface DrillFilters {
  section: Section;
  domain: string;
  /** Omitted or null = any skill within the domain. */
  skill: string | null;
  /** `"any"` = all difficulties in the domain. */
  difficulty: Difficulty | "any";
}

/** One domain row for the home picker, with skills loaded from the bank. */
export interface DrillDomainOption {
  section: Section;
  domain: string;
  skills: string[];
}

/** Question shown during the untimed drill runner (before or after grading). */
export interface DrillQuestion {
  id: string;
  section: Section;
  domain: string;
  skill: string;
  difficulty: Difficulty;
  questionType: "mc" | "grid_in";
  stimulusText: string;
  choices: RunnerChoice[];
  figureAssetPath: string | null;
}

/** Instant feedback returned after the student checks an answer (Story 6.2). */
export interface DrillAnswerFeedback {
  questionId: string;
  userAnswer: string | null;
  correctAnswer: string;
  isCorrect: boolean;
  rationale: string | null;
  timeSpentSeconds: number;
}

/** End-of-session rollup (Story 6.3). */
export interface DrillSessionSummary {
  sessionId: number;
  startedAt: string;
  filters: DrillFilters;
  answered: number;
  correct: number;
  accuracyPercent: number;
}

/** Runner read model for the active drill page. */
export interface DrillRunnerState {
  sessionId: number;
  filters: DrillFilters;
  /** Current question when answering; null when showing feedback or session ended. */
  question: DrillQuestion | null;
  /** Set after the student checks the current question. */
  feedback: DrillAnswerFeedback | null;
  stats: { answered: number; correct: number };
  /** False when the filtered pool is exhausted and the last question was answered. */
  canLoadMore: boolean;
}
