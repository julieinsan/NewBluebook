import { getDb } from "@/lib/db";
import { readReviewQuestions } from "@/lib/reviewReadModel";
import { notFound } from "next/navigation";
import { guardAnswerReviewPage } from "../../_lib/guardPosition";
import { AnswerReviewRunner } from "./AnswerReviewRunner";

function parseAttemptId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export default async function AnswerReviewPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId: rawId } = await params;
  const attemptId = parseAttemptId(rawId);
  if (attemptId == null) notFound();

  await guardAnswerReviewPage(attemptId);

  const db = getDb();
  let questions;
  try {
    questions = readReviewQuestions(db, attemptId);
  } catch (err) {
    if (err instanceof Error && /does not exist/.test(err.message)) {
      notFound();
    }
    throw err;
  }

  return <AnswerReviewRunner attemptId={attemptId} questions={questions} />;
}
