import { expect, test, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BreakScreen } from "./BreakScreen";

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
      json: async () => ({ next: "/test/1/math/1" }),
    }),
  );
});

test("BreakScreen calls end-break on resume", async () => {
  render(
    <BreakScreen attemptId={1} breakStartedAt="2026-09-05 14:00:00" />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Resume testing/i }));

  await waitFor(() => {
    expect(push).toHaveBeenCalledWith("/test/1/math/1");
  });
});
