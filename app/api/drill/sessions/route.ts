import { parseDrillFilters, drillPath } from "@/lib/drillFlow";
import { startDrillSession } from "@/lib/drillService";
import { getDb } from "@/lib/db";
import { handleRouteError, jsonResponse, readJsonBody } from "../_helpers";

/** POST /api/drill/sessions — start a targeted drill session (Story 6.1). */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody(request);
    if (!body) {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const filters = parseDrillFilters(body);
    const db = getDb();
    const { sessionId, state } = startDrillSession(db, filters);

    return jsonResponse({
      sessionId,
      next: drillPath(sessionId),
      state,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
