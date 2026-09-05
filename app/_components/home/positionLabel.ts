import type { ModulePosition } from "@/lib/testFlow";

export function positionLabel(position: ModulePosition): string {
  switch (position.kind) {
    case "module":
      return position.section === "rw"
        ? `Reading and Writing · Module ${position.module}`
        : `Math · Module ${position.module}`;
    case "break":
      return "Section break";
    case "submitted":
      return "Submitted";
  }
}

export function formatAttemptStartedAt(startedAt: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(startedAt.trim());
  if (!match) return startedAt;
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}
