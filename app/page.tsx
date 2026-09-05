import { listAttempts } from "@/lib/attemptState";
import { getDb } from "@/lib/db";
import { connection } from "next/server";
import { AttemptHistory } from "./_components/home/AttemptHistory";
import { DrillModeStub } from "./_components/home/DrillModeStub";
import { StartTestButton } from "./_components/home/StartTestButton";

export default async function Home() {
  await connection();
  const db = getDb();
  const { count } = db
    .prepare("SELECT COUNT(*) AS count FROM questions")
    .get() as { count: number };
  const attempts = listAttempts(db);
  const resumable = attempts.find((attempt) => attempt.resumable);
  const hasResumableAttempt = resumable != null;

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 px-6 dark:border-gray-800">
        <span className="text-sm font-semibold tracking-wide text-accent">
          Bluebook Clone
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          Local practice environment
        </span>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Digital SAT Practice</h1>
        <p className="max-w-md text-sm leading-6 text-gray-600 dark:text-gray-400">
          Take a full-length practice test with timed modules, flagging, and review —{" "}
          <strong className="font-semibold text-foreground">
            {count} question{count === 1 ? "" : "s"}
          </strong>{" "}
          in the bank.
        </p>

        <StartTestButton
          hasResumableAttempt={hasResumableAttempt}
          resumableIsPaused={resumable?.isPaused ?? false}
        />
        <DrillModeStub />

        <AttemptHistory attempts={attempts} />
      </main>
    </div>
  );
}
