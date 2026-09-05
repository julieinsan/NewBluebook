"use client";

import type { RunnerQuestion } from "@/lib/testFlow";
import type { HighlightRange } from "@/lib/highlightState";
import { ChoiceRow } from "../ChoiceRow";
import { HighlightablePassage } from "./HighlightablePassage";
import { MarkdownContent } from "./MarkdownContent";

export interface RwQuestionLayoutProps {
  passage: string;
  question: RunnerQuestion;
  questionStem?: string;
  selectedLetter?: string | null;
  onSelectChoice?: (letter: "A" | "B" | "C" | "D") => void;
  onToggleFlag?: () => void;
  crossedOutLetters?: Set<string>;
  onToggleCrossOut?: (letter: "A" | "B" | "C" | "D") => void;
  highlights?: HighlightRange[];
  onAddHighlight?: (range: HighlightRange) => void;
  onRemoveHighlight?: (range: HighlightRange) => void;
}

export function RwQuestionLayout({
  passage,
  question,
  questionStem,
  selectedLetter,
  onSelectChoice,
  onToggleFlag,
  crossedOutLetters = new Set(),
  onToggleCrossOut,
  highlights = [],
  onAddHighlight,
  onRemoveHighlight,
}: RwQuestionLayoutProps) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 md:grid-cols-2" data-testid="rw-layout">
      <section
        className="overflow-y-auto border-b border-foreground/10 p-6 md:border-b-0 md:border-r"
        aria-label="Passage"
      >
        <HighlightablePassage
          passage={passage}
          highlights={highlights}
          onAddHighlight={onAddHighlight ?? (() => {})}
          onRemoveHighlight={onRemoveHighlight ?? (() => {})}
          className="prose prose-sm max-w-none leading-relaxed"
        />
      </section>

      <section className="overflow-y-auto p-6" aria-label="Question">
        <MarkdownContent className="mb-6 text-sm leading-relaxed">
          {questionStem ?? question.stimulusText}
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
