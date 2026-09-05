import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReviewGrid } from "./ReviewGrid";
import { FIXTURE_QUESTIONS } from "./fixtures";

test("ReviewGrid renders numbered bubbles for each question", () => {
  render(<ReviewGrid questions={FIXTURE_QUESTIONS} currentIndex={0} />);
  expect(screen.getByRole("listitem", { name: /Question 1/ })).toBeDefined();
  expect(screen.getByRole("listitem", { name: /Question 2, flagged/ })).toBeDefined();
  expect(screen.getByRole("listitem", { name: /Question 3, unanswered/ })).toBeDefined();
});

test("ReviewGrid calls onSelectQuestion when a bubble is clicked", () => {
  const onSelect = vi.fn();
  render(
    <ReviewGrid questions={FIXTURE_QUESTIONS} currentIndex={0} onSelectQuestion={onSelect} />,
  );
  fireEvent.click(screen.getByRole("listitem", { name: /Question 2, flagged/ }));
  expect(onSelect).toHaveBeenCalledWith(1);
});
