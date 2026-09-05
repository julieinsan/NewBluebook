import { resumeAttempt } from "@/lib/pauseTransition";
import { getDb } from "@/lib/db";
import {
  errorResponse,
  handleRouteError,
  jsonResponse,
  parseAttemptId,
} from "../../_helpers";

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
    const result = resumeAttempt(db, attemptId);
    return jsonResponse({ next: result.next });
  } catch (err) {
    return handleRouteError(err);
  }
}
