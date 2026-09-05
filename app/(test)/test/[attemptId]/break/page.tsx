import { guardBreakPage, readBreakStartedAt } from "../_lib/guardPosition";
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
  const breakStartedAt = await readBreakStartedAt(attemptId);

  return (
    <BreakScreen attemptId={attemptId} breakStartedAt={breakStartedAt} />
  );
}
