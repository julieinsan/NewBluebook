import { resolvePositionForAttempt } from "@/lib/attemptState";
import { endModule1, endModule2 } from "@/lib/moduleTransition";
import { getDb } from "@/lib/db";
import { pathForPosition } from "@/lib/testFlow";
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

    const { section, module } = body;
    if (!isSection(section) || !isModuleNumber(module)) {
      return errorResponse('Body must include section ("rw" | "math") and module (1 | 2)', 400);
    }

    const db = getDb();

    if (module === 1) {
      const result = endModule1(db, attemptId, section);
      const next = pathForPosition(attemptId, resolvePositionForAttempt(db, attemptId));
      return jsonResponse({
        next,
        module2: {
          section: result.section,
          module: 2,
          questionCount: result.module2.questions.length,
        },
      });
    }

    endModule2(db, attemptId, section);
    const next = pathForPosition(attemptId, resolvePositionForAttempt(db, attemptId));
    return jsonResponse({ next });
  } catch (err) {
    return handleRouteError(err);
  }
}
