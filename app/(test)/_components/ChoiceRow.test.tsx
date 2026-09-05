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
