import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BreakCountdown } from "./BreakCountdown";

test("BreakCountdown shows remaining time and resume action", () => {
  const onResume = vi.fn();
  render(
    <BreakCountdown
      breakStartedAt="2026-09-05 14:00:00"
      serverNow={Date.UTC(2026, 8, 5, 14, 5, 0)}
      onResume={onResume}
    />,
  );
  expect(screen.getByText("Take a Break")).toBeDefined();
  expect(screen.getByRole("button", { name: "Resume testing" })).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Resume testing" }));
  expect(onResume).toHaveBeenCalled();
});
