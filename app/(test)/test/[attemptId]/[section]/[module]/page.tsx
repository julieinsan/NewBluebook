import { getRunnerModule } from "@/lib/attemptState";
import type { ModuleNumber, Section } from "@/lib/blueprint";
import { getDb } from "@/lib/db";
import { reviewPath } from "@/lib/testFlow";
import { notFound, redirect } from "next/navigation";
import { guardModuleRunner } from "../../_lib/guardPosition";
import { ModuleRunner } from "./ModuleRunner";

function parseAttemptId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

function parseSection(raw: string): Section | null {
  return raw === "rw" || raw === "math" ? raw : null;
}

function parseModule(raw: string): ModuleNumber | null {
  return raw === "1" || raw === "2" ? Number(raw) as ModuleNumber : null;
}

export default async function RunnerPage({
  params,
}: {
  params: Promise<{ attemptId: string; section: string; module: string }>;
}) {
  const { attemptId: rawId, section: rawSection, module: rawModule } = await params;

  const attemptId = parseAttemptId(rawId);
  const section = parseSection(rawSection);
  const moduleNum = parseModule(rawModule);

  if (attemptId == null || section == null || moduleNum == null) {
    notFound();
  }

  await guardModuleRunner(attemptId, section, moduleNum);

  const db = getDb();
  let runnerModule;
  try {
    runnerModule = getRunnerModule(db, attemptId, section, moduleNum);
  } catch (err) {
    if (err instanceof Error && /does not exist/.test(err.message)) {
      notFound();
    }
    if (
      err instanceof Error &&
      moduleNum === 2 &&
      (/no started_at stamp/.test(err.message) || /not been served yet/.test(err.message))
    ) {
      // Module 1 was submitted but the Module 2 transition did not finish — send the
      // student to review so an idempotent end-module can repair the row.
      redirect(reviewPath(attemptId));
    }
    throw err;
  }

  return <ModuleRunner runnerModule={runnerModule} />;
}
