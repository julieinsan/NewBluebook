import type { PracticeTest } from "./attemptService";

/** Parses `{ practiceTest?: 1 | 2 }` from a POST /api/attempts body. Defaults to 1. */
export function parsePracticeTest(body: unknown): PracticeTest {
  if (body == null || typeof body !== "object") {
    return 1;
  }
  const value = (body as { practiceTest?: unknown }).practiceTest;
  if (value === undefined) {
    return 1;
  }
  if (value === 1 || value === 2) {
    return value;
  }
  throw new Error("practiceTest must be 1 or 2");
}
