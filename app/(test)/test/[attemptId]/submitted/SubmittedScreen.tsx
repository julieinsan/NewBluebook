"use client";

import { useEffect, useRef } from "react";
import { postSubmit } from "../_lib/clientApi";

export interface SubmittedScreenProps {
  attemptId: number;
}

export function SubmittedScreen({ attemptId }: SubmittedScreenProps) {
  const submittedRef = useRef(false);

  useEffect(() => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    void postSubmit(attemptId).catch((err) => {
      console.error("Failed to finalize submit:", err);
      submittedRef.current = false;
    });
  }, [attemptId]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-16 text-center"
      data-testid="submitted-screen"
    >
      <h1 className="text-2xl font-semibold">Test submitted</h1>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-foreground/80">
        Your practice test has been submitted. Scoring and review will be available in a
        future update.
      </p>
      <p className="mt-6 text-xs text-foreground/50">Attempt #{attemptId}</p>
    </div>
  );
}
