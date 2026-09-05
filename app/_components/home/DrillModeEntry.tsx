import Link from "next/link";

export function DrillModeEntry() {
  return (
    <Link
      href="/drill"
      className="rounded-full border border-accent/40 bg-background px-6 py-2 text-sm font-medium text-accent hover:bg-accent/5"
    >
      Drill mode
    </Link>
  );
}
