import { getDb } from "@/lib/db";

export default function Home() {
  const db = getDb();
  const { count } = db
    .prepare("SELECT COUNT(*) AS count FROM questions")
    .get() as { count: number };

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

      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Digital SAT Practice</h1>
        <p className="max-w-md text-sm leading-6 text-gray-600 dark:text-gray-400">
          Project scaffold is running: Next.js, Tailwind, and SQLite are wired
          up end to end. The database is connected and migrated —{" "}
          <strong className="font-semibold text-foreground">
            {count} question{count === 1 ? "" : "s"}
          </strong>{" "}
          currently loaded.
        </p>

        <button
          type="button"
          disabled
          className="rounded-full bg-accent px-6 py-2 text-sm font-medium text-accent-foreground opacity-60"
        >
          Start new test (coming soon)
        </button>

        <span className="rounded bg-highlight px-2 py-0.5 text-xs font-medium text-highlight-foreground">
          highlighter accent preview
        </span>
      </main>
    </div>
  );
}
