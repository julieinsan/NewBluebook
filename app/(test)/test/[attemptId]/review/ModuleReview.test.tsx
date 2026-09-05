import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FIXTURE_QUESTIONS, FIXTURE_TIMER } from "@/app/(test)/_components/fixtures";
import type { RunnerModule } from "@/lib/testFlow";
import { ModuleReview } from "./ModuleReview";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const runnerModule: RunnerModule = {
  attemptId: 1,
  section: "rw",
  module: 1,
  questions: FIXTURE_QUESTIONS,
  timer: FIXTURE_TIMER,
};

test("ModuleReview shows flagged and unanswered counts", () => {
  render(<ModuleReview runnerModule={runnerModule} />);
  expect(screen.getByText(/Flagged \(1\)/)).toBeDefined();
  expect(screen.getByText(/Unanswered \(2\)/)).toBeDefined();
});

test("ModuleReview opens confirm dialog on submit click", () => {
  render(<ModuleReview runnerModule={runnerModule} />);
  fireEvent.click(screen.getByRole("button", { name: /Submit module/i }));
  expect(screen.getByRole("dialog")).toBeDefined();
  expect(screen.getByText(/Submit this module/i)).toBeDefined();
});
