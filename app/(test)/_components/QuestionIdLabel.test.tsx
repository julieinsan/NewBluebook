import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuestionIdLabel } from "./QuestionIdLabel";

test("QuestionIdLabel renders the source question id", () => {
  render(<QuestionIdLabel id="2c3aefc9" />);
  expect(screen.getByTestId("question-id-label").textContent).toBe("ID: 2c3aefc9");
});
