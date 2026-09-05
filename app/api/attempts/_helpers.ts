import { NextResponse } from "next/server";
import type { ModuleNumber, Section } from "@/lib/blueprint";

export function jsonResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

export function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function parseAttemptId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export function isSection(value: unknown): value is Section {
  return value === "rw" || value === "math";
}

export function isModuleNumber(value: unknown): value is ModuleNumber {
  return value === 1 || value === 2;
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function handleRouteError(err: unknown): NextResponse {
  if (err instanceof Error) {
    if (/does not exist/.test(err.message)) {
      return errorResponse(err.message, 404);
    }
    if (
      /is not part of attempt/.test(err.message) ||
      /has not been started/.test(err.message) ||
      /has not started/.test(err.message) ||
      /cannot be paused/.test(err.message) ||
      /practiceTest must be 1 or 2/.test(err.message) ||
      /is not submitted/.test(err.message) ||
      /Invalid/.test(err.message)
    ) {
      return errorResponse(err.message, 400);
    }
    console.error(err);
    return errorResponse(err.message, 500);
  }
  console.error(err);
  return errorResponse("Internal server error", 500);
}
