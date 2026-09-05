import { resolvePositionForAttempt } from "@/lib/attemptState";
import { endBreak } from "@/lib/moduleTransition";
import { getDb } from "@/lib/db";
import { pathForPosition } from "@/lib/testFlow";
import { errorResponse, handleRouteError, jsonResponse, parseAttemptId } from "../../_helpers";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: rawId } = await params;
    const attemptId = parseAttemptId(rawId);
    if (attemptId == null) {
      return errorResponse("Invalid attempt id", 400);
    }

    const db = getDb();
    endBreak(db, attemptId);
    const next = pathForPosition(attemptId, resolvePositionForAttempt(db, attemptId));

    return jsonResponse({ next });
  } catch (err) {
    return handleRouteError(err);
  }
}
