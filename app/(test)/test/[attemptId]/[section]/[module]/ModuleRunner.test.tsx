import { FIXTURE_QUESTIONS } from "@/app/(test)/_components/fixtures";
import type { RunnerModule } from "@/lib/testFlow";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { ModuleRunner } from "./ModuleRunner";

const postQuestionState = vi.fn();
const postAnswer = vi.fn();
const postEndModule = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../../_lib/clientApi", () => ({
  postQuestionState: (...args: unknown[]) => postQuestionState(...args),
  postAnswer: (...args: unknown[]) => postAnswer(...args),
  postEndModule: (...args: unknown[]) => postEndModule(...args),
  postAnswerKeepalive: vi.fn(),
}));

vi.mock("@/app/(test)/_components/question/HighlightablePassage", () => ({
  HighlightablePassage: ({
    onAddHighlight,
  }: {
    onAddHighlight: (range: { start: number; end: number }) => void;
  }) => (
    <button type="button" onClick={() => onAddHighlight({ start: 0, end: 9 })}>
      Add test highlight
    </button>
  ),
}));

function makeRunnerModule(questions = FIXTURE_QUESTIONS): RunnerModule {
  const now = Date.now();
  return {
    attemptId: 42,
    section: "rw",
    module: 1,
    questions,
    timer: {
      deadline: now + 60 * 60 * 1000,
      serverNow: now,
      durationSeconds: 32 * 60,
    },
  };
}

beforeEach(() => {
  postQuestionState.mockReset();
  postQuestionState.mockResolvedValue({ ok: true });
  postAnswer.mockReset();
  postAnswer.mockResolvedValue({ saved: true, isLate: false });
  postEndModule.mockReset();
});

test("ModuleRunner saves cross-out via postQuestionState with serialized JSON", async () => {
  render(<ModuleRunner runnerModule={makeRunnerModule()} />);

  fireEvent.click(screen.getByRole("button", { name: /Cross out choice B/i }));

  await waitFor(() => {
    expect(postQuestionState).toHaveBeenCalledWith(42, "q-1", {
      section: "rw",
      module: 1,
      crossedOut: '["B"]',
    });
  });
});

test("ModuleRunner does not select a choice after it is crossed out", async () => {
  render(<ModuleRunner runnerModule={makeRunnerModule()} />);

  fireEvent.click(screen.getByRole("button", { name: /Cross out choice A/i }));
  await waitFor(() => expect(postQuestionState).toHaveBeenCalled());

  postAnswer.mockClear();
  fireEvent.click(screen.getByText("First choice"));
  expect(postAnswer).not.toHaveBeenCalled();
});

test("ModuleRunner blocks selecting a choice crossed out on load", () => {
  render(<ModuleRunner runnerModule={makeRunnerModule()} />);

  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  postAnswer.mockClear();
  fireEvent.click(screen.getByText("Beta"));
  expect(postAnswer).not.toHaveBeenCalled();
});

test("ModuleRunner toggling cross-out off clears serialized state", async () => {
  const questions = FIXTURE_QUESTIONS.map((question) =>
    question.id === "q-1" ? { ...question, crossedOutChoices: '["B"]' } : question,
  );

  render(<ModuleRunner runnerModule={makeRunnerModule(questions)} />);

  fireEvent.click(screen.getByRole("button", { name: /Cross out choice B/i }));

  await waitFor(() => {
    expect(postQuestionState).toHaveBeenCalledWith(42, "q-1", {
      section: "rw",
      module: 1,
      crossedOut: null,
    });
  });
});

test("ModuleRunner saves highlight via postQuestionState with serialized JSON", async () => {
  render(<ModuleRunner runnerModule={makeRunnerModule()} />);

  fireEvent.click(screen.getByRole("button", { name: /Add test highlight/i }));

  await waitFor(() => {
    expect(postQuestionState).toHaveBeenCalledWith(42, "q-1", {
      section: "rw",
      module: 1,
      highlights: '[{"start":0,"end":9}]',
    });
  });
});

test("ModuleRunner flushes question time when navigating to the next question", async () => {
  const start = Date.now();
  let now = start;
  vi.spyOn(Date, "now").mockImplementation(() => now);

  render(<ModuleRunner runnerModule={makeRunnerModule()} />);
  now = start + 8000;
  fireEvent.click(screen.getByRole("button", { name: "Next" }));

  await waitFor(() => {
    expect(postQuestionState).toHaveBeenCalledWith(42, "q-1", {
      section: "rw",
      module: 1,
      timeSpentDelta: 8,
    });
  });

  vi.restoreAllMocks();
});
