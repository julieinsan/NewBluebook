import { startNewAttempt, type PracticeTest } from "@/lib/attemptService";
import { getDb } from "@/lib/db";
import { moduleStartedAtColumn, runnerPath } from "@/lib/testFlow";
import { jsonResponse, handleRouteError } from "./_helpers";

function parsePracticeTest(body: unknown): PracticeTest {
  if (body == null || typeof body !== "object") {
    return 1;
  }
  const value = (body as { practiceTest?: unknown }).practiceTest;
  if (value === 1 || value === 2) {
    return value;
  }
  throw new Error("practiceTest must be 1 or 2");
}

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
