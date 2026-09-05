import { expect, test, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ResumeButton } from "./ResumeButton";

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
      json: async () => ({ next: "/test/3/rw/1" }),
    }),
  );
});

test("ResumeButton posts resume then navigates", async () => {
  render(
    <ResumeButton attemptId={3} className="btn">
      Resume test
    </ResumeButton>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Resume test" }));

  await waitFor(() => {
    expect(push).toHaveBeenCalledWith("/test/3/rw/1");
  });
});
