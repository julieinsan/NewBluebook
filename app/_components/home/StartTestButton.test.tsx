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
      json: async () => ({ attemptId: 1, practiceTest: 1, next: "/test/1/rw/1" }),
    }),
  );
});

test("StartTestButton posts practiceTest=1 and navigates", async () => {
  render(<StartTestButton />);
  fireEvent.click(screen.getByRole("button", { name: /Practice Test 1/i }));

  await waitFor(() => {
    expect(push).toHaveBeenCalledWith("/test/1/rw/1");
  });

  expect(fetch).toHaveBeenCalledWith("/api/attempts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ practiceTest: 1 }),
  });
});

test("StartTestButton posts practiceTest=2 when second button clicked", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ attemptId: 2, practiceTest: 2, next: "/test/2/rw/1" }),
    }),
  );

  render(<StartTestButton />);
  fireEvent.click(screen.getByRole("button", { name: /Practice Test 2/i }));

  await waitFor(() => {
    expect(push).toHaveBeenCalledWith("/test/2/rw/1");
  });

  expect(fetch).toHaveBeenCalledWith("/api/attempts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ practiceTest: 2 }),
  });
});

test("StartTestButton stays enabled regardless of in-progress attempts", () => {
  render(<StartTestButton />);
  expect(screen.getByRole("button", { name: /Practice Test 1/i }).hasAttribute("disabled")).toBe(
    false,
  );
  expect(screen.getByRole("button", { name: /Practice Test 2/i }).hasAttribute("disabled")).toBe(
    false,
  );
});
