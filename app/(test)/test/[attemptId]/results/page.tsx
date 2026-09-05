import { getAttemptScores } from "@/lib/scoring";
import { getDb } from "@/lib/db";
import { notFound } from "next/navigation";
import { guardResultsPage } from "../_lib/guardPosition";
import { ResultsDashboard } from "./ResultsDashboard";

function parseAttemptId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId: rawId } = await params;
  const attemptId = parseAttemptId(rawId);
  if (attemptId == null) notFound();

  await guardResultsPage(attemptId);

  const db = getDb();
  let scores;
  try {
    scores = getAttemptScores(db, attemptId);
  } catch (err) {
    if (err instanceof Error && /does not exist/.test(err.message)) {
      notFound();
    }
    throw err;
  }

  return <ResultsDashboard scores={scores} attemptId={attemptId} />;
}
