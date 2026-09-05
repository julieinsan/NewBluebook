"use client";

import { useEffect, useState } from "react";
import { breakDeadline, secondsRemaining } from "@/lib/testFlow";

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export interface BreakCountdownProps {
  breakStartedAt: string;
  serverNow: number;
  onExpire?: () => void;
  onResume?: () => void;
}

export function BreakCountdown({
  breakStartedAt,
  serverNow,
  onExpire,
  onResume,
}: BreakCountdownProps) {
  const deadline = breakDeadline(breakStartedAt);
  const [remaining, setRemaining] = useState(() => secondsRemaining(deadline, serverNow));

  useEffect(() => {
    const offset = Date.now() - serverNow;
    const tick = () => {
      const next = secondsRemaining(deadline, Date.now() - offset);
      setRemaining(next);
      if (next === 0) onExpire?.();
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [deadline, onExpire, serverNow]);

  return (
    <section className="mx-auto flex max-w-lg flex-col items-center gap-6 px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold">Take a Break</h1>
      <p className="text-sm leading-relaxed text-foreground/80">
        You may resume testing when you are ready. The break timer is advisory.
      </p>
      <time className="font-mono text-4xl tabular-nums" aria-live="polite">
        {formatCountdown(remaining)}
      </time>
      <button
        type="button"
        className="rounded-full bg-accent px-6 py-3 text-sm font-medium text-accent-foreground"
        onClick={onResume}
      >
        Resume testing
      </button>
    </section>
  );
}
