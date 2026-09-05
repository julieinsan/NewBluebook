import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MoreMenu } from "./MoreMenu";

test("MoreMenu opens and triggers pause action", () => {
  const onPauseAndExit = vi.fn();
  render(<MoreMenu onPauseAndExit={onPauseAndExit} />);

  fireEvent.click(screen.getByRole("button", { name: "More options" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Pause and exit" }));
  expect(onPauseAndExit).toHaveBeenCalled();
});
