import { getAttemptState, resolvePositionForAttempt } from "@/lib/attemptState";
import type { ModuleNumber, Section } from "@/lib/blueprint";
import { getDb } from "@/lib/db";
import { pathForPosition, samePosition, type ModulePosition } from "@/lib/testFlow";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";

function handleMissingAttempt(err: unknown): never {
  if (err instanceof Error && /does not exist/.test(err.message)) {
    notFound();
  }
  throw err;
}

export async function guardModuleRunner(
  attemptId: number,
  section: Section,
  module: ModuleNumber,
): Promise<void> {
  await connection();
  const db = getDb();
  try {
    const position = resolvePositionForAttempt(db, attemptId);
    const expected: ModulePosition = { kind: "module", section, module };
    if (!samePosition(position, expected)) {
      redirect(pathForPosition(attemptId, position));
    }
  } catch (err) {
    handleMissingAttempt(err);
  }
}

export async function guardReviewPage(
  attemptId: number,
): Promise<{ section: Section; module: ModuleNumber }> {
  await connection();
  const db = getDb();
  try {
    const position = resolvePositionForAttempt(db, attemptId);
    if (position.kind !== "module") {
      redirect(pathForPosition(attemptId, position));
    }
    return { section: position.section, module: position.module };
  } catch (err) {
    handleMissingAttempt(err);
  }
}

export async function guardBreakPage(attemptId: number): Promise<void> {
  await connection();
  const db = getDb();
  try {
    const position = resolvePositionForAttempt(db, attemptId);
    if (position.kind !== "break") {
      redirect(pathForPosition(attemptId, position));
    }
  } catch (err) {
    handleMissingAttempt(err);
  }
}

export async function guardSubmittedPage(attemptId: number): Promise<void> {
  await connection();
  const db = getDb();
  try {
    const position = resolvePositionForAttempt(db, attemptId);
    if (position.kind !== "submitted") {
      redirect(pathForPosition(attemptId, position));
    }
  } catch (err) {
    handleMissingAttempt(err);
  }
}

export async function readBreakStartedAt(attemptId: number): Promise<string> {
  await connection();
  const db = getDb();
  try {
    const state = getAttemptState(db, attemptId);
    if (state.breakStartedAt == null) {
      throw new Error(`Attempt ${attemptId} has no break_started_at stamp`);
    }
    return state.breakStartedAt;
  } catch (err) {
    handleMissingAttempt(err);
  }
}
