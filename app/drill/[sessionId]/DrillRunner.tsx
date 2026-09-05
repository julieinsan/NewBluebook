"use client";

import { ChoiceRow } from "@/app/(test)/_components/ChoiceRow";
import { MarkdownContent } from "@/app/(test)/_components/question/MarkdownContent";
import { QuestionFigure } from "@/app/(test)/_components/question/QuestionFigure";
import { GridInInput } from "@/app/(test)/_components/question/GridInInput";
import { splitRwStimulus } from "@/app/(test)/_components/question/splitRwStimulus";
import type { DrillQuestion, DrillRunnerState } from "@/lib/drillContract";
import { formatDuration } from "@/lib/formatDuration";
import { drillSummaryPath } from "@/lib/drillFlow";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { postDrillAnswer, postDrillNext } from "../_lib/clientApi";
import { useDrillTimeTracker } from "../_lib/useDrillTimeTracker";

export interface DrillRunnerProps {
  initialState: DrillRunnerState;
}

function filterLabel(state: DrillRunnerState): string {
  const parts = [state.filters.domain];
  if (state.filters.skill) parts.push(state.filters.skill);
  if (state.filters.difficulty !== "any") parts.push(state.filters.difficulty);
  return parts.join(" · ");
}

function AnsweringView({
  question,
  userAnswer,
  onSelectChoice,
  onGridInChange,
}: {
  question: DrillQuestion;
  userAnswer: string | null;
  onSelectChoice: (letter: "A" | "B" | "C" | "D") => void;
  onGridInChange: (value: string) => void;
}) {
  const isMc = question.questionType === "mc";
  const rwLayout =
    question.section === "rw" ? splitRwStimulus(question.stimulusText) : null;

  const choices = (
    <div className="flex flex-col gap-3">
      {isMc ? (
        question.choices.map((choice) => (
          <ChoiceRow
            key={choice.letter}
            letter={choice.letter}
            text={choice.text}
            selected={userAnswer === choice.letter}
            onSelect={() => onSelectChoice(choice.letter)}
            onToggleFlag={() => {}}
            onToggleCrossOut={() => {}}
          />
        ))
      ) : (
        <GridInInput value={userAnswer} onChange={onGridInChange} />
      )}
    </div>
  );

  if (rwLayout) {
    return (
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 md:grid-cols-2">
        <section className="overflow-y-auto border-b border-foreground/10 p-6 md:border-b-0 md:border-r">
          <MarkdownContent className="prose prose-sm max-w-none leading-relaxed">
            {rwLayout.passage}
          </MarkdownContent>
        </section>
        <section className="overflow-y-auto p-6">
          <MarkdownContent className="mb-6 text-sm leading-relaxed">{rwLayout.questionStem}</MarkdownContent>
          {question.figureAssetPath && <QuestionFigure src={question.figureAssetPath} />}
          {choices}
        </section>
      </div>
    );
  }

  return (
    <section className="overflow-y-auto p-6">
      <MarkdownContent className="mb-6 text-sm leading-relaxed">{question.stimulusText}</MarkdownContent>
      {question.figureAssetPath && <QuestionFigure src={question.figureAssetPath} />}
      {choices}
    </section>
  );
}

export function DrillRunner({ initialState }: DrillRunnerProps) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [userAnswer, setUserAnswer] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeQuestionId = state.question?.id;
  const trackingDisabled = state.feedback != null || activeQuestionId == null;
  const { flushAll } = useDrillTimeTracker(state.sessionId, activeQuestionId, trackingDisabled);

  const handleCheckAnswer = useCallback(async () => {
    if (!state.question || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await flushAll();
      const answer =
        state.question.questionType === "grid_in"
          ? userAnswer?.trim() === ""
            ? null
            : userAnswer
          : userAnswer;
      const { state: nextState } = await postDrillAnswer(
        state.sessionId,
        state.question.id,
        answer,
      );
      setState(nextState);
      setUserAnswer(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check answer");
    } finally {
      setSubmitting(false);
    }
  }, [flushAll, state.question, state.sessionId, submitting, userAnswer]);

  const handleNext = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { state: nextState } = await postDrillNext(state.sessionId);
      setState(nextState);
      setUserAnswer(null);
      if (!nextState.question && !nextState.canLoadMore) {
        router.push(drillSummaryPath(state.sessionId));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load next question");
    } finally {
      setSubmitting(false);
    }
  }, [router, state.sessionId, submitting]);

  const endSession = (
    <Link
      href={drillSummaryPath(state.sessionId)}
      className="text-sm font-medium text-accent hover:underline"
    >
      End session
    </Link>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="drill-runner">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-foreground/10 px-6 py-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/60">Drill mode</p>
          <p className="text-sm text-foreground/80">{filterLabel(state)}</p>
        </div>
        <div className="text-right text-sm text-foreground/70">
          <p>
            {state.stats.correct}/{state.stats.answered} correct
          </p>
          {endSession}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {state.question ? (
          <AnsweringView
            question={state.question}
            userAnswer={userAnswer}
            onSelectChoice={(letter) => setUserAnswer(letter)}
            onGridInChange={setUserAnswer}
          />
        ) : state.feedback ? (
          <section className="overflow-y-auto p-6" data-testid="drill-feedback">
            <p
              className={`text-sm font-medium ${
                state.feedback.isCorrect
                  ? "text-green-700 dark:text-green-400"
                  : "text-red-700 dark:text-red-400"
              }`}
            >
              {state.feedback.isCorrect ? "Correct" : "Incorrect"}
            </p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-foreground/60">
                  Your answer
                </dt>
                <dd className="mt-1">{state.feedback.userAnswer ?? "No answer"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-foreground/60">
                  Correct answer
                </dt>
                <dd className="mt-1">{state.feedback.correctAnswer}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-foreground/60">
              Time spent: {formatDuration(state.feedback.timeSpentSeconds)}
            </p>
            {state.feedback.rationale && (
              <div className="mt-4 rounded-md border border-foreground/10 bg-foreground/[0.02] p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-foreground/60">
                  Rationale
                </p>
                <MarkdownContent className="mt-2 text-sm leading-relaxed">
                  {state.feedback.rationale}
                </MarkdownContent>
              </div>
            )}
          </section>
        ) : (
          <section className="flex flex-1 items-center justify-center p-6 text-sm text-foreground/70">
            No more questions match your filters.
          </section>
        )}
      </div>

      <footer className="shrink-0 border-t border-foreground/10 bg-background px-4 py-3">
        {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="text-sm text-foreground/70 hover:underline">
            Home
          </Link>
          {state.question ? (
            <button
              type="button"
              className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40"
              disabled={submitting || (state.question.questionType === "mc" && userAnswer == null)}
              onClick={() => void handleCheckAnswer()}
            >
              {submitting ? "Checking…" : "Check answer"}
            </button>
          ) : state.feedback ? (
            state.canLoadMore ? (
              <button
                type="button"
                className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40"
                disabled={submitting}
                onClick={() => void handleNext()}
              >
                {submitting ? "Loading…" : "Next question"}
              </button>
            ) : (
              <Link
                href={drillSummaryPath(state.sessionId)}
                className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-foreground"
              >
                View summary
              </Link>
            )
          ) : (
            <Link
              href={drillSummaryPath(state.sessionId)}
              className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-foreground"
            >
              View summary
            </Link>
          )}
        </div>
      </footer>
    </div>
  );
}
