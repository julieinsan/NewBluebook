import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuestionFigure } from "./QuestionFigure";

test("QuestionFigure renders an image", () => {
  render(<QuestionFigure src="/figures/example.png" alt="Triangle diagram" />);
  const img = screen.getByRole("img", { name: "Triangle diagram" }) as HTMLImageElement;
  expect(img.src).toContain("/figures/example.png");
});
