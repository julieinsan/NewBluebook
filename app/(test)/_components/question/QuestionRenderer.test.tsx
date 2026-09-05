import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuestionRenderer } from "./QuestionRenderer";
import { MATH_MC_QUESTION, RW_MC_QUESTION } from "./fixtures";

test("QuestionRenderer picks the R&W layout", () => {
  render(<QuestionRenderer section="rw" question={RW_MC_QUESTION} passageText="Passage text." />);
  expect(screen.getByTestId("rw-layout")).toBeDefined();
  expect(screen.getByText("Passage text.")).toBeDefined();
});

test("QuestionRenderer picks the Math layout", () => {
  render(<QuestionRenderer section="math" question={MATH_MC_QUESTION} />);
  expect(screen.getByTestId("math-layout")).toBeDefined();
});
