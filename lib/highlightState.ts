/** Passage highlight range stored as UTF-16 code-unit offsets (D4). */
export interface HighlightRange {
  start: number;
  end: number;
  note?: string;
}

function isValidHighlightRange(value: unknown): value is HighlightRange {
  if (typeof value !== "object" || value == null) {
    return false;
  }
  const { start, end, note } = value as HighlightRange;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
    return false;
  }
  if (note !== undefined && typeof note !== "string") {
    return false;
  }
  return true;
}

/**
 * Parse raw `highlights` JSON text into validated, sorted ranges.
 * `null`, empty string, and `[]` all mean no highlights.
 */
export function parseHighlights(raw: string | null): HighlightRange[] {
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

  const ranges: HighlightRange[] = [];
  for (const item of parsed) {
    if (!isValidHighlightRange(item)) {
      continue;
    }
    const range: HighlightRange = { start: item.start, end: item.end };
    if (item.note !== undefined) {
      range.note = item.note;
    }
    ranges.push(range);
  }

  return mergeHighlightRanges(ranges);
}

/**
 * Serialize highlights for storage. Returns `null` when empty so the server clears
 * the column (D4).
 */
export function serializeHighlights(highlights: readonly HighlightRange[]): string | null {
  const normalized = mergeHighlightRanges(
    highlights.filter((range) => isValidHighlightRange(range)),
  );
  if (normalized.length === 0) {
    return null;
  }
  return JSON.stringify(normalized);
}

/**
 * Add a highlight and merge overlapping or adjacent ranges into a non-overlapping list (D4).
 */
export function mergeHighlight(
  existing: readonly HighlightRange[],
  newRange: HighlightRange,
): HighlightRange[] {
  if (!isValidHighlightRange(newRange)) {
    return mergeHighlightRanges(existing.filter((range) => isValidHighlightRange(range)));
  }

  const combined = [...existing.filter((range) => isValidHighlightRange(range)), newRange];
  return mergeHighlightRanges(combined);
}

function mergeHighlightRanges(ranges: readonly HighlightRange[]): HighlightRange[] {
  if (ranges.length === 0) {
    return [];
  }

  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: HighlightRange[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
      if (current.note !== undefined && last.note === undefined) {
        last.note = current.note;
      }
      continue;
    }

    merged.push({ ...current });
  }

  return merged;
}
