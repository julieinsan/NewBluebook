"use client";

import { BreakCountdown } from "@/app/(test)/_components/BreakCountdown";
import type { TimerInfo } from "@/lib/testFlow";
import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";
import { postEndBreak } from "../_lib/clientApi";

export interface BreakScreenProps {
  attemptId: number;
  timer: TimerInfo;
}

export function BreakScreen({ attemptId, timer }: BreakScreenProps) {
  const router = useRouter();
  const endingRef = useRef(false);

  const endBreak = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    try {
      const { next } = await postEndBreak(attemptId);
      router.push(next);
    } catch (err) {
      console.error("Failed to end break:", err);
      endingRef.current = false;
    }
  }, [attemptId, router]);

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center" data-testid="break-screen">
      <BreakCountdown
        attemptId={attemptId}
        timer={timer}
        onResume={() => void endBreak()}
        onExpire={() => void endBreak()}
      />
    </div>
  );
}
