import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BottomBar } from "./BottomBar";
import { FIXTURE_QUESTIONS } from "./fixtures";

test("BottomBar shows question progress and navigation buttons", () => {
  render(
    <BottomBar
      questions={FIXTURE_QUESTIONS}
      currentIndex={0}
      onBack={vi.fn()}
      onNext={vi.fn()}
    />,
  );
  expect(screen.getByText("Question 1 of 3")).toBeDefined();
  expect(screen.getByText("ID: q-1")).toBeDefined();
  expect(screen.getByRole("button", { name: "Back" })).toBeDefined();
  expect(screen.getByRole("button", { name: "Next" })).toBeDefined();
});

test("BottomBar expands the review grid", () => {
  const onJump = vi.fn();
  render(
    <BottomBar
      questions={FIXTURE_QUESTIONS}
      currentIndex={1}
      onJumpToQuestion={onJump}
    />,
  );
  fireEvent.click(screen.getByText("Question 2 of 3"));
  fireEvent.click(screen.getByRole("listitem", { name: /Question 3, q-3, unanswered/ }));
  expect(onJump).toHaveBeenCalledWith(2);
});
