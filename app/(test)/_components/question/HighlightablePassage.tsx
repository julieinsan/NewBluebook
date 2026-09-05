"use client";

import type { HighlightRange } from "@/lib/highlightState";
import { MarkdownContent } from "./MarkdownContent";

export interface HighlightablePassageProps {
  passage: string;
  highlights: readonly HighlightRange[];
  onAddHighlight: (range: HighlightRange) => void;
  onRemoveHighlight: (range: HighlightRange) => void;
  className?: string;
}

/** Minimal stub — full highlight UI lands on parallel branch. */
export function HighlightablePassage({ passage, className }: HighlightablePassageProps) {
  return (
    <div data-testid="highlightable-passage">
      <MarkdownContent className={className}>{passage}</MarkdownContent>
    </div>
  );
}
