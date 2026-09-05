"use client";

import type { Section } from "@/lib/blueprint";
import type { HighlightRange } from "@/lib/highlightState";
import type { RunnerQuestion } from "@/lib/testFlow";
import { MathQuestionLayout } from "./MathQuestionLayout";
import { RwQuestionLayout } from "./RwQuestionLayout";
import { splitRwStimulus } from "./splitRwStimulus";

export interface QuestionRendererProps {
  section: Section;
  question: RunnerQuestion;
  passageText?: string;
  selectedLetter?: string | null;
  gridInValue?: string | null;
  onSelectChoice?: (letter: "A" | "B" | "C" | "D") => void;
  onGridInChange?: (value: string) => void;
  onToggleFlag?: () => void;
  crossedOutLetters?: Set<string>;
  onToggleCrossOut?: (letter: "A" | "B" | "C" | "D") => void;
  highlights?: HighlightRange[];
  onAddHighlight?: (range: HighlightRange) => void;
  onRemoveHighlight?: (range: HighlightRange) => void;
}

export function QuestionRenderer({
  section,
  question,
  passageText,
  selectedLetter,
  gridInValue,
  onSelectChoice,
  onGridInChange,
  onToggleFlag,
  crossedOutLetters,
  onToggleCrossOut,
  highlights,
  onAddHighlight,
  onRemoveHighlight,
}: QuestionRendererProps) {
  if (section === "rw") {
    const split = passageText
      ? { passage: passageText, questionStem: question.stimulusText }
      : splitRwStimulus(question.stimulusText);

    return (
      <RwQuestionLayout
        passage={split.passage}
        questionStem={split.questionStem}
        question={question}
        selectedLetter={selectedLetter}
        onSelectChoice={onSelectChoice}
        onToggleFlag={onToggleFlag}
        crossedOutLetters={crossedOutLetters}
        onToggleCrossOut={onToggleCrossOut}
        highlights={highlights}
        onAddHighlight={onAddHighlight}
        onRemoveHighlight={onRemoveHighlight}
      />
    );
  }

  return (
    <MathQuestionLayout
      question={question}
      selectedLetter={selectedLetter}
      gridInValue={gridInValue}
      onSelectChoice={onSelectChoice}
      onGridInChange={onGridInChange}
      onToggleFlag={onToggleFlag}
      crossedOutLetters={crossedOutLetters}
      onToggleCrossOut={onToggleCrossOut}
    />
  );
}
