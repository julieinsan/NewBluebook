"use client";

import { resultsPath } from "@/lib/testFlow";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { postSubmit } from "../_lib/clientApi";

export interface SubmittedScreenProps {
  attemptId: number;
}

export function SubmittedScreen({ attemptId }: SubmittedScreenProps) {
  const router = useRouter();
  const submittedRef = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitError(null);
    void postSubmit(attemptId)
      .then(() => {
        router.push(resultsPath(attemptId));
      })
      .catch((err) => {
        console.error("Failed to finalize submit:", err);
        submittedRef.current = false;
        setSubmitError(err instanceof Error ? err.message : "Failed to submit test");
      });
  }, [attemptId, router]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-16 text-center"
      data-testid="submitted-screen"
    >
      <h1 className="text-2xl font-semibold">Test submitted</h1>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-foreground/80">
        {submitError
          ? submitError
          : "Your practice test has been submitted. Calculating your results…"}
      </p>
      {submitError && (
        <button
          type="button"
          className="mt-6 rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-foreground"
          onClick={() => {
            submittedRef.current = false;
            setSubmitError(null);
          }}
        >
          Retry
        </button>
      )}
      <p className="mt-6 text-xs text-foreground/50">Attempt #{attemptId}</p>
    </div>
  );
}
