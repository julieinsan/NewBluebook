import type { ModuleNumber, Section } from "@/lib/blueprint";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useQuestionTimeTracker } from "./useQuestionTimeTracker";

const postQuestionState = vi.fn();
const postQuestionStateKeepalive = vi.fn();

vi.mock("./clientApi", () => ({
  postQuestionState: (...args: unknown[]) => postQuestionState(...args),
  postQuestionStateKeepalive: (...args: unknown[]) => postQuestionStateKeepalive(...args),
}));

const ATTEMPT_ID = 7;
const SECTION: Section = "rw";
const MODULE: ModuleNumber = 1;

function renderTracker(
  activeQuestionId: string | undefined,
  paused = false,
  disabled = false,
) {
  return renderHook(
    ({ questionId, isPaused, isDisabled }) =>
      useQuestionTimeTracker(ATTEMPT_ID, SECTION, MODULE, questionId, isPaused, isDisabled),
    {
      initialProps: {
        questionId: activeQuestionId,
        isPaused: paused,
        isDisabled: disabled,
      },
    },
  );
}

beforeEach(() => {
  postQuestionState.mockReset();
  postQuestionState.mockResolvedValue({ ok: true });
  postQuestionStateKeepalive.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useQuestionTimeTracker", () => {
  test("flushes elapsed seconds when the active question changes", async () => {
    const { result, rerender } = renderTracker("q-1");

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    rerender({ questionId: "q-2", isPaused: false, isDisabled: false });

    await waitFor(() => {
      expect(postQuestionState).toHaveBeenCalledWith(ATTEMPT_ID, "q-1", {
        section: SECTION,
        module: MODULE,
        timeSpentDelta: 5,
      });
    });

    await act(async () => {
      await result.current.flushAll();
    });
  });

  test("does not accrue time while paused", async () => {
    const { rerender } = renderTracker("q-1");

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    rerender({ questionId: "q-1", isPaused: true, isDisabled: false });

    await act(async () => {
      vi.advanceTimersByTime(4000);
      rerender({ questionId: "q-2", isPaused: true, isDisabled: false });
    });

    await waitFor(() => {
      expect(postQuestionState).toHaveBeenCalledWith(ATTEMPT_ID, "q-1", {
        section: SECTION,
        module: MODULE,
        timeSpentDelta: 3,
      });
    });
  });

  test("flushAll sends pending time for the active question", async () => {
    const { result } = renderTracker("q-1");

    await act(async () => {
      vi.advanceTimersByTime(12_000);
      await result.current.flushAll();
    });

    expect(postQuestionState).toHaveBeenCalledWith(ATTEMPT_ID, "q-1", {
      section: SECTION,
      module: MODULE,
      timeSpentDelta: 12,
    });
  });
});
