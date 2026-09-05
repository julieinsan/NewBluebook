import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TopBar } from "./TopBar";
import { FIXTURE_TIMER } from "./fixtures";

test("TopBar shows section, module, and countdown", () => {
  render(<TopBar section="rw" module={1} timer={FIXTURE_TIMER} />);
  expect(screen.getByText(/Reading and Writing/)).toBeDefined();
  expect(screen.getByText(/Module 1/)).toBeDefined();
  expect(screen.getByLabelText("Time remaining").textContent).toMatch(/^\d+:\d{2}$/);
});

test("TopBar toggles timer visibility", () => {
  const onTimerVisibilityChange = vi.fn();
  render(
    <TopBar
      section="math"
      module={2}
      timer={FIXTURE_TIMER}
      onTimerVisibilityChange={onTimerVisibilityChange}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Hide timer/i }));
  expect(onTimerVisibilityChange).toHaveBeenCalledWith(false);
  expect(screen.getByText("Timer hidden")).toBeDefined();
});
