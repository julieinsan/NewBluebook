"use client";

import { useEffect, useState } from "react";
import { secondsRemaining } from "@/lib/testFlow";
import type { Section } from "@/lib/blueprint";
import type { ModuleNumber } from "@/lib/blueprint";
import type { TimerInfo } from "@/lib/testFlow";

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function sectionLabel(section: Section): string {
  return section === "rw" ? "Reading and Writing" : "Math";
}

export interface TopBarProps {
  section: Section;
  module: ModuleNumber;
  timer: TimerInfo;
  timerVisible?: boolean;
  onTimerVisibilityChange?: (visible: boolean) => void;
  onMoreMenuClick?: () => void;
}

export function TopBar({
  section,
  module,
  timer,
  timerVisible: timerVisibleProp = true,
  onTimerVisibilityChange,
  onMoreMenuClick,
}: TopBarProps) {
  const [timerVisible, setTimerVisible] = useState(timerVisibleProp);

  const [remaining, setRemaining] = useState(() =>
    secondsRemaining(timer.deadline, timer.serverNow),
  );

  useEffect(() => {
    const offset = Date.now() - timer.serverNow;
    const tick = () => {
      setRemaining(secondsRemaining(timer.deadline, Date.now() - offset));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [timer.deadline, timer.serverNow]);

  return (
    <header
      className="flex h-14 shrink-0 items-center border-b border-foreground/10 bg-background px-4"
      data-testid="top-bar"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-foreground/20 text-xs font-semibold"
          aria-hidden
        >
          BB
        </span>
        <p className="truncate text-sm font-medium">
          {sectionLabel(section)} &middot; Module {module}
        </p>
      </div>

      <div className="flex flex-1 justify-center">
        {timerVisible ? (
          <time
            className="font-mono text-sm tabular-nums"
            aria-live="polite"
            aria-label="Time remaining"
          >
            {formatCountdown(remaining)}
          </time>
        ) : (
          <span className="text-sm text-foreground/50" aria-hidden>Timer hidden</span>
        )}
      </div>

      <div className="flex flex-1 items-center justify-end gap-2">
        <button
          type="button"
          className="rounded-full border border-foreground/20 px-3 py-1 text-xs font-medium hover:bg-background-subtle"
          onClick={() => {
            const next = !timerVisible;
            setTimerVisible(next);
            onTimerVisibilityChange?.(next);
          }}
          aria-pressed={timerVisible}
        >
          {timerVisible ? "Hide" : "Show"} timer
        </button>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-foreground/20 hover:bg-background-subtle"
          aria-label="More options"
          onClick={onMoreMenuClick}
        >
          ⋯
        </button>
      </div>
    </header>
  );
}
