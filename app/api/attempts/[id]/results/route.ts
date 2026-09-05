import { getAttemptScores } from "@/lib/scoring";
import { getDb } from "@/lib/db";
import { errorResponse, handleRouteError, jsonResponse, parseAttemptId } from "../../_helpers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: rawId } = await params;
    const attemptId = parseAttemptId(rawId);
    if (attemptId == null) {
      return errorResponse("Invalid attempt id", 400);
    }

    const scores = getAttemptScores(getDb(), attemptId);
    return jsonResponse(scores);
  } catch (err) {
    return handleRouteError(err);
  }
}
