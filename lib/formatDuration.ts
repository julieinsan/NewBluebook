/**
 * Epic 5: human-readable pacing labels for the answer-review screen (Story 5.4).
 *
 * Examples: 0 → "0s", 45 → "45s", 60 → "1m", 135 → "2m 15s".
 */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (remainder === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remainder}s`;
}
