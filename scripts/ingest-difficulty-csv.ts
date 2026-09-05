/**
 * Ingests `Copy of difficulty_changes.csv` into the `difficulty_recalibrations` table
 * (Story 1.4). This is standalone reference data — not foreign-keyed to `questions`,
 * since the CSV's question IDs don't overlap with the current bank (see
 * migrations/0007_create_difficulty_recalibrations.sql).
 *
 * Re-runnable/idempotent: clears the table and reloads from the CSV each time, so
 * running it twice (or after the CSV changes) never creates duplicates.
 *
 * Usage: `npm run ingest:difficulty`
 */
import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "../lib/db";

const CSV_PATH = path.join(process.cwd(), "Copy of difficulty_changes.csv");

const VALID_DIFFICULTIES = new Set(["easy", "medium", "hard"]);

interface Row {
  questionId: string;
  previousDifficulty: string;
  newDifficulty: string;
  topic: string;
  domain: string;
  skill: string;
}

/** Parses a single CSV line into fields, honoring double-quoted fields that may
 * contain commas (e.g. `"Form, Structure, and Sense"`). Doesn't handle escaped
 * quotes (`""`) since the source file doesn't use them, but is otherwise a real
 * CSV-field parser rather than a naive `split(",")`. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function loadRows(): Row[] {
  // strip a leading UTF-8 BOM if present (the source file has one on its header line)
  const raw = fs.readFileSync(CSV_PATH, "utf-8").replace(/^﻿/, "");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);

  const [headerLine, ...dataLines] = lines;
  const header = parseCsvLine(headerLine).map((h) => h.trim());
  const expectedHeader = ["ID", "Previous Difficulty", "New Difficulty", "Topic", "Domain", "Skill"];
  if (header.join(",") !== expectedHeader.join(",")) {
    throw new Error(
      `Unexpected CSV header. Expected ${JSON.stringify(expectedHeader)}, got ${JSON.stringify(header)}`,
    );
  }

  return dataLines.map((line, idx) => {
    const fields = parseCsvLine(line);
    if (fields.length !== 6) {
      throw new Error(`Row ${idx + 2}: expected 6 fields, got ${fields.length} (${JSON.stringify(line)})`);
    }
    // Trim every field — the source CSV has a few Skill values with trailing
    // whitespace (e.g. "Nonlinear equations in one variable and systems of
    // equations in two variables "), which would otherwise break exact-match
    // lookups against this column later.
    const [questionId, previousDifficulty, newDifficulty, topic, domain, skill] = fields.map((f) => f.trim());
    return { questionId, previousDifficulty, newDifficulty, topic, domain, skill };
  });
}

function toDbDifficulty(value: string, rowContext: string): string {
  const lower = value.toLowerCase();
  if (!VALID_DIFFICULTIES.has(lower)) {
    throw new Error(`${rowContext}: unrecognized difficulty value "${value}"`);
  }
  return lower;
}

function main() {
  const rows = loadRows();
  console.log(`Parsed ${rows.length} row(s) from ${CSV_PATH}`);

  const byTopic = new Map<string, number>();
  for (const row of rows) {
    byTopic.set(row.topic, (byTopic.get(row.topic) ?? 0) + 1);
  }
  for (const [topic, count] of byTopic) {
    console.log(`  - ${topic}: ${count}`);
  }

  const db = openDatabase();
  try {
    const insert = db.prepare(
      `INSERT INTO difficulty_recalibrations
         (question_id, previous_difficulty, new_difficulty, domain, skill)
       VALUES (@question_id, @previous_difficulty, @new_difficulty, @domain, @skill)`,
    );

    const reload = db.transaction((rowsToInsert: Row[]) => {
      // Clear-and-reload keeps this idempotent: running the script again (e.g. after
      // the CSV is corrected) always leaves the table matching the CSV exactly, with
      // no risk of accumulating duplicate rows across runs.
      db.prepare("DELETE FROM difficulty_recalibrations").run();

      for (const row of rowsToInsert) {
        const rowContext = `question_id=${row.questionId}`;
        insert.run({
          question_id: row.questionId,
          previous_difficulty: toDbDifficulty(row.previousDifficulty, rowContext),
          new_difficulty: toDbDifficulty(row.newDifficulty, rowContext),
          domain: row.domain,
          skill: row.skill,
        });
      }
    });

    reload(rows);

    const { count } = db
      .prepare("SELECT COUNT(*) AS count FROM difficulty_recalibrations")
      .get() as { count: number };
    console.log(`difficulty_recalibrations now has ${count} row(s).`);
  } finally {
    db.close();
  }
}

main();
