import type { AttemptSummary } from "@/lib/attemptState";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { AttemptHistory } from "./AttemptHistory";

const completedAttempt: AttemptSummary = {
  attemptId: 7,
  practiceTest: 1,
  status: "submitted",
  startedAt: "2026-09-01 12:00:00",
  submittedAt: "2026-09-01 14:00:00",
  position: { kind: "submitted" },
  path: "/test/7/submitted",
  resumable: false,
  isPaused: false,
  totalScaledScore: 1120,
};

const inProgressAttempt: AttemptSummary = {
  attemptId: 8,
  practiceTest: 1,
  status: "in_progress",
  startedAt: "2026-09-02 12:00:00",
  submittedAt: null,
  position: { kind: "module", section: "rw", module: 1 },
  path: "/test/8/rw/1",
  resumable: true,
  isPaused: false,
  totalScaledScore: null,
};

test("AttemptHistory shows score and View results for completed attempts", () => {
  render(<AttemptHistory attempts={[completedAttempt]} />);

  expect(screen.getByText("Score: 1120")).toBeDefined();
  expect(screen.getByRole("link", { name: "View results" }).getAttribute("href")).toBe(
    "/test/7/results",
  );
});

test("AttemptHistory keeps Resume link for in-progress attempts", () => {
  render(<AttemptHistory attempts={[inProgressAttempt]} />);

  expect(screen.getByRole("link", { name: "Resume test" }).getAttribute("href")).toBe(
    "/test/8/rw/1",
  );
  expect(screen.queryByText("View results")).toBeNull();
});
