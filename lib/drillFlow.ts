/**
 * Epic 6: drill route helpers and filter parsing (pure — no DB).
 */
import type { Difficulty } from "./blueprint";
import type { DrillFilters } from "./drillContract";

const DRILL_ROOT = "/drill";
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

export function drillPath(sessionId: number): string {
  return `${DRILL_ROOT}/${sessionId}`;
}

export function drillSummaryPath(sessionId: number): string {
  return `${drillPath(sessionId)}/summary`;
}

export function drillPickerPath(): string {
  return DRILL_ROOT;
}

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === "string" && (DIFFICULTIES as string[]).includes(value);
}

/**
 * Validates drill start body: `{ domain, skill?, difficulty? }`.
 * Section is inferred by the service from the domain.
 */
export function parseDrillFilters(body: unknown): Omit<DrillFilters, "section"> {
  if (body == null || typeof body !== "object") {
    throw new Error("Body must be a JSON object");
  }
  const { domain, skill, difficulty } = body as Record<string, unknown>;

  if (typeof domain !== "string" || domain.trim() === "") {
    throw new Error("domain is required");
  }

  let parsedSkill: string | null = null;
  if (skill != null && skill !== "") {
    if (typeof skill !== "string" || skill.trim() === "") {
      throw new Error("skill must be a non-empty string when provided");
    }
    parsedSkill = skill.trim();
  }

  let parsedDifficulty: Difficulty | "any" = "any";
  if (difficulty != null && difficulty !== "" && difficulty !== "any") {
    if (!isDifficulty(difficulty)) {
      throw new Error('difficulty must be "easy", "medium", "hard", or "any"');
    }
    parsedDifficulty = difficulty;
  }

  return {
    domain: domain.trim(),
    skill: parsedSkill,
    difficulty: parsedDifficulty,
  };
}
