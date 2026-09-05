import type { RunnerQuestion } from "@/lib/testFlow";

export interface ReviewGridProps {
  questions: RunnerQuestion[];
  currentIndex: number;
  onSelectQuestion?: (index: number) => void;
}

type BubbleState = "current" | "answered" | "flagged" | "unanswered";

function bubbleState(question: RunnerQuestion, index: number, currentIndex: number): BubbleState {
  if (index === currentIndex) return "current";
  if (question.flagged) return "flagged";
  if (question.userAnswer != null && question.userAnswer !== "") return "answered";
  return "unanswered";
}

const STATE_CLASSES: Record<BubbleState, string> = {
  current: "border-accent bg-accent text-accent-foreground",
  answered: "border-foreground/30 bg-foreground/5",
  flagged: "border-foreground/30 bg-background",
  unanswered: "border-foreground/20 bg-background text-foreground/60",
};

export function ReviewGrid({ questions, currentIndex, onSelectQuestion }: ReviewGridProps) {
  return (
    <div className="flex flex-wrap gap-2" role="list" aria-label="Question review grid">
      {questions.map((question, index) => {
        const state = bubbleState(question, index, currentIndex);
        return (
          <button
            key={question.id}
            type="button"
            role="listitem"
            className={`relative inline-flex h-9 w-9 items-center justify-center rounded-full border text-sm font-medium ${STATE_CLASSES[state]}`}
            aria-current={index === currentIndex ? "true" : undefined}
            aria-label={`Question ${question.number}, ${question.id}${question.flagged ? ", flagged" : ""}${question.userAnswer ? ", answered" : ", unanswered"}`}
            title={question.id}
            onClick={() => onSelectQuestion?.(index)}
          >
            {question.number}
            {question.flagged && (
              <span
                className="absolute -right-0.5 -top-0.5 text-[10px] leading-none"
                aria-hidden
              >
                ⚑
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
