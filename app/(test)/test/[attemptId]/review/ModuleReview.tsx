"use client";

import { ConfirmDialog } from "@/app/(test)/_components/ConfirmDialog";
import { QuestionIdLabel } from "@/app/(test)/_components/QuestionIdLabel";
import { ReviewGrid } from "@/app/(test)/_components/ReviewGrid";
import { TopBar } from "@/app/(test)/_components/TopBar";
import { runnerPath, type RunnerModule } from "@/lib/testFlow";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { postEndModule } from "../_lib/clientApi";

export interface ModuleReviewProps {
  runnerModule: RunnerModule;
}

function isUnanswered(question: RunnerModule["questions"][number]): boolean {
  return question.userAnswer == null || question.userAnswer === "";
}

export function ModuleReview({ runnerModule }: ModuleReviewProps) {
  const router = useRouter();
  const { attemptId, section, module, questions, timer } = runnerModule;

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const flagged = questions.filter((q) => q.flagged);
  const unanswered = questions.filter(isUnanswered);

  const isFinalModule = section === "math" && module === 2;

  const handleSubmit = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);

    try {
      const { next } = await postEndModule(attemptId, { section, module });
      router.push(next);
    } catch (err) {
      console.error("Failed to submit module:", err);
      submittingRef.current = false;
      setSubmitting(false);
      setConfirmOpen(false);
    }
  }, [attemptId, module, router, section]);

  const handleGoToQuestion = useCallback(() => {
    router.push(runnerPath(attemptId, section, module));
  }, [attemptId, module, router, section]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="module-review">
      <TopBar section={section} module={module} timer={timer} attemptId={attemptId} timerVisible />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 overflow-y-auto px-6 py-10">
        <div>
          <h1 className="text-xl font-semibold">Check your work</h1>
          <p className="mt-2 text-sm leading-relaxed text-foreground/80">
            Review flagged and unanswered questions before submitting this module.
          </p>
        </div>

        <section>
          <h2 className="text-sm font-semibold">
            Flagged ({flagged.length})
          </h2>
          {flagged.length === 0 ? (
            <p className="mt-2 text-sm text-foreground/60">No flagged questions.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {flagged.map((q) => (
                <li key={q.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span>
                    Question {q.number}
                    {isUnanswered(q) ? " — unanswered" : ""}
                  </span>
                  <QuestionIdLabel id={q.id} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-sm font-semibold">
            Unanswered ({unanswered.length})
          </h2>
          {unanswered.length === 0 ? (
            <p className="mt-2 text-sm text-foreground/60">All questions answered.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {unanswered.map((q) => (
                <li key={q.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span>Question {q.number}</span>
                  <QuestionIdLabel id={q.id} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold">All questions</h2>
          <ReviewGrid
            questions={questions}
            currentIndex={-1}
            onSelectQuestion={() => handleGoToQuestion()}
          />
        </section>

        <div className="flex flex-col items-center gap-3 pb-8">
          <button
            type="button"
            className="rounded-full bg-accent px-6 py-3 text-sm font-medium text-accent-foreground disabled:opacity-60"
            disabled={submitting}
            onClick={() => setConfirmOpen(true)}
          >
            {isFinalModule ? "Submit test" : "Submit module"}
          </button>
          <button
            type="button"
            className="text-sm font-medium underline-offset-2 hover:underline"
            onClick={() => router.push(runnerPath(attemptId, section, module))}
          >
            Return to module
          </button>
        </div>
      </main>

      <ConfirmDialog
        open={confirmOpen}
        title={isFinalModule ? "Submit your test?" : "Submit this module?"}
        message={
          isFinalModule
            ? "You will not be able to change your answers after submitting."
            : "You will move on to the next part of the test. Unanswered questions will be scored as incorrect."
        }
        confirmLabel={isFinalModule ? "Submit test" : "Submit module"}
        onConfirm={() => void handleSubmit()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
