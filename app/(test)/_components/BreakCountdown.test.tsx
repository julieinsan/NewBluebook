import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BreakCountdown } from "./BreakCountdown";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

test("BreakCountdown shows remaining time and resume action", () => {
  const onResume = vi.fn();
  render(
    <BreakCountdown
      attemptId={1}
      timer={{
        deadline: Date.UTC(2026, 8, 5, 14, 10, 0),
        serverNow: Date.UTC(2026, 8, 5, 14, 5, 0),
        durationSeconds: 600,
      }}
      onResume={onResume}
    />,
  );
  expect(screen.getByText("Take a Break")).toBeDefined();
  expect(screen.getByRole("button", { name: "Resume testing" })).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Resume testing" }));
  expect(onResume).toHaveBeenCalled();
});
