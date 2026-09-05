/**
 * Ingests the 120 SAT Math questions (Story 1.2) into the `questions` table.
 *
 * Unlike the R&W bank, the Math PDF's font/ToUnicode CMap is broken, so plain-text
 * extraction loses every number, variable, and equation. Instead, the questions were
 * hand-transcribed by reading rendered page images directly (in four parallel page
 * ranges) into `data/seed/math-part-{1..4}.json`, including figures cropped to
 * `public/figures/math/<id>.png`. This script only merges, validates, and loads
 * those already-transcribed JSON parts -- it does no PDF parsing of its own.
 *
 * Re-runnable/idempotent: deletes existing `section = 'math'` rows and reloads from
 * the JSON parts each time (mirrors ingest-rw.ts's clear-and-reload pattern), scoped
 * to `section = 'math'` so it never touches R&W rows from the sibling ingestion story.
 *
 * Usage: `npm run ingest:math`
 */
import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "../lib/db";

const SEED_DIR = path.join(process.cwd(), "data", "seed");
const PART_FILES = ["math-part-1.json", "math-part-2.json", "math-part-3.json", "math-part-4.json"];

const DOMAIN_SKILLS: Record<string, string[]> = {
  Algebra: [
    "Linear equations in one variable",
    "Linear equations in two variables",
    "Linear functions",
    "Linear inequalities in one or two variables",
    "Systems of two linear equations in two variables",
  ],
  "Advanced Math": [
    "Equivalent expressions",
    "Nonlinear equations in one variable and systems of equations in two variables",
    "Nonlinear functions",
  ],
  "Problem-Solving and Data Analysis": [
    "Inference from sample statistics and margin of error",
    "One-variable data: Distributions and measures of center and spread",
    "Percentages",
    "Probability and conditional probability",
    "Ratios, rates, proportional relationships, and units",
    "Two-variable data: Models and scatterplots",
  ],
  "Geometry and Trigonometry": ["Area and volume", "Circles", "Lines, angles, and triangles", "Right triangles and trigonometry"],
};
const DOMAINS = Object.keys(DOMAIN_SKILLS);
const DIFFICULTIES = new Set(["easy", "medium", "hard"]);
const ID_RE = /^[0-9a-f]{8}$/;

interface QuestionRecord {
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
  rationale: string;
  figure_asset_path: string | null;
}

function loadPart(file: string): QuestionRecord[] {
  const full = path.join(SEED_DIR, file);
  const raw = JSON.parse(fs.readFileSync(full, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`${file}: expected a JSON array, got ${typeof raw}`);
  return raw as QuestionRecord[];
}

function validate(records: QuestionRecord[]): void {
  if (records.length !== 120) {
    throw new Error(`Expected exactly 120 questions across all parts, got ${records.length}.`);
  }
  const idSet = new Set(records.map((r) => r.id));
  if (idSet.size !== records.length) {
    throw new Error(`Duplicate question IDs found (${records.length - idSet.size} duplicate(s)).`);
  }

  for (const r of records) {
    const ctx = `question ${r.id}`;
    if (!ID_RE.test(r.id)) throw new Error(`${ctx}: id is not 8-char lowercase hex`);
    if (r.section !== "math") throw new Error(`${ctx}: section must be "math", got "${r.section}"`);
    if (!DOMAINS.includes(r.domain)) throw new Error(`${ctx}: unrecognized domain "${r.domain}"`);
    if (!DOMAIN_SKILLS[r.domain].includes(r.skill)) {
      throw new Error(`${ctx}: unrecognized skill "${r.skill}" for domain "${r.domain}"`);
    }
    if (!DIFFICULTIES.has(r.difficulty)) throw new Error(`${ctx}: invalid difficulty "${r.difficulty}"`);
    if (!["mc", "grid_in"].includes(r.question_type)) {
      throw new Error(`${ctx}: invalid question_type "${r.question_type}"`);
    }
    if (!r.stimulus_text?.trim()) throw new Error(`${ctx}: empty stimulus_text`);
    if (!r.correct_answer?.trim()) throw new Error(`${ctx}: empty correct_answer`);
    if (!r.rationale?.trim()) throw new Error(`${ctx}: empty rationale`);

    const choices = [r.choice_a, r.choice_b, r.choice_c, r.choice_d];
    if (r.question_type === "mc") {
      if (choices.some((c) => !c?.trim())) throw new Error(`${ctx}: mc question missing a choice`);
      if (!["A", "B", "C", "D"].includes(r.correct_answer)) {
        throw new Error(`${ctx}: mc correct_answer "${r.correct_answer}" is not A/B/C/D`);
      }
    } else {
      if (choices.some((c) => c !== null)) throw new Error(`${ctx}: grid_in question has non-null choices`);
    }

    if (r.figure_asset_path) {
      const assetFull = path.join(process.cwd(), "public", r.figure_asset_path.replace(/^\//, ""));
      if (!fs.existsSync(assetFull)) {
        throw new Error(`${ctx}: figure_asset_path "${r.figure_asset_path}" does not point to an existing file`);
      }
    }
  }
}

function main() {
  const records = PART_FILES.flatMap(loadPart);
  console.log(`Loaded ${records.length} question(s) from ${PART_FILES.length} part file(s).`);

  validate(records);
  console.log("Validation passed.");

  const byDomain = new Map<string, number>();
  const byType = new Map<string, number>();
  for (const r of records) {
    byDomain.set(r.domain, (byDomain.get(r.domain) ?? 0) + 1);
    byType.set(r.question_type, (byType.get(r.question_type) ?? 0) + 1);
  }
  for (const [d, c] of byDomain) console.log(`  - ${d}: ${c}`);
  for (const [t, c] of byType) console.log(`  - ${t}: ${c}`);

  const db = openDatabase();
  try {
    const insert = db.prepare(
      `INSERT INTO questions
         (id, section, domain, skill, difficulty, question_type, stimulus_text,
          choice_a, choice_b, choice_c, choice_d, correct_answer, rationale, figure_asset_path)
       VALUES
         (@id, 'math', @domain, @skill, @difficulty, @question_type, @stimulus_text,
          @choice_a, @choice_b, @choice_c, @choice_d, @correct_answer, @rationale, @figure_asset_path)`,
    );

    const reload = db.transaction((rows: QuestionRecord[]) => {
      // Clear-and-reload keeps this idempotent: running the script again always
      // leaves section='math' matching the seed JSON exactly, with no accumulating
      // duplicates. Scoped to section='math' so R&W rows (a separate Epic 1
      // ingestion) are untouched.
      db.prepare("DELETE FROM questions WHERE section = 'math'").run();
      for (const r of rows) {
        insert.run({
          id: r.id,
          domain: r.domain,
          skill: r.skill,
          difficulty: r.difficulty,
          question_type: r.question_type,
          stimulus_text: r.stimulus_text,
          choice_a: r.choice_a,
          choice_b: r.choice_b,
          choice_c: r.choice_c,
          choice_d: r.choice_d,
          correct_answer: r.correct_answer,
          rationale: r.rationale,
          figure_asset_path: r.figure_asset_path,
        });
      }
    });
    reload(records);

    const { count } = db
      .prepare("SELECT COUNT(*) AS count FROM questions WHERE section = 'math'")
      .get() as { count: number };
    console.log(`questions (section='math') now has ${count} row(s).`);
  } finally {
    db.close();
  }
}

main();
