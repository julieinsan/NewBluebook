import type { RunnerQuestion } from "@/lib/testFlow";

export const RW_MC_QUESTION: RunnerQuestion = {
  id: "rw-mc-1",
  number: 4,
  orderIndex: 3,
  questionType: "mc",
  stimulusText:
    "Scientists have long debated the role of **photosynthesis** in desert plants.\n\nWhich choice best summarizes the passage?",
  choices: [
    { letter: "A", text: "Desert plants rarely photosynthesize." },
    { letter: "B", text: "Photosynthesis occurs mainly at night." },
    { letter: "C", text: "Adaptations help conserve water during photosynthesis." },
    { letter: "D", text: "Photosynthesis is unrelated to survival." },
  ],
  figureAssetPath: null,
  userAnswer: "C",
  flagged: false,
  crossedOutChoices: '["A"]',
  highlights: null,
};

export const RW_PASSAGE: RunnerQuestion = {
  ...RW_MC_QUESTION,
  stimulusText:
    "In 1893, the historian wrote that cities \"grow not by addition alone, but by a kind of accretion.\" The metaphor suggests gradual layering over time.\n\nWhat does the quoted word most nearly mean?",
};

export const MATH_MC_QUESTION: RunnerQuestion = {
  id: "math-mc-1",
  number: 8,
  orderIndex: 7,
  questionType: "mc",
  stimulusText: "If $3x + 7 = 22$, what is the value of $x$?",
  choices: [
    { letter: "A", text: "$3$" },
    { letter: "B", text: "$5$" },
    { letter: "C", text: "$7$" },
    { letter: "D", text: "$15$" },
  ],
  figureAssetPath: "/figures/triangle-example.png",
  userAnswer: null,
  flagged: true,
  crossedOutChoices: null,
  highlights: null,
};

export const MATH_GRID_IN_QUESTION: RunnerQuestion = {
  id: "math-grid-1",
  number: 12,
  orderIndex: 11,
  questionType: "grid_in",
  stimulusText: "A circle has radius $6$. What is its area? Enter your answer.",
  choices: [],
  figureAssetPath: null,
  userAnswer: "36π",
  flagged: false,
  crossedOutChoices: null,
  highlights: null,
};
