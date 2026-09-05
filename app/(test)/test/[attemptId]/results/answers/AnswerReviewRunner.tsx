"use client";

import type { ReviewQuestion } from "@/lib/resultsContract";
import { resultsPath } from "@/lib/testFlow";
import Link from "next/link";
import { useState } from "react";
import { AnswerReviewCard } from "./AnswerReviewCard";

export interface AnswerReviewRunnerProps {
  attemptId: number;
  questions: ReviewQuestion[];
}

export function AnswerReviewRunner({ attemptId, questions }: AnswerReviewRunnerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentQuestion = questions[currentIndex];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === questions.length - 1;

  if (!currentQuestion) {
    return null;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="answer-review-runner">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <AnswerReviewCard question={currentQuestion} />
      </div>

      <footer className="shrink-0 border-t border-foreground/10 bg-background px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40"
            onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
            disabled={isFirst}
          >
            Back
          </button>

          <p className="text-sm font-medium">
            Question {currentQuestion.number} of {questions.length}
          </p>

          {isLast ? (
            <Link
              href={resultsPath(attemptId)}
              className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-foreground"
            >
              Done
            </Link>
          ) : (
            <button
              type="button"
              className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-foreground"
              onClick={() => setCurrentIndex((index) => Math.min(questions.length - 1, index + 1))}
            >
              Next
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
