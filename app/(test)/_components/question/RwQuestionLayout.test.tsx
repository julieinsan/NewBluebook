import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { RwQuestionLayout } from "./RwQuestionLayout";
import { RW_MC_QUESTION, RW_PASSAGE } from "./fixtures";

test("RwQuestionLayout renders two-pane passage and choices", () => {
  render(
    <RwQuestionLayout
      passage={RW_PASSAGE.stimulusText}
      questionStem={RW_MC_QUESTION.stimulusText}
      question={RW_MC_QUESTION}
      selectedLetter="C"
    />,
  );
  expect(screen.getByTestId("rw-layout")).toBeDefined();
  expect(screen.getByLabelText("Passage")).toBeDefined();
  expect(screen.getByLabelText("Question")).toBeDefined();
  expect(screen.getByText(/Which choice best summarizes/)).toBeDefined();
  expect(screen.getByText("Desert plants rarely photosynthesize.")).toBeDefined();
});
