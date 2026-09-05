/**
 * Story 1.3: automated sanity checks over the imported question bank.
 *
 * Prints counts by section/domain/skill/difficulty (to eyeball against PRD.md
 * Section 3.1), and flags concrete data problems: missing rationale, an mc
 * question whose correct_answer doesn't match a real choice, and orphaned figure
 * assets (either a DB row pointing at a missing file, or a file under
 * public/figures/math with no row referencing it).
 *
 * Exits non-zero if any flag fires, so it can gate CI later.
 *
 * Usage: `npm run qa:questions`
 */
import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "../lib/db";

interface QuestionRow {
  id: string;
  section: string;
  domain: string;
  skill: string;
  difficulty: string;
  question_type: string;
  stimulus_text: string;
  choice_a: string | null;
  choice_b: string | null;
  choice_c: string | null;
  choice_d: string | null;
  correct_answer: string;
  rationale: string | null;
  figure_asset_path: string | null;
}

function main() {
  const db = openDatabase();
  const issues: string[] = [];

  try {
    const rows = db.prepare("SELECT * FROM questions ORDER BY section, domain, skill").all() as QuestionRow[];

    console.log(`Total questions: ${rows.length}\n`);

    console.log("By section / domain / skill:");
    const bySection = new Map<string, Map<string, Map<string, number>>>();
    for (const r of rows) {
      const bySkill = bySection.get(r.section) ?? new Map<string, Map<string, number>>();
      bySection.set(r.section, bySkill);
      const byDomain = bySkill.get(r.domain) ?? new Map<string, number>();
      bySkill.set(r.domain, byDomain);
      byDomain.set(r.skill, (byDomain.get(r.skill) ?? 0) + 1);
    }
    for (const [section, byDomain] of [...bySection].sort()) {
      let sectionTotal = 0;
      console.log(`  ${section}:`);
      for (const [domain, bySkill] of [...byDomain].sort()) {
        const domainTotal = [...bySkill.values()].reduce((a, b) => a + b, 0);
        sectionTotal += domainTotal;
        console.log(`    ${domain}: ${domainTotal}`);
        for (const [skill, count] of [...bySkill].sort()) {
          console.log(`      - ${skill}: ${count}`);
        }
      }
      console.log(`    (section total: ${sectionTotal})`);
    }

    console.log("\nBy difficulty:");
    const byDifficulty = new Map<string, number>();
    for (const r of rows) byDifficulty.set(r.difficulty, (byDifficulty.get(r.difficulty) ?? 0) + 1);
    for (const [d, c] of [...byDifficulty].sort()) console.log(`  ${d}: ${c}`);

    // --- Flags ---

    for (const r of rows) {
      const ctx = `[${r.section}/${r.id}]`;

      if (!r.rationale?.trim()) issues.push(`${ctx} missing rationale`);
      if (!r.stimulus_text?.trim()) issues.push(`${ctx} missing stimulus_text`);
      if (!r.correct_answer?.trim()) issues.push(`${ctx} missing correct_answer`);

      const choices: Record<string, string | null> = {
        A: r.choice_a,
        B: r.choice_b,
        C: r.choice_c,
        D: r.choice_d,
      };

      if (r.question_type === "mc") {
        for (const [letter, text] of Object.entries(choices)) {
          if (!text?.trim()) issues.push(`${ctx} mc question missing choice ${letter}`);
        }
        if (!["A", "B", "C", "D"].includes(r.correct_answer)) {
          issues.push(`${ctx} correct_answer "${r.correct_answer}" is not one of A/B/C/D`);
        }
      } else if (r.question_type === "grid_in") {
        for (const [letter, text] of Object.entries(choices)) {
          if (text !== null) issues.push(`${ctx} grid_in question has non-null choice ${letter}`);
        }
      } else {
        issues.push(`${ctx} unrecognized question_type "${r.question_type}"`);
      }

      if (r.figure_asset_path) {
        const full = path.join(process.cwd(), "public", r.figure_asset_path.replace(/^\//, ""));
        if (!fs.existsSync(full)) {
          issues.push(`${ctx} figure_asset_path "${r.figure_asset_path}" does not point to an existing file`);
        }
      }
    }

    // Orphaned figure files: present on disk, but no DB row references them.
    const figuresDir = path.join(process.cwd(), "public", "figures", "math");
    if (fs.existsSync(figuresDir)) {
      const referenced = new Set(
        rows.filter((r) => r.figure_asset_path).map((r) => path.basename(r.figure_asset_path!)),
      );
      for (const file of fs.readdirSync(figuresDir)) {
        if (!referenced.has(file)) {
          issues.push(`orphaned figure asset: public/figures/math/${file} (no question references it)`);
        }
      }
    }

    console.log(`\n${issues.length === 0 ? "No issues found." : `${issues.length} issue(s) found:`}`);
    for (const issue of issues) console.log(`  - ${issue}`);
  } finally {
    db.close();
  }

  if (issues.length > 0) process.exitCode = 1;
}

main();
