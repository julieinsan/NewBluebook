"use client";

import { useState } from "react";
import type { RunnerQuestion } from "@/lib/testFlow";
import { ReviewGrid } from "./ReviewGrid";

export interface BottomBarProps {
  questions: RunnerQuestion[];
  currentIndex: number;
  onBack?: () => void;
  onNext?: () => void;
  onJumpToQuestion?: (index: number) => void;
  backDisabled?: boolean;
  nextDisabled?: boolean;
  nextLabel?: string;
}

export function BottomBar({
  questions,
  currentIndex,
  onBack,
  onNext,
  onJumpToQuestion,
  backDisabled = false,
  nextDisabled = false,
  nextLabel = "Next",
}: BottomBarProps) {
  const [gridOpen, setGridOpen] = useState(false);
  const current = questions[currentIndex];

  return (
    <footer
      className="shrink-0 border-t border-foreground/10 bg-background px-4 py-3"
      data-testid="bottom-bar"
    >
      {gridOpen && (
        <div className="mb-3 border-b border-foreground/10 pb-3">
          <ReviewGrid
            questions={questions}
            currentIndex={currentIndex}
            onSelectQuestion={(index) => {
              onJumpToQuestion?.(index);
              setGridOpen(false);
            }}
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40"
          onClick={onBack}
          disabled={backDisabled}
        >
          Back
        </button>

        <button
          type="button"
          className="text-sm font-medium underline-offset-2 hover:underline"
          onClick={() => setGridOpen((open) => !open)}
          aria-expanded={gridOpen}
        >
          Question {current?.number ?? currentIndex + 1} of {questions.length}
        </button>

        <button
          type="button"
          className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40"
          onClick={onNext}
          disabled={nextDisabled}
        >
          {nextLabel}
        </button>
      </div>
    </footer>
  );
}
