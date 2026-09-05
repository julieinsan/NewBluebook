import { getRunnerModule } from "@/lib/attemptState";
import { getDb } from "@/lib/db";
import { notFound } from "next/navigation";
import { guardReviewPage } from "../_lib/guardPosition";
import { ModuleReview } from "./ModuleReview";

function parseAttemptId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId: rawId } = await params;
  const attemptId = parseAttemptId(rawId);
  if (attemptId == null) notFound();

  const { section, module } = await guardReviewPage(attemptId);

  const db = getDb();
  let runnerModule;
  try {
    runnerModule = getRunnerModule(db, attemptId, section, module);
  } catch (err) {
    if (err instanceof Error && /does not exist/.test(err.message)) {
      notFound();
    }
    throw err;
  }

  return <ModuleReview runnerModule={runnerModule} />;
}
