"use client";

import type { RunnerQuestion } from "@/lib/testFlow";
import { ChoiceRow } from "../ChoiceRow";
import { MarkdownContent } from "./MarkdownContent";

export interface RwQuestionLayoutProps {
  passage: string;
  question: RunnerQuestion;
  selectedLetter?: string | null;
  onSelectChoice?: (letter: "A" | "B" | "C" | "D") => void;
  onToggleFlag?: () => void;
  crossedOutLetters?: Set<string>;
  onToggleCrossOut?: (letter: "A" | "B" | "C" | "D") => void;
}

export function RwQuestionLayout({
  passage,
  question,
  selectedLetter,
  onSelectChoice,
  onToggleFlag,
  crossedOutLetters = new Set(),
  onToggleCrossOut,
}: RwQuestionLayoutProps) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 md:grid-cols-2" data-testid="rw-layout">
      <section
        className="overflow-y-auto border-b border-foreground/10 p-6 md:border-b-0 md:border-r"
        aria-label="Passage"
      >
        <MarkdownContent className="prose prose-sm max-w-none leading-relaxed">
          {passage}
        </MarkdownContent>
      </section>

      <section className="overflow-y-auto p-6" aria-label="Question">
        <MarkdownContent className="mb-6 text-sm leading-relaxed">
          {question.stimulusText}
        </MarkdownContent>
        <div className="flex flex-col gap-3">
          {question.choices.map((choice) => (
            <ChoiceRow
              key={choice.letter}
              letter={choice.letter}
              text={choice.text}
              selected={selectedLetter === choice.letter}
              flagged={question.flagged}
              crossedOut={crossedOutLetters.has(choice.letter)}
              onSelect={() => onSelectChoice?.(choice.letter)}
              onToggleFlag={onToggleFlag}
              onToggleCrossOut={() => onToggleCrossOut?.(choice.letter)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
