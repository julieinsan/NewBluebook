import { getBreakTimer } from "@/lib/attemptState";
import { getDb } from "@/lib/db";
import { guardBreakPage } from "../_lib/guardPosition";
import { BreakScreen } from "./BreakScreen";
import { notFound } from "next/navigation";

function parseAttemptId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export default async function BreakPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId: rawId } = await params;
  const attemptId = parseAttemptId(rawId);
  if (attemptId == null) notFound();

  await guardBreakPage(attemptId);
  const db = getDb();
  const timer = getBreakTimer(db, attemptId);

  return <BreakScreen attemptId={attemptId} timer={timer} />;
}
