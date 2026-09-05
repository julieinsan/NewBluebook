import { saveAnswerWithDeadline } from "@/lib/questionState";
import { getDb } from "@/lib/db";
import {
  errorResponse,
  handleRouteError,
  isModuleNumber,
  isSection,
  jsonResponse,
  parseAttemptId,
  readJsonBody,
} from "../../_helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: rawId } = await params;
    const attemptId = parseAttemptId(rawId);
    if (attemptId == null) {
      return errorResponse("Invalid attempt id", 400);
    }

    const body = await readJsonBody(request);
    if (!body) {
      return errorResponse("Invalid JSON body", 400);
    }

    const { section, module, questionId, userAnswer } = body;
    if (!isSection(section) || !isModuleNumber(module)) {
      return errorResponse('Body must include section ("rw" | "math") and module (1 | 2)', 400);
    }
    if (typeof questionId !== "string" || questionId.length === 0) {
      return errorResponse("Body must include questionId", 400);
    }
    if (userAnswer !== null && typeof userAnswer !== "string") {
      return errorResponse("userAnswer must be a string or null", 400);
    }

    const result = saveAnswerWithDeadline(
      getDb(),
      attemptId,
      section,
      module,
      questionId,
      userAnswer ?? null,
    );

    return jsonResponse(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
