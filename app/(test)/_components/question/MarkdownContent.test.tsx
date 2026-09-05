import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownContent } from "./MarkdownContent";

test("MarkdownContent renders markdown and inline math", () => {
  render(<MarkdownContent>Let $x = 2$ and **bold** text.</MarkdownContent>);
  expect(screen.getByText("bold")).toBeDefined();
  expect(document.querySelector(".katex")).toBeTruthy();
});
