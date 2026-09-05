import type { AttemptScores } from "@/lib/scoring";
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResultsDashboard } from "./ResultsDashboard";

const FIXTURE_SCORES: AttemptScores = {
  attemptId: 42,
  rwScaled: 620,
  mathScaled: 500,
  totalScaled: 1120,
  raw: {
    modules: [],
    sections: [
      { section: "rw", correct: 40, total: 54 },
      { section: "math", correct: 28, total: 44 },
    ],
    domains: [
      { section: "rw", domain: "Information and Ideas", correct: 10, total: 14 },
      { section: "rw", domain: "Craft and Structure", correct: 8, total: 15 },
      { section: "rw", domain: "Expression of Ideas", correct: 7, total: 11 },
      { section: "rw", domain: "Standard English Conventions", correct: 9, total: 14 },
      { section: "math", domain: "Algebra", correct: 10, total: 15 },
      { section: "math", domain: "Advanced Math", correct: 8, total: 15 },
      { section: "math", domain: "Problem-Solving and Data Analysis", correct: 5, total: 7 },
      { section: "math", domain: "Geometry and Trigonometry", correct: 5, total: 7 },
    ],
  },
};

test("ResultsDashboard renders total and section scores", () => {
  render(<ResultsDashboard scores={FIXTURE_SCORES} attemptId={42} />);

  expect(screen.getByText("1120")).toBeDefined();
  expect(screen.getByText("620")).toBeDefined();
  expect(screen.getByText("500")).toBeDefined();
});

test("ResultsDashboard shows approximate score disclaimer", () => {
  render(<ResultsDashboard scores={FIXTURE_SCORES} attemptId={42} />);

  expect(screen.getByTestId("approximate-disclaimer").textContent).toMatch(/approximate/i);
  expect(screen.getByTestId("approximate-disclaimer").textContent).toMatch(/College Board/i);
});

test("ResultsDashboard renders domain rows for R&W and Math", () => {
  render(<ResultsDashboard scores={FIXTURE_SCORES} attemptId={42} />);

  expect(screen.getByText("Information and Ideas")).toBeDefined();
  expect(screen.getByText(/10\/14/)).toBeDefined();
  expect(screen.getByText("Algebra")).toBeDefined();
  expect(screen.getByText(/10\/15/)).toBeDefined();
});

test("ResultsDashboard links to answer review and home", () => {
  render(<ResultsDashboard scores={FIXTURE_SCORES} attemptId={42} />);

  expect(screen.getByRole("link", { name: "Review answers" }).getAttribute("href")).toBe(
    "/test/42/results/answers",
  );
  expect(screen.getByRole("link", { name: "Back to home" }).getAttribute("href")).toBe("/");
});
