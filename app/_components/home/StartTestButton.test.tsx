import { expect, test, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StartTestButton } from "./StartTestButton";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

beforeEach(() => {
  push.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ attemptId: 1, reused: false, next: "/test/1/rw/1" }),
    }),
  );
});

test("StartTestButton posts to start endpoint and navigates", async () => {
  render(<StartTestButton hasResumableAttempt={false} />);
  fireEvent.click(screen.getByRole("button", { name: /Start new test/i }));

  await waitFor(() => {
    expect(push).toHaveBeenCalledWith("/test/1/rw/1");
  });
});

test("StartTestButton is disabled when a resumable attempt exists", () => {
  render(<StartTestButton hasResumableAttempt />);
  expect(screen.getByRole("button", { name: /Start new test/i }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByText(/test in progress/i)).toBeDefined();
});
