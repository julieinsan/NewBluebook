import { MarkdownContent } from "@/app/(test)/_components/question/MarkdownContent";
import { QuestionFigure } from "@/app/(test)/_components/question/QuestionFigure";
import { splitRwStimulus } from "@/app/(test)/_components/question/splitRwStimulus";
import { formatDuration } from "@/lib/formatDuration";
import type { ReviewQuestion } from "@/lib/resultsContract";
import { SeenBeforeBadge } from "./SeenBeforeBadge";

export interface AnswerReviewCardProps {
  question: ReviewQuestion;
}

function ReadOnlyChoiceRow({
  letter,
  text,
  selected,
  correct,
}: {
  letter: "A" | "B" | "C" | "D";
  text: string;
  selected: boolean;
  correct: boolean;
}) {
  return (
    <div
      className={`flex min-h-12 items-center gap-3 rounded-full border px-4 py-3 text-left text-sm leading-relaxed ${
        correct
          ? "border-green-700/40 bg-green-50 dark:bg-green-950/20"
          : selected
            ? "border-accent bg-accent/5"
            : "border-foreground/20"
      }`}
      data-testid={`review-choice-${letter}`}
    >
      <span
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
          correct
            ? "border-green-700 bg-green-700 text-white"
            : selected
              ? "border-accent bg-accent text-accent-foreground"
              : "border-foreground/30"
        }`}
      >
        {letter}
      </span>
      <MarkdownContent className="flex-1 [&_p]:m-0">{text}</MarkdownContent>
      {correct && (
        <span className="shrink-0 text-xs font-medium text-green-700 dark:text-green-400">
          Correct
        </span>
      )}
    </div>
  );
}

function AnswerStatus({ isCorrect }: { isCorrect: boolean }) {
  return (
    <p
      className={`text-sm font-medium ${
        isCorrect ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"
      }`}
      data-testid="answer-status"
    >
      {isCorrect ? "Correct" : "Incorrect"}
    </p>
  );
}

export function AnswerReviewCard({ question }: AnswerReviewCardProps) {
  const isMc = question.questionType === "mc";
  const { passage, questionStem } =
    question.section === "rw" ? splitRwStimulus(question.stimulusText) : { passage: "", questionStem: question.stimulusText };

  return (
    <article className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="answer-review-card">
      <header className="mb-4 flex flex-wrap items-center gap-3 border-b border-foreground/10 pb-4">
        <AnswerStatus isCorrect={question.isCorrect} />
        {question.flagged && (
          <span className="text-xs text-foreground/70" data-testid="flagged-indicator">
            Flagged during test
          </span>
        )}
        {question.wasRecycled && <SeenBeforeBadge />}
        <span className="text-xs text-foreground/60">
          Time spent: {formatDuration(question.timeSpentSeconds)}
        </span>
      </header>

      {question.section === "rw" ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 md:grid-cols-2">
          <section
            className="overflow-y-auto border-b border-foreground/10 p-6 md:border-b-0 md:border-r"
            aria-label="Passage"
          >
            <MarkdownContent className="prose prose-sm max-w-none leading-relaxed">
              {passage}
            </MarkdownContent>
          </section>
          <section className="overflow-y-auto p-6" aria-label="Question">
            <MarkdownContent className="mb-6 text-sm leading-relaxed">{questionStem}</MarkdownContent>
            {question.figureAssetPath && <QuestionFigure src={question.figureAssetPath} />}
            {isMc ? (
              <div className="flex flex-col gap-3">
                {question.choices.map((choice) => (
                  <ReadOnlyChoiceRow
                    key={choice.letter}
                    letter={choice.letter}
                    text={choice.text}
                    selected={question.userAnswer === choice.letter}
                    correct={question.correctAnswer === choice.letter}
                  />
                ))}
              </div>
            ) : (
              <GridInReview question={question} />
            )}
          </section>
        </div>
      ) : (
        <section className="overflow-y-auto p-6">
          <MarkdownContent className="mb-6 text-sm leading-relaxed">
            {question.stimulusText}
          </MarkdownContent>
          {question.figureAssetPath && <QuestionFigure src={question.figureAssetPath} />}
          {isMc ? (
            <div className="flex flex-col gap-3">
              {question.choices.map((choice) => (
                <ReadOnlyChoiceRow
                  key={choice.letter}
                  letter={choice.letter}
                  text={choice.text}
                  selected={question.userAnswer === choice.letter}
                  correct={question.correctAnswer === choice.letter}
                />
              ))}
            </div>
          ) : (
            <GridInReview question={question} />
          )}
        </section>
      )}

      <section className="mt-6 border-t border-foreground/10 p-6">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-foreground/60">
              Your answer
            </dt>
            <dd className="mt-1">{question.userAnswer ?? "No answer"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-foreground/60">
              Correct answer
            </dt>
            <dd className="mt-1">{question.correctAnswer}</dd>
          </div>
        </dl>
        {question.rationale && (
          <div
            className="mt-4 rounded-md border border-foreground/10 bg-foreground/[0.02] p-4"
            data-testid="rationale-block"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/60">
              Rationale
            </p>
            <MarkdownContent className="mt-2 text-sm leading-relaxed">
              {question.rationale}
            </MarkdownContent>
          </div>
        )}
      </section>
    </article>
  );
}

function GridInReview({ question }: { question: ReviewQuestion }) {
  return (
    <div className="mt-4 max-w-xs">
      <span className="mb-2 block text-sm font-medium">Your answer</span>
      <p className="rounded-md border border-foreground/20 px-3 py-2 text-sm">
        {question.userAnswer ?? "No answer"}
      </p>
    </div>
  );
}
