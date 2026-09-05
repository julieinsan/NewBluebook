import { addDrillTimeSpent } from "@/lib/drillService";
import { getDb } from "@/lib/db";
import {
  errorResponse,
  handleRouteError,
  jsonResponse,
  parseSessionId,
  readJsonBody,
} from "../../../_helpers";

/** POST /api/drill/sessions/:id/time — accumulate active-view seconds (Story 6.4). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: rawId } = await params;
    const sessionId = parseSessionId(rawId);
    if (sessionId == null) {
      return errorResponse("Invalid session id", 400);
    }

    const body = await readJsonBody(request);
    if (!body) {
      return errorResponse("Invalid JSON body", 400);
    }

    const { questionId, timeSpentDelta } = body;
    if (typeof questionId !== "string" || questionId.length === 0) {
      return errorResponse("questionId is required", 400);
    }
    if (typeof timeSpentDelta !== "number" || !Number.isInteger(timeSpentDelta)) {
      return errorResponse("timeSpentDelta must be an integer", 400);
    }

    addDrillTimeSpent(getDb(), sessionId, questionId, timeSpentDelta);
    return jsonResponse({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
