"use client";

export interface ChoiceRowProps {
  letter: "A" | "B" | "C" | "D";
  text: string;
  selected?: boolean;
  flagged?: boolean;
  crossedOut?: boolean;
  onSelect?: () => void;
  onToggleFlag?: () => void;
  onToggleCrossOut?: () => void;
}

export function ChoiceRow({
  letter,
  text,
  selected = false,
  flagged = false,
  crossedOut = false,
  onSelect,
  onToggleFlag,
  onToggleCrossOut,
}: ChoiceRowProps) {
  return (
    <div className="flex items-stretch gap-2" data-testid={`choice-row-${letter}`}>
      <button
        type="button"
        className="inline-flex w-10 shrink-0 items-center justify-center rounded-full border border-foreground/20 text-xs text-foreground/40 hover:bg-background-subtle"
        aria-label={`Cross out choice ${letter}`}
        aria-pressed={crossedOut}
        onClick={onToggleCrossOut}
      >
        {crossedOut ? "✕" : ""}
      </button>

      <button
        type="button"
        className={`flex min-h-12 flex-1 items-center gap-3 rounded-full border px-4 py-3 text-left text-sm leading-relaxed ${
          selected
            ? "border-accent bg-accent/5"
            : crossedOut
              ? "border-foreground/10 text-foreground/40 line-through"
              : "border-foreground/20 hover:bg-background-subtle"
        }`}
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span
          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
            selected ? "border-accent bg-accent text-accent-foreground" : "border-foreground/30"
          }`}
        >
          {letter}
        </span>
        <span className="flex-1">{text}</span>
      </button>

      <button
        type="button"
        className="inline-flex w-10 shrink-0 items-center justify-center rounded-full border border-foreground/20 text-sm hover:bg-background-subtle"
        aria-label={flagged ? "Unflag question" : "Flag question"}
        aria-pressed={flagged}
        onClick={onToggleFlag}
      >
        {flagged ? "⚑" : "⚐"}
      </button>
    </div>
  );
}
