import { expect, test, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HighlightablePassage } from "./HighlightablePassage";

afterEach(() => {
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
});

function selectDomTextOffsets(container: HTMLElement, start: number, end: number) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let total = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const length = node.length;

    if (!startNode && total + length >= start) {
      startNode = node;
      startOffset = start - total;
    }
    if (total + length >= end) {
      endNode = node;
      endOffset = end - total;
      break;
    }

    total += length;
  }

  if (!startNode || !endNode) {
    throw new Error(`Could not select DOM offsets ${start}-${end}`);
  }

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);

  const selection = {
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => range,
    removeAllRanges: vi.fn(),
  };

  vi.spyOn(window, "getSelection").mockReturnValue(selection as Selection);
  return selection;
}

test("segment splitting renders highlighted spans inside mark elements", () => {
  render(
    <HighlightablePassage
      passage="Hello world"
      highlights={[{ start: 0, end: 5 }]}
      onAddHighlight={vi.fn()}
      onRemoveHighlight={vi.fn()}
    />,
  );

  const mark = document.querySelector("mark.bg-\\[\\#FFEB3B\\]");
  expect(mark).toBeTruthy();
  expect(mark?.textContent).toBe("Hello");
  expect(screen.getByText("world")).toBeDefined();
});

test("onAddHighlight is called with UTF-16 offsets when text is selected", () => {
  const onAddHighlight = vi.fn();
  const { container } = render(
    <HighlightablePassage
      passage="Hello world"
      highlights={[]}
      onAddHighlight={onAddHighlight}
      onRemoveHighlight={vi.fn()}
    />,
  );

  const passageRoot = container.firstElementChild as HTMLElement;
  selectDomTextOffsets(passageRoot, 0, 5);
  fireEvent.mouseUp(passageRoot);

  expect(onAddHighlight).toHaveBeenCalledOnce();
  expect(onAddHighlight).toHaveBeenCalledWith({ start: 0, end: 5 });
});

test("invalid markdown-crossing selection does not call onAddHighlight", () => {
  const onAddHighlight = vi.fn();
  const passage = "plain *italic* more";
  const { container } = render(
    <HighlightablePassage
      passage={passage}
      highlights={[]}
      onAddHighlight={onAddHighlight}
      onRemoveHighlight={vi.fn()}
    />,
  );

  // DOM text is "plain italic more" — selecting across the italic boundary maps to raw
  // text that includes markdown syntax characters.
  const passageRoot = container.firstElementChild as HTMLElement;
  selectDomTextOffsets(passageRoot, 4, 11);
  fireEvent.mouseUp(passageRoot);

  expect(onAddHighlight).not.toHaveBeenCalled();
});

test("clicking a mark calls onRemoveHighlight with that highlight range", () => {
  const onRemoveHighlight = vi.fn();
  const highlight = { start: 6, end: 11 };
  render(
    <HighlightablePassage
      passage="Hello world"
      highlights={[highlight]}
      onAddHighlight={vi.fn()}
      onRemoveHighlight={onRemoveHighlight}
    />,
  );

  const mark = document.querySelector("mark");
  expect(mark).toBeTruthy();
  fireEvent.mouseDown(mark!);
  fireEvent.mouseUp(mark!);

  expect(onRemoveHighlight).toHaveBeenCalledOnce();
  expect(onRemoveHighlight).toHaveBeenCalledWith(highlight);
});
