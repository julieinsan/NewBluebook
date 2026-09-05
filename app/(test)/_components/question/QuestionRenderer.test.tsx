import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuestionRenderer } from "./QuestionRenderer";
import { MATH_MC_QUESTION, RW_MC_QUESTION, RW_PASSAGE } from "./fixtures";

test("QuestionRenderer picks the R&W layout", () => {
  render(<QuestionRenderer section="rw" question={RW_MC_QUESTION} passageText="Passage text." />);
  expect(screen.getByTestId("rw-layout")).toBeDefined();
  expect(screen.getByText("Passage text.")).toBeDefined();
  expect(screen.getByText(/Which choice best summarizes/)).toBeDefined();
});

test("QuestionRenderer splits combined stimulus when no passageText is passed", () => {
  const combined = `${RW_PASSAGE.stimulusText}\n\n${RW_MC_QUESTION.stimulusText}`;
  render(
    <QuestionRenderer
      section="rw"
      question={{ ...RW_MC_QUESTION, stimulusText: combined }}
    />,
  );
  expect(screen.getByText(/In 1893, the historian wrote/)).toBeDefined();
  expect(screen.getByText(/Which choice best summarizes/)).toBeDefined();
  expect(screen.queryByText(combined)).toBeNull();
});

test("QuestionRenderer picks the Math layout", () => {
  render(<QuestionRenderer section="math" question={MATH_MC_QUESTION} />);
  expect(screen.getByTestId("math-layout")).toBeDefined();
});
