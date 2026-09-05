import { saveDrillAnswer } from "@/lib/drillService";
import { getDb } from "@/lib/db";
import {
  errorResponse,
  handleRouteError,
  jsonResponse,
  parseSessionId,
  readJsonBody,
} from "../../../_helpers";

/** POST /api/drill/sessions/:id/answers — grade current question (Story 6.2). */
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

    const { questionId, userAnswer } = body;
    if (typeof questionId !== "string" || questionId.length === 0) {
      return errorResponse("questionId is required", 400);
    }
    if (userAnswer !== null && typeof userAnswer !== "string") {
      return errorResponse("userAnswer must be a string or null", 400);
    }

    const state = saveDrillAnswer(getDb(), sessionId, questionId, userAnswer ?? null);
    return jsonResponse({ state });
  } catch (err) {
    return handleRouteError(err);
  }
}
