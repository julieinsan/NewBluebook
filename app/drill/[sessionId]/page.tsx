import { getDrillRunnerState } from "@/lib/drillService";
import { getDb } from "@/lib/db";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { DrillRunner } from "./DrillRunner";

function parseSessionId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export default async function DrillSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  await connection();
  const { sessionId: rawId } = await params;
  const sessionId = parseSessionId(rawId);
  if (sessionId == null) notFound();

  let state;
  try {
    state = getDrillRunnerState(getDb(), sessionId);
  } catch (err) {
    if (err instanceof Error && /does not exist/.test(err.message)) {
      notFound();
    }
    throw err;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <DrillRunner initialState={state} />
    </div>
  );
}
