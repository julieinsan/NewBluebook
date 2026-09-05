import { listDrillDomainOptions } from "@/lib/drillService";
import { getDb } from "@/lib/db";
import Link from "next/link";
import { connection } from "next/server";
import { DrillPicker } from "./DrillPicker";

export default async function DrillPickerPage() {
  await connection();
  const domains = listDrillDomainOptions(getDb());

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-foreground/10 px-6">
        <Link href="/" className="text-sm font-medium text-accent hover:underline">
          Back to home
        </Link>
        <span className="text-sm font-semibold">Drill mode</span>
        <span className="w-20" aria-hidden />
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-6 py-12">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Targeted practice</h1>
          <p className="mt-3 text-sm leading-relaxed text-foreground/70">
            Choose a domain, skill, and difficulty. Drill sessions are untimed with instant
            feedback after each question.
          </p>
        </div>
        <DrillPicker domains={domains} />
      </main>
    </div>
  );
}
