import type { RunnerQuestion } from "@/lib/testFlow";

/** Shared fixture data for presentational component tests (Task 2.2). */
export const FIXTURE_QUESTIONS: RunnerQuestion[] = [
  {
    id: "q-1",
    number: 1,
    orderIndex: 0,
    questionType: "mc",
    stimulusText: "Passage about climate.",
    choices: [
      { letter: "A", text: "First choice" },
      { letter: "B", text: "Second choice" },
      { letter: "C", text: "Third choice" },
      { letter: "D", text: "Fourth choice" },
    ],
    figureAssetPath: null,
    userAnswer: "A",
    flagged: false,
    crossedOutChoices: null,
    highlights: null,
  },
  {
    id: "q-2",
    number: 2,
    orderIndex: 1,
    questionType: "mc",
    stimulusText: "Another passage.",
    choices: [
      { letter: "A", text: "Alpha" },
      { letter: "B", text: "Beta" },
      { letter: "C", text: "Gamma" },
      { letter: "D", text: "Delta" },
    ],
    figureAssetPath: null,
    userAnswer: null,
    flagged: true,
    crossedOutChoices: '["B"]',
    highlights: null,
  },
  {
    id: "q-3",
    number: 3,
    orderIndex: 2,
    questionType: "grid_in",
    stimulusText: "Solve for $x$.",
    choices: [],
    figureAssetPath: null,
    userAnswer: null,
    flagged: false,
    crossedOutChoices: null,
    highlights: null,
  },
];

export const FIXTURE_TIMER = {
  deadline: Date.UTC(2026, 8, 5, 15, 0, 0),
  serverNow: Date.UTC(2026, 8, 5, 14, 28, 0),
  durationSeconds: 32 * 60,
};
