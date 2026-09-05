"use client";

import { useEffect, useRef, useState } from "react";

export interface MoreMenuProps {
  onPauseAndExit?: () => void;
}

export function MoreMenu({ onPauseAndExit }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-foreground/20 hover:bg-background-subtle"
        aria-label="More options"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 min-w-[10rem] rounded-lg border border-foreground/10 bg-background py-1 shadow-sm"
        >
          <button
            type="button"
            role="menuitem"
            className="block w-full px-4 py-2 text-left text-sm hover:bg-background-subtle"
            onClick={() => {
              setOpen(false);
              onPauseAndExit?.();
            }}
          >
            Pause and exit
          </button>
        </div>
      )}
    </div>
  );
}
