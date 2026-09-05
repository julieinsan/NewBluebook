import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { MathQuestionLayout } from "./MathQuestionLayout";
import { MATH_GRID_IN_QUESTION, MATH_MC_QUESTION } from "./fixtures";

test("MathQuestionLayout renders multiple-choice math with a figure", () => {
  render(<MathQuestionLayout question={MATH_MC_QUESTION} selectedLetter="B" />);
  expect(screen.getByTestId("math-layout")).toBeDefined();
  expect(screen.getByRole("img")).toBeDefined();
  expect(document.querySelector(".katex")).toBeTruthy();
});

test("MathQuestionLayout renders grid-in input", () => {
  render(<MathQuestionLayout question={MATH_GRID_IN_QUESTION} gridInValue="113" />);
  const input = screen.getByLabelText("Grid-in answer") as HTMLInputElement;
  expect(input.value).toBe("113");
});
