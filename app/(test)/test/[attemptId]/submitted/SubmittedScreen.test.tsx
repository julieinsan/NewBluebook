import { expect, test, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { SubmittedScreen } from "./SubmittedScreen";

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
      json: async () => ({ ok: true }),
    }),
  );
});

test("SubmittedScreen posts submit on mount", async () => {
  render(<SubmittedScreen attemptId={42} />);

  await waitFor(() => {
    expect(fetch).toHaveBeenCalledWith("/api/attempts/42/submit", expect.any(Object));
  });
});

test("SubmittedScreen navigates to results after successful submit", async () => {
  render(<SubmittedScreen attemptId={42} />);

  await waitFor(() => {
    expect(push).toHaveBeenCalledWith("/test/42/results");
  });
});
