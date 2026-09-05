import { serveNextDrillQuestion } from "@/lib/drillService";
import { getDb } from "@/lib/db";
import { errorResponse, handleRouteError, jsonResponse, parseSessionId } from "../../../_helpers";

/** POST /api/drill/sessions/:id/next — serve the next drill question. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: rawId } = await params;
    const sessionId = parseSessionId(rawId);
    if (sessionId == null) {
      return errorResponse("Invalid session id", 400);
    }

    const state = serveNextDrillQuestion(getDb(), sessionId);
    return jsonResponse({ state });
  } catch (err) {
    return handleRouteError(err);
  }
}
