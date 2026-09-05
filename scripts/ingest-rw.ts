/**
 * Ingests `Copy of new_rw_questions_with_answers.pdf` (150 SAT Reading & Writing
 * questions, Story 1.1) into the `questions` table.
 *
 * The PDF's text layer is clean and fully extractable, but `pdftotext`'s default
 * line/word grouping mishandles two things specific to this document, so this
 * script drives `pdftotext -bbox` (word-level bounding boxes) directly instead of
 * `-layout`:
 *
 *  1. Curly quotes, apostrophes, en/em dashes, and accented Latin letters (from
 *     foreign proper nouns, e.g. a citation author's name) are emitted with wildly
 *     inflated bounding boxes that straddle roughly two line-heights, which breaks
 *     naive line reconstruction (each one lands on its own bogus "line", sometimes
 *     even out of reading order in the raw text stream). Fixed in
 *     `reconstructLines` by detecting these glyphs by text content and reassigning
 *     each one to the real line whose vertical center it's closest to, then sorting
 *     every line's words by x-position (joining with no space where the horizontal
 *     gap is ~0, e.g. an opening quote glued to the next word).
 *  2. The per-question metadata table (Assessment/Test/Domain/Skill/Difficulty)
 *     sometimes wraps a long Domain or Skill value onto a second line within the
 *     same table cell (e.g. "Standard English" / "Conventions", or "Form,
 *     Structure, and" / "Sense" -- a layout artifact, not two fields). Fixed by
 *     reconstructing that block directly from word-level bounding boxes, bucketed
 *     by the table's fixed column x-ranges, rather than from a line of text.
 *
 * Requires poppler's `pdftotext` on PATH (`brew install poppler`).
 *
 * Re-runnable/idempotent: deletes existing `section = 'rw'` rows and reloads from
 * the PDF each time (mirrors ingest-difficulty-csv.ts's clear-and-reload pattern),
 * scoped to `section = 'rw'` so it never touches Math rows from the sibling
 * ingestion story.
 *
 * Usage: `npm run ingest:rw`
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { openDatabase } from "../lib/db";

const PDF_PATH = path.join(process.cwd(), "Copy of new_rw_questions_with_answers.pdf");

interface Word {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  text: string;
}

interface Line {
  page: number;
  yMin: number;
  yMax: number;
  text: string;
}

const DOMAIN_SKILLS: Record<string, string[]> = {
  "Information and Ideas": ["Command of Evidence", "Inferences", "Central Ideas and Details"],
  "Craft and Structure": ["Words in Context", "Text Structure and Purpose", "Cross-Text Connections"],
  "Expression of Ideas": ["Transitions", "Rhetorical Synthesis"],
  "Standard English Conventions": ["Boundaries", "Form, Structure, and Sense"],
};
const DOMAINS = Object.keys(DOMAIN_SKILLS);
const DIFFICULTIES = new Set(["Easy", "Medium", "Hard"]);
const LABEL_WORDS = new Set(["Assessment", "Test", "Domain", "Skill", "Difficulty"]);

// Metadata table column x-ranges (PDF points), stable across the whole document
// (a fixed, generated template -- verified against many sample pages). The
// Assessment/Test columns (x < 240) are skipped entirely: Assessment is always
// "SAT" and Test is always "Reading and Writing", and the schema doesn't store
// either.
const DOMAIN_COL: [number, number] = [240, 360];
const SKILL_COL: [number, number] = [360, 475];
const DIFFICULTY_COL: [number, number] = [475, Infinity];

// Below this vertical gap (pt) between two lines in the same block, treat it as
// a mid-paragraph word-wrap (join with a space); above it, a real blank-line
// paragraph break in the source (join with a blank line). Determined empirically:
// normal wrapped-line gaps cluster around 8.4-9.2pt, paragraph breaks around 17pt+.
const PARAGRAPH_GAP = 13;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function runPdftotextBbox(): string {
  try {
    return execFileSync("pdftotext", ["-bbox", PDF_PATH, "-"], {
      encoding: "utf8",
      maxBuffer: 100 * 1024 * 1024,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("pdftotext not found on PATH. Install poppler first: `brew install poppler`.");
    }
    throw err;
  }
}

/** Parses `pdftotext -bbox` output into a per-page array of word boxes. */
function parseWordsByPage(bboxXml: string): Word[][] {
  const pageRe = /<page width="[\d.]+" height="[\d.]+">([\s\S]*?)<\/page>/g;
  const wordRe = /<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([^<]*)<\/word>/g;

  const pages: Word[][] = [];
  let pageMatch: RegExpExecArray | null;
  while ((pageMatch = pageRe.exec(bboxXml))) {
    const words: Word[] = [];
    let wm: RegExpExecArray | null;
    wordRe.lastIndex = 0;
    while ((wm = wordRe.exec(pageMatch[1]))) {
      words.push({
        xMin: parseFloat(wm[1]),
        yMin: parseFloat(wm[2]),
        xMax: parseFloat(wm[3]),
        yMax: parseFloat(wm[4]),
        text: decodeEntities(wm[5]),
      });
    }
    pages.push(words);
  }
  return pages;
}

/**
 * Reconstructs visual lines of body text for one page from its word boxes. See
 * the module comment (point 1) for why stray punctuation needs special handling.
 */
function reconstructLines(words: Word[], page: number): Line[] {
  // Curly quotes/dashes plus Latin-1 Supplement / Latin Extended-A/B accented
  // letters (á, é, ñ, ü, ş, ı, ō, Č, ...) -- see the module comment (point 1).
  // Deliberately narrow (diacritics + this punctuation set, not "any short/tall
  // token") so it doesn't also catch ordinary short words in larger-font chart
  // titles, which have inflated height for a legitimate reason.
  const isStrayPunct = (w: Word) => /^[‘’“”–—À-ɏ]+$/.test(w.text);
  const normalWords = words.filter((w) => !isStrayPunct(w));
  const strayWords = words.filter(isStrayPunct);

  type LineAcc = { yMin: number; yMax: number; words: Word[] };
  const lines: LineAcc[] = [];
  for (const w of normalWords) {
    let line: LineAcc | undefined;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (Math.abs(lines[i].yMin - w.yMin) <= 2.5) {
        line = lines[i];
        break;
      }
      if (lines[i].yMin < w.yMin - 3) break;
    }
    if (!line) {
      line = { yMin: w.yMin, yMax: w.yMax, words: [] };
      lines.push(line);
    }
    line.words.push(w);
  }
  lines.sort((a, b) => a.yMin - b.yMin);

  // Reassign stray glyphs to the line whose vertical center they're nearest to.
  for (const w of strayWords) {
    const center = (w.yMin + w.yMax) / 2;
    let best: LineAcc | undefined;
    let bestDist = Infinity;
    for (const l of lines) {
      const d = Math.abs((l.yMin + l.yMax) / 2 - center);
      if (d < bestDist) {
        bestDist = d;
        best = l;
      }
    }
    if (best) best.words.push(w);
    else lines.push({ yMin: w.yMin, yMax: w.yMax, words: [w] });
  }

  return lines.map((l) => {
    l.words.sort((a, b) => a.xMin - b.xMin);
    let text = "";
    let prevXMax: number | null = null;
    for (const w of l.words) {
      text += prevXMax === null ? w.text : (w.xMin - prevXMax > 1.2 ? " " : "") + w.text;
      prevXMax = w.xMax;
    }
    return { page, yMin: l.yMin, yMax: l.yMax, text };
  });
}

/** Joins a block's lines into prose, distinguishing word-wraps from real
 * paragraph breaks by vertical gap (see `PARAGRAPH_GAP`). */
function joinBlock(lines: Line[]): string {
  let out = "";
  let prev: Line | null = null;
  for (const l of lines) {
    if (!prev) {
      out = l.text;
    } else if (prev.page === l.page && l.yMin - prev.yMax <= PARAGRAPH_GAP) {
      out += " " + l.text;
    } else {
      out += "\n\n" + l.text;
    }
    prev = l;
  }
  return out.trim();
}

interface QuestionRecord {
  id: string;
  domain: string;
  skill: string;
  difficulty: string;
  stimulus: string;
  choices: [string, string, string, string];
  correctAnswer: string;
  rationale: string;
}

function parseQuestions(pageWords: Word[][]): QuestionRecord[] {
  const allLines: Line[] = [];
  pageWords.forEach((words, idx) => allLines.push(...reconstructLines(words, idx + 1)));

  const records: QuestionRecord[] = [];
  let i = 0;

  while (i < allLines.length) {
    const idMatch = allLines[i].text.trim().match(/^Question ID:\s*([0-9a-fA-F]{8})$/);
    if (!idMatch) {
      i++;
      continue;
    }
    const id = idMatch[1].toLowerCase();
    const page = allLines[i].page;
    const idLineYMax = allLines[i].yMax;
    i++;

    // Scan forward to the "Question" marker (start of the stimulus block). Every
    // word strictly between here and there, at x >= 240 and not a table label, is
    // Domain/Skill/Difficulty metadata -- see the module comment (point 2).
    let qIdx = i;
    while (qIdx < allLines.length && allLines[qIdx].text.trim() !== "Question") qIdx++;
    if (qIdx >= allLines.length) throw new Error(`${id}: no "Question" marker found`);
    if (allLines[qIdx].page !== page) {
      throw new Error(`${id}: "Question" marker landed on a different page than "Question ID:"`);
    }
    const questionMarkerYMin = allLines[qIdx].yMin;

    const metaWords = pageWords[page - 1].filter(
      (w) =>
        w.yMin > idLineYMax &&
        w.yMin < questionMarkerYMin &&
        w.xMin >= DOMAIN_COL[0] &&
        !LABEL_WORDS.has(w.text),
    );
    const bucket = (range: [number, number]) =>
      metaWords
        .filter((w) => w.xMin >= range[0] && w.xMin < range[1])
        .sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin)
        .map((w) => w.text)
        .join(" ");

    const domain = bucket(DOMAIN_COL);
    const skill = bucket(SKILL_COL);
    const difficultyText = bucket(DIFFICULTY_COL);
    if (!DOMAINS.includes(domain)) throw new Error(`${id}: unrecognized domain "${domain}"`);
    if (!DOMAIN_SKILLS[domain].includes(skill)) {
      throw new Error(`${id}: unrecognized skill "${skill}" for domain "${domain}"`);
    }
    if (!DIFFICULTIES.has(difficultyText)) {
      throw new Error(`${id}: unrecognized difficulty "${difficultyText}"`);
    }

    // Stimulus block: everything between "Question" and "Answer".
    i = qIdx + 1;
    const stimulusLines: Line[] = [];
    while (i < allLines.length && allLines[i].text.trim() !== "Answer") {
      stimulusLines.push(allLines[i]);
      i++;
    }
    if (i >= allLines.length) throw new Error(`${id}: no "Answer" marker found`);
    const stimulus = joinBlock(stimulusLines);
    i++; // past "Answer"

    // Choices block: everything between "Answer" and "Correct Answer:", split on
    // lines that start a new "A./B./C./D." choice.
    const choiceLines: Line[] = [];
    while (i < allLines.length && !allLines[i].text.trim().match(/^Correct Answer:/)) {
      choiceLines.push(allLines[i]);
      i++;
    }
    if (i >= allLines.length) throw new Error(`${id}: no "Correct Answer:" marker found`);

    const choices: string[] = [];
    let current = "";
    for (const line of choiceLines) {
      const m = line.text.match(/^([A-D])\.\s?(.*)$/);
      if (m) {
        if (current) choices.push(current.trim());
        current = m[2];
      } else if (current) {
        current += " " + line.text;
      }
    }
    if (current) choices.push(current.trim());
    if (choices.length !== 4) {
      throw new Error(`${id}: expected 4 answer choices, found ${choices.length}`);
    }

    const correctMatch = allLines[i].text.trim().match(/^Correct Answer:\s*([A-D])\b/);
    if (!correctMatch) throw new Error(`${id}: couldn't parse correct answer from "${allLines[i].text}"`);
    const correctAnswer = correctMatch[1];
    i++;

    while (i < allLines.length && allLines[i].text.trim() !== "Rationale") i++;
    if (i >= allLines.length) throw new Error(`${id}: no "Rationale" marker found`);
    i++;

    // Rationale block: everything up to the next question (or EOF).
    const rationaleLines: Line[] = [];
    while (i < allLines.length && !allLines[i].text.trim().match(/^Question ID:/)) {
      rationaleLines.push(allLines[i]);
      i++;
    }
    const rationale = joinBlock(rationaleLines);

    if (!stimulus || !rationale || choices.some((c) => !c)) {
      throw new Error(`${id}: missing required text content`);
    }

    records.push({
      id,
      domain,
      skill,
      difficulty: difficultyText.toLowerCase(),
      stimulus,
      choices: choices as [string, string, string, string],
      correctAnswer,
      rationale,
    });
  }

  return records;
}

function main() {
  console.log(`Reading ${PDF_PATH} ...`);
  const bboxXml = runPdftotextBbox();
  const pageWords = parseWordsByPage(bboxXml);
  console.log(`Parsed ${pageWords.length} page(s) of word boxes.`);

  const records = parseQuestions(pageWords);
  console.log(`Parsed ${records.length} question(s).`);

  if (records.length !== 150) {
    throw new Error(`Expected exactly 150 questions, parsed ${records.length}.`);
  }
  const idSet = new Set(records.map((r) => r.id));
  if (idSet.size !== records.length) {
    throw new Error(`Duplicate question IDs found (${records.length - idSet.size} duplicate(s)).`);
  }
  for (const r of records) {
    if (!["A", "B", "C", "D"].includes(r.correctAnswer)) {
      throw new Error(`${r.id}: correct_answer "${r.correctAnswer}" is not A/B/C/D`);
    }
  }

  const byDomain = new Map<string, number>();
  for (const r of records) byDomain.set(r.domain, (byDomain.get(r.domain) ?? 0) + 1);
  for (const [d, c] of byDomain) console.log(`  - ${d}: ${c}`);

  const db = openDatabase();
  try {
    const insert = db.prepare(
      `INSERT INTO questions
         (id, section, domain, skill, difficulty, question_type, stimulus_text,
          choice_a, choice_b, choice_c, choice_d, correct_answer, rationale, figure_asset_path)
       VALUES
         (@id, 'rw', @domain, @skill, @difficulty, 'mc', @stimulus_text,
          @choice_a, @choice_b, @choice_c, @choice_d, @correct_answer, @rationale, NULL)`,
    );

    const reload = db.transaction((rows: QuestionRecord[]) => {
      // Clear-and-reload keeps this idempotent: running the script again always
      // leaves section='rw' matching the PDF exactly, with no accumulating
      // duplicates. Scoped to section='rw' so Math rows (a separate Epic 1
      // ingestion) are untouched.
      db.prepare("DELETE FROM questions WHERE section = 'rw'").run();
      for (const r of rows) {
        insert.run({
          id: r.id,
          domain: r.domain,
          skill: r.skill,
          difficulty: r.difficulty,
          stimulus_text: r.stimulus,
          choice_a: r.choices[0],
          choice_b: r.choices[1],
          choice_c: r.choices[2],
          choice_d: r.choices[3],
          correct_answer: r.correctAnswer,
          rationale: r.rationale,
        });
      }
    });
    reload(records);

    const { count } = db
      .prepare("SELECT COUNT(*) AS count FROM questions WHERE section = 'rw'")
      .get() as { count: number };
    console.log(`questions (section='rw') now has ${count} row(s).`);
  } finally {
    db.close();
  }
}

main();
