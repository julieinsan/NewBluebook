import { submitAttempt } from "@/lib/moduleTransition";
import { getDb } from "@/lib/db";
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

    submitAttempt(getDb(), attemptId);
    return jsonResponse({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
