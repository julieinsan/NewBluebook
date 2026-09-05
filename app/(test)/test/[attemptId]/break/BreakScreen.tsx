"use client";

import { BreakCountdown } from "@/app/(test)/_components/BreakCountdown";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { postEndBreak } from "../_lib/clientApi";

export interface BreakScreenProps {
  attemptId: number;
  breakStartedAt: string;
}

export function BreakScreen({ attemptId, breakStartedAt }: BreakScreenProps) {
  const router = useRouter();
  const endingRef = useRef(false);
  const [serverNow] = useState(() => Date.now());

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
        breakStartedAt={breakStartedAt}
        serverNow={serverNow}
        onResume={() => void endBreak()}
        onExpire={() => void endBreak()}
      />
    </div>
  );
}
