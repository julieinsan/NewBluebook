import { setChoiceState, setFlag } from "@/lib/questionState";
import { getDb } from "@/lib/db";
import {
  errorResponse,
  handleRouteError,
  isModuleNumber,
  isSection,
  jsonResponse,
  parseAttemptId,
  readJsonBody,
} from "../../../../_helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; qid: string }> },
): Promise<Response> {
  try {
    const { id: rawId, qid: questionId } = await params;
    const attemptId = parseAttemptId(rawId);
    if (attemptId == null) {
      return errorResponse("Invalid attempt id", 400);
    }
    if (!questionId) {
      return errorResponse("Invalid question id", 400);
    }

    const body = await readJsonBody(request);
    if (!body) {
      return errorResponse("Invalid JSON body", 400);
    }

    const { section, module, flagged, crossedOut, highlights } = body;
    if (!isSection(section) || !isModuleNumber(module)) {
      return errorResponse('Body must include section ("rw" | "math") and module (1 | 2)', 400);
    }

    const db = getDb();
    const hasFlag = "flagged" in body;
    const hasCrossedOut = "crossedOut" in body;
    const hasHighlights = "highlights" in body;

    if (!hasFlag && !hasCrossedOut && !hasHighlights) {
      return errorResponse("Body must include at least one of flagged, crossedOut, highlights", 400);
    }

    if (hasFlag) {
      if (typeof flagged !== "boolean") {
        return errorResponse("flagged must be a boolean", 400);
      }
      setFlag(db, attemptId, section, module, questionId, flagged);
    }

    if (hasCrossedOut || hasHighlights) {
      const update: { crossedOutChoices?: string | null; highlights?: string | null } = {};
      if (hasCrossedOut) {
        if (crossedOut !== null && typeof crossedOut !== "string") {
          return errorResponse("crossedOut must be a string or null", 400);
        }
        update.crossedOutChoices = crossedOut ?? null;
      }
      if (hasHighlights) {
        if (highlights !== null && typeof highlights !== "string") {
          return errorResponse("highlights must be a string or null", 400);
        }
        update.highlights = highlights ?? null;
      }
      setChoiceState(db, attemptId, section, module, questionId, update);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
