import { notFound } from "next/navigation";
import { guardSubmittedPage } from "../_lib/guardPosition";
import { SubmittedScreen } from "./SubmittedScreen";

function parseAttemptId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export default async function SubmittedPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId: rawId } = await params;
  const attemptId = parseAttemptId(rawId);
  if (attemptId == null) notFound();

  await guardSubmittedPage(attemptId);

  return <SubmittedScreen attemptId={attemptId} />;
}
