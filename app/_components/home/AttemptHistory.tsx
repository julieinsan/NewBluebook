import type { AttemptSummary } from "@/lib/attemptState";
import { resultsPath } from "@/lib/testFlow";
import Link from "next/link";
import { formatAttemptStartedAt, positionLabel, practiceTestLabel } from "./positionLabel";
import { ResumeButton } from "./ResumeButton";

function isCompletedAttempt(attempt: AttemptSummary): boolean {
  return (
    !attempt.resumable &&
    (attempt.status === "submitted" || attempt.totalScaledScore != null)
  );
}

export interface AttemptHistoryProps {
  attempts: AttemptSummary[];
}

function resumeControl(attempt: AttemptSummary, className: string, label: string) {
  if (attempt.isPaused) {
    return (
      <ResumeButton attemptId={attempt.attemptId} className={className}>
        {label}
      </ResumeButton>
    );
  }
  return (
    <Link href={attempt.path} className={className}>
      {label}
    </Link>
  );
}

export function AttemptHistory({ attempts }: AttemptHistoryProps) {
  const resumableAttempts = attempts.filter((attempt) => attempt.resumable);

  if (attempts.length === 0) {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-400">
        No past attempts yet. Start your first practice test above.
      </p>
    );
  }

  return (
    <div className="flex w-full max-w-lg flex-col gap-6">
      {resumableAttempts.length > 0 && (
        <section className="rounded-lg border border-accent/30 bg-accent/5 p-4 text-left">
          <h2 className="text-sm font-semibold">In progress</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {resumableAttempts.map((attempt) => (
              <li
                key={attempt.attemptId}
                className="flex flex-col gap-2 border-t border-accent/20 pt-3 first:border-t-0 first:pt-0"
              >
                <div>
                  <p className="text-sm font-medium">
                    {practiceTestLabel(attempt.practiceTest)}
                    {attempt.isPaused ? " · Paused" : ""}
                  </p>
                  <p className="text-sm text-foreground/80">
                    {positionLabel(attempt.position, attempt.isPaused)} · started{" "}
                    {formatAttemptStartedAt(attempt.startedAt)}
                  </p>
                </div>
                {resumeControl(
                  attempt,
                  "inline-block w-fit rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-foreground",
                  attempt.isPaused ? "Resume test" : "Resume test",
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="text-left">
        <h2 className="text-sm font-semibold">Past attempts</h2>
        <ul className="mt-3 divide-y divide-foreground/10 rounded-lg border border-foreground/10">
          {attempts.map((attempt) => (
            <li key={attempt.attemptId} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {practiceTestLabel(attempt.practiceTest)} · Attempt #{attempt.attemptId}
                </p>
                <p className="text-xs text-foreground/70">
                  {formatAttemptStartedAt(attempt.startedAt)} ·{" "}
                  {positionLabel(attempt.position, attempt.isPaused)}
                </p>
              </div>
              {attempt.resumable ? (
                resumeControl(
                  attempt,
                  "shrink-0 text-sm font-medium text-accent hover:underline",
                  "Resume",
                )
              ) : isCompletedAttempt(attempt) ? (
                <div className="shrink-0 text-right">
                  {attempt.totalScaledScore != null && (
                    <p className="text-xs text-foreground/70">
                      Score: {attempt.totalScaledScore}
                    </p>
                  )}
                  <Link
                    href={resultsPath(attempt.attemptId)}
                    className="text-sm font-medium text-accent hover:underline"
                  >
                    View results
                  </Link>
                </div>
              ) : (
                <span className="shrink-0 text-xs text-foreground/50">Completed</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
