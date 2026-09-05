import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChoiceRow } from "./ChoiceRow";

test("ChoiceRow renders letter, text, and handles selection", () => {
  const onSelect = vi.fn();
  render(<ChoiceRow letter="B" text="Second choice" selected onSelect={onSelect} />);
  expect(screen.getByText("Second choice")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: /Cross out choice B/i }));
  fireEvent.click(screen.getByRole("button", { name: /Flag question/i }));
  fireEvent.click(screen.getByText("Second choice"));
  expect(onSelect).toHaveBeenCalled();
});
