"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postStartAttempt } from "@/app/(test)/test/[attemptId]/_lib/clientApi";

export function StartTestButton() {
  const router = useRouter();
  const [loadingTest, setLoadingTest] = useState<1 | 2 | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async (practiceTest: 1 | 2) => {
    if (loadingTest !== null) return;
    setLoadingTest(practiceTest);
    setError(null);
    try {
      const { next } = await postStartAttempt(practiceTest);
      router.push(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start test");
      setLoadingTest(null);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          disabled={loadingTest !== null}
          onClick={() => void handleStart(1)}
          className="rounded-full bg-accent px-6 py-2 text-sm font-medium text-accent-foreground disabled:opacity-60"
        >
          {loadingTest === 1 ? "Starting…" : "Practice Test 1"}
        </button>
        <button
          type="button"
          disabled={loadingTest !== null}
          onClick={() => void handleStart(2)}
          className="rounded-full border border-accent/40 bg-background px-6 py-2 text-sm font-medium text-accent disabled:opacity-60"
        >
          {loadingTest === 2 ? "Starting…" : "Practice Test 2"}
        </button>
      </div>
      <p className="max-w-md text-xs text-foreground/70">
        Practice Test 2 prefers questions you have not seen in Test 1. You can start either
        test even if another is in progress — resume in-progress tests below.
      </p>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
