/**
 * Epic 5 (Wave 0): post-submit review payload contract.
 *
 * Deliberately separate from `RunnerQuestion` in `testFlow.ts`, which omits the answer
 * key, rationale, and recycle flag so they cannot leak mid-test. Review routes guard on
 * `status === 'submitted'` and serve this shape only after scoring.
 */
import type { Section } from "./blueprint";
import type { RunnerChoice } from "./testFlow";

/** One question as shown on the post-submit answer-review screen (PRD Story 5.4). */
export interface ReviewQuestion {
  id: string;
  /** 1-based position across the full test (1–98). */
  number: number;
  section: Section;
  module: 1 | 2;
  questionType: "mc" | "grid_in";
  /** Markdown + LaTeX stimulus (passage or problem statement). */
  stimulusText: string;
  /** Empty for grid-in questions. */
  choices: RunnerChoice[];
  figureAssetPath: string | null;
  userAnswer: string | null;
  correctAnswer: string;
  isCorrect: boolean;
  rationale: string | null;
  /** True when this question was recycled from a prior serve (PRD §3.3). */
  wasRecycled: boolean;
  timeSpentSeconds: number;
  flagged: boolean;
}
