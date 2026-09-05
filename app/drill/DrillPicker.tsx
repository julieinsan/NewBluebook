"use client";

import type { DrillDomainOption } from "@/lib/drillContract";
import type { Difficulty } from "@/lib/blueprint";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { postStartDrillSession } from "./_lib/clientApi";

const DIFFICULTY_OPTIONS: Array<{ value: Difficulty | "any"; label: string }> = [
  { value: "any", label: "Any difficulty" },
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

const SECTION_LABELS = {
  rw: "Reading and Writing",
  math: "Math",
} as const;

export interface DrillPickerProps {
  domains: DrillDomainOption[];
}

export function DrillPicker({ domains }: DrillPickerProps) {
  const router = useRouter();
  const [domainKey, setDomainKey] = useState(
    () => `${domains[0]?.section ?? "rw"}:${domains[0]?.domain ?? ""}`,
  );
  const [skill, setSkill] = useState<string>("");
  const [difficulty, setDifficulty] = useState<Difficulty | "any">("any");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedDomain = useMemo(() => {
    const [section, domain] = domainKey.split(":");
    return domains.find((row) => row.section === section && row.domain === domain);
  }, [domainKey, domains]);

  const handleStart = async () => {
    if (!selectedDomain || loading) return;
    setLoading(true);
    setError(null);
    try {
      const { next } = await postStartDrillSession({
        domain: selectedDomain.domain,
        skill: skill === "" ? null : skill,
        difficulty,
      });
      router.push(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start drill session");
      setLoading(false);
    }
  };

  if (domains.length === 0) {
    return <p className="text-sm text-foreground/70">No questions available for drill mode.</p>;
  }

  return (
    <form
      className="flex flex-col gap-5 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        void handleStart();
      }}
    >
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium">Domain</span>
        <select
          className="rounded-md border border-foreground/20 bg-background px-3 py-2 text-sm"
          value={domainKey}
          onChange={(event) => {
            setDomainKey(event.target.value);
            setSkill("");
          }}
        >
          {domains.map((row) => (
            <option key={`${row.section}:${row.domain}`} value={`${row.section}:${row.domain}`}>
              {SECTION_LABELS[row.section]} · {row.domain}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium">Skill</span>
        <select
          className="rounded-md border border-foreground/20 bg-background px-3 py-2 text-sm"
          value={skill}
          onChange={(event) => setSkill(event.target.value)}
        >
          <option value="">Any skill</option>
          {selectedDomain?.skills.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium">Difficulty</span>
        <select
          className="rounded-md border border-foreground/20 bg-background px-3 py-2 text-sm"
          value={difficulty}
          onChange={(event) => setDifficulty(event.target.value as Difficulty | "any")}
        >
          {DIFFICULTY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={loading || !selectedDomain}
        className="mt-2 rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-accent-foreground disabled:opacity-60"
      >
        {loading ? "Starting…" : "Start drill"}
      </button>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </form>
  );
}
