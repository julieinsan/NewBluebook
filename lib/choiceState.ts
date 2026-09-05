/** Valid multiple-choice letters for cross-out state (D2). */
const VALID_CHOICE_LETTERS = new Set(["A", "B", "C", "D"]);

/**
 * Parse raw `crossed_out_choices` JSON text into a sorted letter array.
 * `null`, empty string, and `[]` all mean no choices are crossed out.
 */
export function parseCrossedOutChoices(raw: string | null): string[] {
  if (raw == null || raw.trim() === "") {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const letters = new Set<string>();
  for (const item of parsed) {
    if (typeof item !== "string") {
      continue;
    }
    const upper = item.toUpperCase();
    if (VALID_CHOICE_LETTERS.has(upper)) {
      letters.add(upper);
    }
  }

  return [...letters].sort();
}

/**
 * Serialize crossed-out letters for storage. Returns `null` when none are crossed
 * so the server clears the column (D2).
 */
export function serializeCrossedOutChoices(choices: readonly string[]): string | null {
  const normalized = parseCrossedOutChoices(JSON.stringify(choices));
  if (normalized.length === 0) {
    return null;
  }
  return JSON.stringify(normalized);
}

/** Add or remove a choice letter from the crossed-out set. */
export function toggleCrossedOut(choices: readonly string[], letter: string): string[] {
  const upper = letter.toUpperCase();
  if (!VALID_CHOICE_LETTERS.has(upper)) {
    return parseCrossedOutChoices(JSON.stringify(choices));
  }

  const current = new Set(parseCrossedOutChoices(JSON.stringify(choices)));
  if (current.has(upper)) {
    current.delete(upper);
  } else {
    current.add(upper);
  }

  return [...current].sort();
}
