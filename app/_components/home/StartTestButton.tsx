"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postStartAttempt } from "@/app/(test)/test/[attemptId]/_lib/clientApi";

export interface StartTestButtonProps {
  /** When true, an in-progress attempt exists — D9 forbids starting a second one. */
  hasResumableAttempt?: boolean;
  /** When true, the resumable attempt is paused rather than actively running. */
  resumableIsPaused?: boolean;
}

export function StartTestButton({
  hasResumableAttempt = false,
  resumableIsPaused = false,
}: StartTestButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const { next } = await postStartAttempt();
      router.push(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start test");
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        disabled={loading || hasResumableAttempt}
        onClick={() => void handleStart()}
        className="rounded-full bg-accent px-6 py-2 text-sm font-medium text-accent-foreground disabled:opacity-60"
      >
        {loading ? "Starting…" : "Start new test"}
      </button>
      {hasResumableAttempt && (
        <p className="max-w-sm text-xs text-foreground/70">
          {resumableIsPaused
            ? "You have a paused test. Resume it below when you are ready to continue."
            : "You have a test in progress. Resume it below to continue where you left off."}
        </p>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
