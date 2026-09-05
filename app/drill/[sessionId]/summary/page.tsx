import { getDrillSessionSummary } from "@/lib/drillService";
import { getDb } from "@/lib/db";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";

function parseSessionId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export default async function DrillSummaryPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  await connection();
  const { sessionId: rawId } = await params;
  const sessionId = parseSessionId(rawId);
  if (sessionId == null) notFound();

  let summary;
  try {
    summary = getDrillSessionSummary(getDb(), sessionId);
  } catch (err) {
    if (err instanceof Error && /does not exist/.test(err.message)) {
      notFound();
    }
    throw err;
  }

  const filterParts = [summary.filters.domain];
  if (summary.filters.skill) filterParts.push(summary.filters.skill);
  if (summary.filters.difficulty !== "any") filterParts.push(summary.filters.difficulty);

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-center border-b border-foreground/10 px-6">
        <span className="text-sm font-semibold">Drill summary</span>
      </header>

      <main
        className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-6 px-6 py-12 text-center"
        data-testid="drill-summary"
      >
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/60">
            Session complete
          </p>
          <p className="mt-4 text-5xl font-semibold tabular-nums">{summary.accuracyPercent}%</p>
          <p className="mt-2 text-sm text-foreground/70">Accuracy</p>
        </div>

        <dl className="grid w-full gap-4 rounded-lg border border-foreground/10 px-5 py-4 text-left text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-foreground/70">Questions answered</dt>
            <dd className="font-medium tabular-nums">{summary.answered}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-foreground/70">Correct</dt>
            <dd className="font-medium tabular-nums">{summary.correct}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-foreground/70">Filters</dt>
            <dd className="text-right font-medium">{filterParts.join(" · ")}</dd>
          </div>
        </dl>

        <nav className="flex flex-col items-center gap-4 sm:flex-row">
          <Link
            href="/drill"
            className="rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-accent-foreground"
          >
            Start another drill
          </Link>
          <Link href="/" className="text-sm font-medium text-accent hover:underline">
            Back to home
          </Link>
        </nav>
      </main>
    </div>
  );
}
