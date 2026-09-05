"use client";

import { BottomBar } from "@/app/(test)/_components/BottomBar";
import { TopBar } from "@/app/(test)/_components/TopBar";
import { QuestionRenderer } from "@/app/(test)/_components/question/QuestionRenderer";
import { reviewPath, secondsRemaining, type RunnerModule, type RunnerQuestion } from "@/lib/testFlow";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { postEndModule, postQuestionState } from "../../_lib/clientApi";
import { useAutosave } from "../../_lib/useAutosave";
import { useQuestionStateSave } from "../../_lib/useQuestionStateSave";
import { parseCrossedOutChoices, serializeCrossedOutChoices, toggleCrossedOut } from "@/lib/choiceState";
import {
  mergeHighlight,
  parseHighlights,
  serializeHighlights,
  type HighlightRange,
} from "@/lib/highlightState";

export interface ModuleRunnerProps {
  runnerModule: RunnerModule;
}

export function ModuleRunner({ runnerModule }: ModuleRunnerProps) {
  const router = useRouter();
  const { attemptId, section, module, timer } = runnerModule;

  const [questions, setQuestions] = useState<RunnerQuestion[]>(runnerModule.questions);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timerVisible, setTimerVisible] = useState(true);
  const [expired, setExpired] = useState(false);

  const submittingRef = useRef(false);
  const { queueSave, flushAll: flushAnswers } = useAutosave(attemptId, section, module);
  const { saveQuestionState, flushAll: flushQuestionState } = useQuestionStateSave(
    attemptId,
    section,
    module,
  );

  const flushAll = useCallback(async () => {
    await flushAnswers();
    await flushQuestionState();
  }, [flushAnswers, flushQuestionState]);

  const currentQuestion = questions[currentIndex];
  const isLastQuestion = currentIndex === questions.length - 1;

  const updateQuestion = useCallback((questionId: string, patch: Partial<RunnerQuestion>) => {
    setQuestions((prev) =>
      prev.map((question) => (question.id === questionId ? { ...question, ...patch } : question)),
    );
  }, []);

  const handleSelectChoice = useCallback(
    (letter: "A" | "B" | "C" | "D") => {
      if (expired || !currentQuestion) return;
      const crossedOut = parseCrossedOutChoices(currentQuestion.crossedOutChoices);
      if (crossedOut.includes(letter)) return;
      updateQuestion(currentQuestion.id, { userAnswer: letter });
      queueSave(currentQuestion.id, letter);
    },
    [currentQuestion, expired, queueSave, updateQuestion],
  );

  const handleGridInChange = useCallback(
    (value: string) => {
      if (expired || !currentQuestion) return;
      const answer = value.trim() === "" ? null : value;
      updateQuestion(currentQuestion.id, { userAnswer: answer });
      queueSave(currentQuestion.id, answer);
    },
    [currentQuestion, expired, queueSave, updateQuestion],
  );

  const handleToggleFlag = useCallback(async () => {
    if (expired || !currentQuestion) return;
    const nextFlagged = !currentQuestion.flagged;
    const previousFlagged = currentQuestion.flagged;
    updateQuestion(currentQuestion.id, { flagged: nextFlagged });
    try {
      await postQuestionState(attemptId, currentQuestion.id, {
        section,
        module,
        flagged: nextFlagged,
      });
    } catch (err) {
      console.error("Failed to save flag:", err);
      updateQuestion(currentQuestion.id, { flagged: previousFlagged });
    }
  }, [attemptId, currentQuestion, expired, module, section, updateQuestion]);

  const handleToggleCrossOut = useCallback(
    async (letter: "A" | "B" | "C" | "D") => {
      if (expired || !currentQuestion) return;
      const previous = currentQuestion.crossedOutChoices;
      const nextLetters = toggleCrossedOut(parseCrossedOutChoices(previous), letter);
      const serialized = serializeCrossedOutChoices(nextLetters);
      updateQuestion(currentQuestion.id, { crossedOutChoices: serialized });
      try {
        await saveQuestionState(currentQuestion.id, { crossedOut: serialized });
      } catch (err) {
        console.error("Failed to save cross-out:", err);
        updateQuestion(currentQuestion.id, { crossedOutChoices: previous });
      }
    },
    [currentQuestion, expired, saveQuestionState, updateQuestion],
  );

  const handleAddHighlight = useCallback(
    async (range: HighlightRange) => {
      if (expired || !currentQuestion) return;
      const previous = currentQuestion.highlights;
      const nextHighlights = mergeHighlight(parseHighlights(previous), range);
      const serialized = serializeHighlights(nextHighlights);
      updateQuestion(currentQuestion.id, { highlights: serialized });
      try {
        await saveQuestionState(currentQuestion.id, { highlights: serialized });
      } catch (err) {
        console.error("Failed to save highlight:", err);
        updateQuestion(currentQuestion.id, { highlights: previous });
      }
    },
    [currentQuestion, expired, saveQuestionState, updateQuestion],
  );

  const handleRemoveHighlight = useCallback(
    async (range: HighlightRange) => {
      if (expired || !currentQuestion) return;
      const previous = currentQuestion.highlights;
      const nextHighlights = parseHighlights(previous).filter(
        (existing) => existing.start !== range.start || existing.end !== range.end,
      );
      const serialized = serializeHighlights(nextHighlights);
      updateQuestion(currentQuestion.id, { highlights: serialized });
      try {
        await saveQuestionState(currentQuestion.id, { highlights: serialized });
      } catch (err) {
        console.error("Failed to save highlight removal:", err);
        updateQuestion(currentQuestion.id, { highlights: previous });
      }
    },
    [currentQuestion, expired, saveQuestionState, updateQuestion],
  );

  const goToReview = useCallback(async () => {
    await flushAll();
    router.push(reviewPath(attemptId));
  }, [attemptId, flushAll, router]);

  const handleBack = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((index) => index - 1);
    }
  }, [currentIndex]);

  const handleNext = useCallback(() => {
    if (isLastQuestion) {
      void goToReview();
      return;
    }
    setCurrentIndex((index) => index + 1);
  }, [goToReview, isLastQuestion]);

  const handleAutoSubmit = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setExpired(true);

    try {
      await flushAll();
      const { next } = await postEndModule(attemptId, { section, module });
      router.push(next);
    } catch (err) {
      console.error("Failed to auto-submit module:", err);
      submittingRef.current = false;
      setExpired(false);
    }
  }, [attemptId, flushAll, module, router, section]);

  useEffect(() => {
    if (timer.paused) return;
    const offset = Date.now() - timer.serverNow;
    const tick = () => {
      const remaining = secondsRemaining(timer.deadline, Date.now() - offset);
      if (remaining === 0 && !submittingRef.current) {
        void handleAutoSubmit();
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [handleAutoSubmit, timer.deadline, timer.paused, timer.serverNow]);

  const selectedLetter =
    currentQuestion?.questionType === "mc" ? (currentQuestion.userAnswer as "A" | "B" | "C" | "D" | null) : null;

  const crossedOutLetters = currentQuestion
    ? new Set(parseCrossedOutChoices(currentQuestion.crossedOutChoices))
    : undefined;

  const highlights = currentQuestion ? parseHighlights(currentQuestion.highlights) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="module-runner">
      <TopBar
        section={section}
        module={module}
        timer={timer}
        attemptId={attemptId}
        timerVisible={timerVisible}
        onTimerVisibilityChange={setTimerVisible}
      />

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {currentQuestion && (
          <QuestionRenderer
            section={section}
            question={currentQuestion}
            selectedLetter={selectedLetter}
            gridInValue={currentQuestion.userAnswer}
            onSelectChoice={handleSelectChoice}
            onGridInChange={handleGridInChange}
            onToggleFlag={handleToggleFlag}
            crossedOutLetters={crossedOutLetters}
            onToggleCrossOut={handleToggleCrossOut}
            highlights={section === "rw" ? highlights : undefined}
            onAddHighlight={section === "rw" ? handleAddHighlight : undefined}
            onRemoveHighlight={section === "rw" ? handleRemoveHighlight : undefined}
          />
        )}
      </main>

      <BottomBar
        questions={questions}
        currentIndex={currentIndex}
        onBack={handleBack}
        onNext={handleNext}
        onJumpToQuestion={setCurrentIndex}
        backDisabled={currentIndex === 0 || expired}
        nextDisabled={expired}
        nextLabel={isLastQuestion ? "Review" : "Next"}
      />
    </div>
  );
}
