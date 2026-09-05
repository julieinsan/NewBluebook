import type { AttemptSummary } from "@/lib/attemptState";
import Link from "next/link";
import { formatAttemptStartedAt, positionLabel } from "./positionLabel";
import { ResumeButton } from "./ResumeButton";

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
  const resumable = attempts.find((attempt) => attempt.resumable);

  if (attempts.length === 0) {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-400">
        No past attempts yet. Start your first practice test above.
      </p>
    );
  }

  return (
    <div className="flex w-full max-w-lg flex-col gap-6">
      {resumable && (
        <section className="rounded-lg border border-accent/30 bg-accent/5 p-4 text-left">
          <h2 className="text-sm font-semibold">
            {resumable.isPaused ? "Paused test" : "Resume in progress"}
          </h2>
          <p className="mt-1 text-sm text-foreground/80">
            {positionLabel(resumable.position, resumable.isPaused)} · started{" "}
            {formatAttemptStartedAt(resumable.startedAt)}
          </p>
          {resumeControl(
            resumable,
            "mt-3 inline-block rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-foreground",
            resumable.isPaused ? "Resume test" : "Resume test",
          )}
        </section>
      )}

      <section className="text-left">
        <h2 className="text-sm font-semibold">Past attempts</h2>
        <ul className="mt-3 divide-y divide-foreground/10 rounded-lg border border-foreground/10">
          {attempts.map((attempt) => (
            <li key={attempt.attemptId} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Attempt #{attempt.attemptId}</p>
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
