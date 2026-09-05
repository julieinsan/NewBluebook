import type { ReviewQuestion } from "@/lib/resultsContract";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { AnswerReviewRunner } from "./AnswerReviewRunner";

const FIXTURE_QUESTIONS: ReviewQuestion[] = [
  {
    id: "q-1",
    number: 1,
    section: "rw",
    module: 1,
    questionType: "mc",
    stimulusText: "Passage text.\n\nWhat is the main idea?",
    choices: [
      { letter: "A", text: "First choice" },
      { letter: "B", text: "Second choice" },
      { letter: "C", text: "Third choice" },
      { letter: "D", text: "Fourth choice" },
    ],
    figureAssetPath: null,
    userAnswer: "A",
    correctAnswer: "A",
    isCorrect: true,
    rationale: "Choice A matches the passage.",
    wasRecycled: false,
    timeSpentSeconds: 75,
    flagged: false,
  },
  {
    id: "q-2",
    number: 2,
    section: "math",
    module: 1,
    questionType: "grid_in",
    stimulusText: "Solve for $x$.",
    choices: [],
    figureAssetPath: null,
    userAnswer: "3",
    correctAnswer: "4",
    isCorrect: false,
    rationale: "The correct value is 4.",
    wasRecycled: true,
    timeSpentSeconds: 135,
    flagged: true,
  },
];

test("AnswerReviewRunner shows first question and advances with Next", () => {
  render(<AnswerReviewRunner attemptId={42} questions={FIXTURE_QUESTIONS} />);

  expect(screen.getByText("Question 1 of 2")).toBeDefined();
  expect(screen.getByTestId("answer-status").textContent).toBe("Correct");
  expect(screen.getByTestId("rationale-block").textContent).toMatch(/Choice A matches/);
  expect(screen.getByText(/Time spent: 1m 15s/)).toBeDefined();

  fireEvent.click(screen.getByRole("button", { name: "Next" }));

  expect(screen.getByText("Question 2 of 2")).toBeDefined();
  expect(screen.getByTestId("answer-status").textContent).toBe("Incorrect");
  expect(screen.getByTestId("seen-before-badge")).toBeDefined();
  expect(screen.getByTestId("flagged-indicator")).toBeDefined();
  expect(screen.getByText(/Time spent: 2m 15s/)).toBeDefined();
});

test("AnswerReviewRunner Back returns to previous question", () => {
  render(<AnswerReviewRunner attemptId={42} questions={FIXTURE_QUESTIONS} />);

  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));

  expect(screen.getByText("Question 1 of 2")).toBeDefined();
});

test("AnswerReviewRunner disables Back on first question", () => {
  render(<AnswerReviewRunner attemptId={42} questions={FIXTURE_QUESTIONS} />);

  expect(screen.getByRole("button", { name: "Back" }).hasAttribute("disabled")).toBe(true);
});

test("AnswerReviewRunner shows Done link on last question", () => {
  render(<AnswerReviewRunner attemptId={42} questions={FIXTURE_QUESTIONS} />);

  fireEvent.click(screen.getByRole("button", { name: "Next" }));

  expect(screen.getByRole("link", { name: "Done" }).getAttribute("href")).toBe("/test/42/results");
});
