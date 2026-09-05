import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConfirmDialog } from "./ConfirmDialog";

test("ConfirmDialog renders when open and handles actions", () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      open
      title="Submit module?"
      message="You cannot return after submitting."
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  expect(screen.getByRole("dialog")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onConfirm).toHaveBeenCalled();
  expect(onCancel).toHaveBeenCalled();
});

test("ConfirmDialog renders nothing when closed", () => {
  render(<ConfirmDialog open={false} title="Hidden" message="Nope" />);
  expect(screen.queryByRole("dialog")).toBeNull();
});
