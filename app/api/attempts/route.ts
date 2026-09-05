import { listAttempts } from "@/lib/attemptState";
import { startNewAttempt } from "@/lib/attemptService";
import { getDb } from "@/lib/db";
import { moduleStartedAtColumn, runnerPath } from "@/lib/testFlow";
import { jsonResponse, handleRouteError } from "./_helpers";

/**
 * POST /api/attempts — start or resume a test (D9, D3a).
 *
 * Idempotent: returns the existing in-progress attempt if one exists. Otherwise creates
 * a new attempt and stamps `rw_module1_started_at` write-if-null.
 */
export async function POST(): Promise<Response> {
  try {
    const db = getDb();
    const existing = listAttempts(db).find((attempt) => attempt.resumable);
    if (existing) {
      return jsonResponse({
        attemptId: existing.attemptId,
        reused: true,
        next: existing.path,
      });
    }

    const { attemptId } = startNewAttempt(db);
    const column = moduleStartedAtColumn("rw", 1);
    db.prepare(
      `UPDATE test_attempts SET ${column} = datetime('now') WHERE id = ? AND ${column} IS NULL`,
    ).run(attemptId);

    return jsonResponse({
      attemptId,
      reused: false,
      next: runnerPath(attemptId, "rw", 1),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
