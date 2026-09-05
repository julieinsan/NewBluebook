import { expect, test, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DeleteAttemptButton } from "./DeleteAttemptButton";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

beforeEach(() => {
  refresh.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }),
  );
});

test("DeleteAttemptButton confirms then deletes and refreshes", async () => {
  render(<DeleteAttemptButton attemptId={8} practiceTest={1} />);

  fireEvent.click(screen.getByRole("button", { name: "Delete Practice Test 1 · Attempt #8" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  await waitFor(() => {
    expect(fetch).toHaveBeenCalledWith("/api/attempts/8", { method: "DELETE" });
    expect(refresh).toHaveBeenCalled();
  });
});
