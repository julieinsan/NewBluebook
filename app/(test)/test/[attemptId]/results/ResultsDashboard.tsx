import { BLUEPRINT, type Section } from "@/lib/blueprint";
import type { AttemptScores, DomainRawScore } from "@/lib/scoring";
import { answerReviewPath } from "@/lib/testFlow";
import Link from "next/link";

export interface ResultsDashboardProps {
  scores: AttemptScores;
  attemptId: number;
}

const SECTION_LABELS: Record<Section, string> = {
  rw: "Reading and Writing",
  math: "Math",
};

export function domainBenchmarkLabel(correct: number, total: number): string {
  if (total === 0) return "At benchmark";
  const pct = (correct / total) * 100;
  if (pct >= 70) return "Above benchmark";
  if (pct >= 50) return "At benchmark";
  return "Below benchmark";
}

function DomainRow({ domain }: { domain: DomainRawScore }) {
  const pct = domain.total > 0 ? (domain.correct / domain.total) * 100 : 0;

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm font-medium">{domain.domain}</span>
        <span className="shrink-0 text-xs text-foreground/70">
          {domain.correct}/{domain.total} · {domainBenchmarkLabel(domain.correct, domain.total)}
        </span>
      </div>
      <div
        className="h-2 w-full rounded-sm bg-foreground/10"
        role="progressbar"
        aria-valuenow={domain.correct}
        aria-valuemin={0}
        aria-valuemax={domain.total}
        aria-label={`${domain.domain}: ${domain.correct} of ${domain.total} correct`}
      >
        <div
          className="h-full rounded-sm bg-accent"
          style={{ width: `${pct}%` }}
        />
      </div>
    </li>
  );
}

function DomainSection({ section, domains }: { section: Section; domains: DomainRawScore[] }) {
  const orderedDomains = BLUEPRINT[section].domains.map(({ domain }) =>
    domains.find((row) => row.domain === domain),
  ).filter((row): row is DomainRawScore => row != null);

  return (
    <section className="text-left">
      <h2 className="text-sm font-semibold">{SECTION_LABELS[section]}</h2>
      <ul className="mt-2 divide-y divide-foreground/10">
        {orderedDomains.map((domain) => (
          <DomainRow key={`${domain.section}-${domain.domain}`} domain={domain} />
        ))}
      </ul>
    </section>
  );
}

export function ResultsDashboard({ scores, attemptId }: ResultsDashboardProps) {
  const rwDomains = scores.raw.domains.filter((row) => row.section === "rw");
  const mathDomains = scores.raw.domains.filter((row) => row.section === "math");

  return (
    <div
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-12"
      data-testid="results-dashboard"
    >
      <header className="text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-foreground/60">
          Practice test results
        </p>
        <p className="mt-4 text-5xl font-semibold tabular-nums">{scores.totalScaled}</p>
        <p className="mt-2 text-sm text-foreground/70">Total score (400–1600)</p>
        <p
          className="mx-auto mt-4 max-w-md text-xs leading-relaxed text-foreground/60"
          data-testid="approximate-disclaimer"
        >
          Scores are approximate and are not official College Board equating. They are intended
          to give a general sense of performance, not an exact SAT score.
        </p>
      </header>

      <section className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-lg border border-foreground/10 px-5 py-4 text-center">
          <p className="text-3xl font-semibold tabular-nums">{scores.rwScaled}</p>
          <p className="mt-1 text-sm text-foreground/70">Reading and Writing (200–800)</p>
        </div>
        <div className="rounded-lg border border-foreground/10 px-5 py-4 text-center">
          <p className="text-3xl font-semibold tabular-nums">{scores.mathScaled}</p>
          <p className="mt-1 text-sm text-foreground/70">Math (200–800)</p>
        </div>
      </section>

      <section className="flex flex-col gap-8">
        <h2 className="text-center text-sm font-semibold">Domain performance</h2>
        <DomainSection section="rw" domains={rwDomains} />
        <DomainSection section="math" domains={mathDomains} />
      </section>

      <nav className="flex flex-col items-center gap-4 pt-4 sm:flex-row sm:justify-center">
        <Link
          href={answerReviewPath(attemptId)}
          className="rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-accent-foreground"
        >
          Review answers
        </Link>
        <Link href="/" className="text-sm font-medium text-accent hover:underline">
          Back to home
        </Link>
      </nav>
    </div>
  );
}
