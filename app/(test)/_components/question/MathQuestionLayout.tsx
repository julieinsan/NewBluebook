"use client";

import type { RunnerQuestion } from "@/lib/testFlow";
import { ChoiceRow } from "../ChoiceRow";
import { GridInInput } from "./GridInInput";
import { MarkdownContent } from "./MarkdownContent";
import { QuestionFigure } from "./QuestionFigure";

export interface MathQuestionLayoutProps {
  question: RunnerQuestion;
  selectedLetter?: string | null;
  gridInValue?: string | null;
  onSelectChoice?: (letter: "A" | "B" | "C" | "D") => void;
  onGridInChange?: (value: string) => void;
  onToggleFlag?: () => void;
  crossedOutLetters?: Set<string>;
  onToggleCrossOut?: (letter: "A" | "B" | "C" | "D") => void;
}

export function MathQuestionLayout({
  question,
  selectedLetter,
  gridInValue,
  onSelectChoice,
  onGridInChange,
  onToggleFlag,
  crossedOutLetters = new Set(),
  onToggleCrossOut,
}: MathQuestionLayoutProps) {
  const isGridIn = question.questionType === "grid_in";

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-y-auto p-6" data-testid="math-layout">
      <MarkdownContent className="text-base leading-relaxed">{question.stimulusText}</MarkdownContent>

      {question.figureAssetPath && <QuestionFigure src={question.figureAssetPath} />}

      {isGridIn ? (
        <GridInInput value={gridInValue ?? question.userAnswer} onChange={onGridInChange} />
      ) : (
        <div className="mt-6 flex flex-col gap-3">
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
      )}
    </div>
  );
}
