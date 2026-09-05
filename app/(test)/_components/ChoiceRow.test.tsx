import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChoiceRow } from "./ChoiceRow";

test("ChoiceRow renders letter, text, and handles selection", () => {
  const onSelect = vi.fn();
  render(<ChoiceRow letter="B" text="Second choice" selected onSelect={onSelect} />);
  expect(screen.getByText("Second choice")).toBeDefined();
  expect(document.querySelector(".katex")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Cross out choice B/i }));
  fireEvent.click(screen.getByRole("button", { name: /Flag question/i }));
  fireEvent.click(screen.getByText("Second choice"));
  expect(onSelect).toHaveBeenCalled();
});

test("ChoiceRow renders LaTeX in choice text", () => {
  render(<ChoiceRow letter="B" text="$5$" />);
  expect(document.querySelector(".katex")).toBeTruthy();
});

test("ChoiceRow calls onToggleCrossOut when cross-out button is clicked", () => {
  const onToggleCrossOut = vi.fn();
  render(
    <ChoiceRow letter="C" text="Third choice" onToggleCrossOut={onToggleCrossOut} />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Cross out choice C/i }));
  expect(onToggleCrossOut).toHaveBeenCalledOnce();
});

test("ChoiceRow sets aria-pressed on cross-out button from crossedOut", () => {
  const { rerender } = render(
    <ChoiceRow letter="A" text="First choice" crossedOut={false} />,
  );
  const crossOutButton = screen.getByRole("button", { name: /Cross out choice A/i });
  expect(crossOutButton.getAttribute("aria-pressed")).toBe("false");

  rerender(<ChoiceRow letter="A" text="First choice" crossedOut />);
  expect(crossOutButton.getAttribute("aria-pressed")).toBe("true");
});

test("ChoiceRow applies line-through styling when crossedOut is true", () => {
  render(<ChoiceRow letter="D" text="Fourth choice" crossedOut />);
  const choiceButton = screen.getByText("Fourth choice").closest("button");
  expect(choiceButton?.className).toContain("line-through");
});
