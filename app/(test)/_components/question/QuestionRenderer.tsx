"use client";

import type { Section } from "@/lib/blueprint";
import type { RunnerQuestion } from "@/lib/testFlow";
import { MathQuestionLayout } from "./MathQuestionLayout";
import { RwQuestionLayout } from "./RwQuestionLayout";

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
}: QuestionRendererProps) {
  if (section === "rw") {
    return (
      <RwQuestionLayout
        passage={passageText ?? question.stimulusText}
        question={question}
        selectedLetter={selectedLetter}
        onSelectChoice={onSelectChoice}
        onToggleFlag={onToggleFlag}
        crossedOutLetters={crossedOutLetters}
        onToggleCrossOut={onToggleCrossOut}
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
