import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GridInInput } from "./GridInInput";

test("GridInInput renders and emits changes", () => {
  const onChange = vi.fn();
  render(<GridInInput value="12" onChange={onChange} />);
  const input = screen.getByLabelText("Grid-in answer") as HTMLInputElement;
  expect(input.value).toBe("12");
  fireEvent.change(input, { target: { value: "36" } });
  expect(onChange).toHaveBeenCalledWith("36");
});
