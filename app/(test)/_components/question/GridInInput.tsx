"use client";

export interface GridInInputProps {
  value: string | null;
  onChange?: (value: string) => void;
  disabled?: boolean;
}

export function GridInInput({ value, onChange, disabled = false }: GridInInputProps) {
  return (
    <label className="mt-4 block max-w-xs">
      <span className="mb-2 block text-sm font-medium">Your answer</span>
      <input
        type="text"
        inputMode="decimal"
        className="w-full rounded-md border border-foreground/20 px-3 py-2 text-sm"
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
        aria-label="Grid-in answer"
      />
    </label>
  );
}
