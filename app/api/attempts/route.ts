import { startNewAttempt, type PracticeTest } from "@/lib/attemptService";
import { getDb } from "@/lib/db";
import { parsePracticeTest } from "@/lib/practiceTest";
import { moduleStartedAtColumn, runnerPath } from "@/lib/testFlow";
import { jsonResponse, handleRouteError } from "./_helpers";

/**
 * POST /api/attempts — start a new practice test (D9′).
 *
 * Body: `{ practiceTest?: 1 | 2 }` (defaults to 1). Always creates a new attempt and
 * stamps `rw_module1_started_at` write-if-null.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    let practiceTest: PracticeTest = 1;
    try {
      const body = await request.json();
      practiceTest = parsePracticeTest(body);
    } catch (err) {
      if (err instanceof Error && err.message === "practiceTest must be 1 or 2") {
        throw err;
      }
      // Empty body or invalid JSON — default to Practice Test 1.
    }

    const db = getDb();
    const { attemptId } = startNewAttempt(db, { practiceTest });
    const column = moduleStartedAtColumn("rw", 1);
    db.prepare(
      `UPDATE test_attempts SET ${column} = datetime('now') WHERE id = ? AND ${column} IS NULL`,
    ).run(attemptId);

    return jsonResponse({
      attemptId,
      practiceTest,
      next: runnerPath(attemptId, "rw", 1),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
