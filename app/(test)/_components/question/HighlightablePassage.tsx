"use client";

import { useCallback, useRef } from "react";
import type { HighlightRange } from "@/lib/highlightState";
import { MarkdownContent } from "./MarkdownContent";

export interface HighlightablePassageProps {
  passage: string;
  highlights: readonly HighlightRange[];
  onAddHighlight: (range: HighlightRange) => void;
  onRemoveHighlight: (range: HighlightRange) => void;
  className?: string;
}

interface PassageSegment {
  start: number;
  end: number;
  highlighted: boolean;
  highlightRange?: HighlightRange;
}

const MARKDOWN_SYNTAX_CHARS = /[*_$\[\]`]/;

function buildSegments(passage: string, highlights: readonly HighlightRange[]): PassageSegment[] {
  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  const segments: PassageSegment[] = [];
  let cursor = 0;

  for (const highlight of sorted) {
    if (highlight.start > cursor) {
      segments.push({ start: cursor, end: highlight.start, highlighted: false });
    }
    if (highlight.end > highlight.start) {
      segments.push({
        start: highlight.start,
        end: highlight.end,
        highlighted: true,
        highlightRange: highlight,
      });
    }
    cursor = Math.max(cursor, highlight.end);
  }

  if (cursor < passage.length) {
    segments.push({ start: cursor, end: passage.length, highlighted: false });
  }

  return segments;
}

/**
 * D5: offsets are UTF-16 code-unit indices into the raw `passage` prop string, not DOM
 * textContent. Saved highlights stay stable across re-renders while the passage string
 * is unchanged; do not derive offsets from rendered markdown output.
 */
function isValidHighlightSelection(passage: string, start: number, end: number): boolean {
  if (start < 0 || end <= start || end > passage.length) {
    return false;
  }

  const slice = passage.slice(start, end);
  return !MARKDOWN_SYNTAX_CHARS.test(slice);
}

function getTextOffsetInRoot(root: Node, node: Node, offset: number): number | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const textNode = current as Text;
    if (textNode === node) {
      return total + offset;
    }
    total += textNode.length;
  }
  return null;
}

function getSegmentElement(node: Node, container: HTMLElement): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== container) {
    if (current instanceof HTMLElement && current.dataset.segmentStart !== undefined) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

/** Maps rendered (visible) character index within a segment to a raw UTF-16 offset. */
function buildRenderedToRawOffsetMap(segmentText: string): number[] {
  const map: number[] = [];
  let i = 0;

  while (i < segmentText.length) {
    const linkMatch = segmentText.slice(i).match(/^\[([^\]]+)\]\([^)]*\)/);
    if (linkMatch) {
      const linkText = linkMatch[1];
      for (let j = 0; j < linkText.length; j++) {
        map.push(i + 1 + j);
      }
      i += linkMatch[0].length;
      continue;
    }

    if (segmentText.startsWith("**", i)) {
      const close = segmentText.indexOf("**", i + 2);
      if (close !== -1) {
        for (let j = i + 2; j < close; j++) {
          map.push(j);
        }
        i = close + 2;
        continue;
      }
    }

    if (segmentText.startsWith("__", i)) {
      const close = segmentText.indexOf("__", i + 2);
      if (close !== -1) {
        for (let j = i + 2; j < close; j++) {
          map.push(j);
        }
        i = close + 2;
        continue;
      }
    }

    if (segmentText[i] === "`") {
      const close = segmentText.indexOf("`", i + 1);
      if (close !== -1) {
        for (let j = i + 1; j < close; j++) {
          map.push(j);
        }
        i = close + 1;
        continue;
      }
    }

    if (segmentText[i] === "$") {
      const close = segmentText.indexOf("$", i + 1);
      if (close !== -1) {
        for (let j = i + 1; j < close; j++) {
          map.push(j);
        }
        i = close + 1;
        continue;
      }
    }

    if (segmentText[i] === "*" || segmentText[i] === "_") {
      const marker = segmentText[i];
      const close = segmentText.indexOf(marker, i + 1);
      if (close !== -1 && close > i + 1) {
        for (let j = i + 1; j < close; j++) {
          map.push(j);
        }
        i = close + 1;
        continue;
      }
    }

    map.push(i);
    i += 1;
  }

  return map;
}

function domOffsetToRawOffset(
  segmentEl: HTMLElement,
  domOffset: number,
  segmentText: string,
): number | null {
  const map = buildRenderedToRawOffsetMap(segmentText);
  if (domOffset < 0 || domOffset > map.length) {
    return null;
  }
  if (domOffset === map.length) {
    return segmentText.length;
  }
  return map[domOffset] ?? null;
}

function resolveSelectionToPassageOffsets(
  container: HTMLElement,
  passage: string,
): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) {
    return null;
  }

  const startSeg = getSegmentElement(range.startContainer, container);
  const endSeg = getSegmentElement(range.endContainer, container);
  if (!startSeg || !endSeg) {
    return null;
  }

  const startSegStart = Number(startSeg.dataset.segmentStart);
  const endSegStart = Number(endSeg.dataset.segmentStart);
  const startSegText = passage.slice(startSegStart, Number(startSeg.dataset.segmentEnd));
  const endSegText = passage.slice(endSegStart, Number(endSeg.dataset.segmentEnd));

  const startDom = getTextOffsetInRoot(startSeg, range.startContainer, range.startOffset);
  const endDom = getTextOffsetInRoot(endSeg, range.endContainer, range.endOffset);
  if (startDom === null || endDom === null) {
    return null;
  }

  const startLocal = domOffsetToRawOffset(startSeg, startDom, startSegText);
  const endLocal = domOffsetToRawOffset(endSeg, endDom, endSegText);
  if (startLocal === null || endLocal === null) {
    return null;
  }

  let start = startSegStart + startLocal;
  let end = endSegStart + endLocal;
  if (start > end) {
    [start, end] = [end, start];
  }

  if (start === end) {
    return null;
  }

  return { start, end };
}

export function HighlightablePassage({
  passage,
  highlights,
  onAddHighlight,
  onRemoveHighlight,
  className,
}: HighlightablePassageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ignoreNextMouseUpRef = useRef(false);

  const handleMarkMouseDown = useCallback(
    (range: HighlightRange) => (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      ignoreNextMouseUpRef.current = true;
      onRemoveHighlight(range);
      window.getSelection()?.removeAllRanges();
    },
    [onRemoveHighlight],
  );

  const handleMouseUp = useCallback(() => {
    if (ignoreNextMouseUpRef.current) {
      ignoreNextMouseUpRef.current = false;
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const offsets = resolveSelectionToPassageOffsets(container, passage);
    if (!offsets) {
      return;
    }

    if (!isValidHighlightSelection(passage, offsets.start, offsets.end)) {
      window.getSelection()?.removeAllRanges();
      return;
    }

    onAddHighlight({ start: offsets.start, end: offsets.end });
    window.getSelection()?.removeAllRanges();
  }, [onAddHighlight, passage]);

  const segments = buildSegments(passage, highlights);

  return (
    <div ref={containerRef} className={className} onMouseUp={handleMouseUp}>
      {segments.map((segment) => {
        const text = passage.slice(segment.start, segment.end);
        const segmentProps = {
          "data-segment-start": segment.start,
          "data-segment-end": segment.end,
        };
        const content = (
          <MarkdownContent className="prose prose-sm max-w-none leading-relaxed [&>div]:inline">
            {text}
          </MarkdownContent>
        );

        if (segment.highlighted && segment.highlightRange) {
          return (
            <mark
              key={`${segment.start}-${segment.end}`}
              className="bg-[#FFEB3B]"
              {...segmentProps}
              onMouseDown={handleMarkMouseDown(segment.highlightRange)}
            >
              {content}
            </mark>
          );
        }

        return (
          <span key={`${segment.start}-${segment.end}`} {...segmentProps}>
            {content}
          </span>
        );
      })}
    </div>
  );
}
