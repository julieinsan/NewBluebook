/**
 * Epic 2 end-to-end smoke test, run against the REAL local database (not a stub).
 *
 * There's no UI yet (Epic 3), so this is the verification path for the whole
 * assembly engine: start a new attempt, assemble both Module 1s, fabricate a
 * realistic mix of right/wrong answers (including a grid-in equivalent-form match for
 * Math), submit Module 1 for both sections, assemble Module 2 for both, and assert:
 *
 *  - Module 1 landed the exact blueprint per-domain counts for both sections.
 *  - The R&W answer mix (~70% correct, deliberately above the 60% threshold) routes
 *    "harder"; the Math answer mix (~40% correct, deliberately below) routes "easier"
 *    -- exercising BOTH routing directions in one run.
 *  - A Math grid-in question answered with an alternate accepted form (different
 *    whitespace/case) is graded correct, proving the comma-separated-forms
 *    normalization (Story 2.4) actually works, not just exact-string equality.
 *  - Module 2 landed the exact blueprint per-domain counts for both sections.
 *  - No question appears in both Module 1 and Module 2 of the same attempt, for
 *    either section.
 *
 * This creates a real `test_attempts` row (and logs real `question_serve_log`
 * entries) in `data/bluebook.db`, same as a real user starting a test would -- that's
 * intentional, it's exercising the real recycling behavior described in PRD 3.3, not
 * a mock. Safe to re-run repeatedly.
 *
 * Usage: `npm run smoke:assembly`
 */
import { getDb } from "../lib/db";
import { BLUEPRINT, type Section } from "../lib/blueprint";
import { startNewAttempt, submitModule1Answers, assembleModule2ForSection } from "../lib/attemptService";
import type { AssembledModuleQuestion } from "../lib/attemptService";

let failures = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  OK   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

function countsByDomain(questions: AssembledModuleQuestion[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { question } of questions) {
    out[question.domain] = (out[question.domain] ?? 0) + 1;
  }
  return out;
}

function checkDomainCounts(
  label: string,
  actual: AssembledModuleQuestion[],
  section: Section,
  moduleKey: "module1" | "module2",
) {
  const counts = countsByDomain(actual);
  for (const d of BLUEPRINT[section].domains) {
    const expected = d[moduleKey];
    const got = counts[d.domain] ?? 0;
    check(
      `${label}: ${d.domain} = ${expected}`,
      got === expected,
      `got ${got}`,
    );
  }
  check(`${label}: total question count = ${actual.length}`, actual.length === Object.values(counts).reduce((a, b) => a + b, 0));
}

/**
 * Picks a wrong multiple-choice letter (any letter other than the correct one).
 */
function wrongLetter(correct: string): string {
  return ["A", "B", "C", "D"].find((l) => l.toUpperCase() !== correct.toUpperCase().trim()) as string;
}

/**
 * Fabricates answers for a module's question set targeting exactly `targetFraction`
 * correct (rounded). For MC questions: exact correct_answer letter when marked
 * "correct", a different letter otherwise. For grid-in questions: when correct_answer
 * lists multiple accepted forms (comma-separated), the LAST form is used (with added
 * whitespace/case noise) to specifically prove alternate-form + normalization
 * matching, not just first-form exact equality; single-form grid-ins use the exact
 * value. Incorrect grid-in answers use an obviously wrong numeric string.
 *
 * If a multi-form grid-in question exists in the set, it's guaranteed to land in the
 * "correct" bucket (swapping correctness with some other question if needed) so the
 * normalization case always gets exercised, while keeping the total correct count
 * exactly at the target (so the routing-threshold math stays exact and predictable).
 */
function fabricateAnswers(
  questions: AssembledModuleQuestion[],
  targetFraction: number,
): { questionId: string; userAnswer: string }[] {
  const targetCorrect = Math.round(questions.length * targetFraction);
  const isCorrectFlags = questions.map((_, i) => i < targetCorrect);

  const multiFormGridInIndex = questions.findIndex(
    ({ question }) => question.question_type === "grid_in" && question.correct_answer.includes(","),
  );
  if (multiFormGridInIndex !== -1 && !isCorrectFlags[multiFormGridInIndex]) {
    const swapWith = isCorrectFlags.findIndex((flag, i) => flag && i !== multiFormGridInIndex);
    if (swapWith !== -1) {
      isCorrectFlags[multiFormGridInIndex] = true;
      isCorrectFlags[swapWith] = false;
    }
  }

  return questions.map(({ question }, i) => {
    const shouldBeCorrect = isCorrectFlags[i];
    if (question.question_type === "grid_in") {
      const forms = question.correct_answer.split(",").map((f) => f.trim());
      if (shouldBeCorrect) {
        const chosenForm = forms[forms.length - 1];
        // Add whitespace + case noise to prove normalization, not raw equality.
        return { questionId: question.id, userAnswer: `  ${chosenForm.toUpperCase()}  ` };
      }
      return { questionId: question.id, userAnswer: "-99999" };
    }
    const userAnswer = shouldBeCorrect ? question.correct_answer : wrongLetter(question.correct_answer);
    return { questionId: question.id, userAnswer };
  });
}

function overlap(module1: AssembledModuleQuestion[], module2: AssembledModuleQuestion[]): string[] {
  const m1Ids = new Set(module1.map((q) => q.question.id));
  return module2.filter((q) => m1Ids.has(q.question.id)).map((q) => q.question.id);
}

function main() {
  const db = getDb();

  console.log("=== Starting new attempt ===");
  const { attemptId, rw: rwModule1, math: mathModule1 } = startNewAttempt(db);
  console.log(`attemptId = ${attemptId}`);
  console.log(`R&W Module 1: ${rwModule1.length} questions, Math Module 1: ${mathModule1.length} questions`);

  console.log("\n=== Module 1 per-domain counts ===");
  checkDomainCounts("R&W Module 1", rwModule1, "rw", "module1");
  checkDomainCounts("Math Module 1", mathModule1, "math", "module1");

  console.log("\n=== Fabricating & submitting Module 1 answers ===");
  const rwTargetFraction = 0.7; // deliberately >= 60% threshold -> expect "harder"
  const mathTargetFraction = 0.4; // deliberately < 60% threshold -> expect "easier"

  const rwAnswers = fabricateAnswers(rwModule1, rwTargetFraction);
  const mathAnswers = fabricateAnswers(mathModule1, mathTargetFraction);

  const gridInAnswer = mathAnswers.find((a) => {
    const q = mathModule1.find((m) => m.question.id === a.questionId)?.question;
    return q?.question_type === "grid_in" && q.correct_answer.includes(",");
  });
  if (gridInAnswer) {
    const q = mathModule1.find((m) => m.question.id === gridInAnswer.questionId)!.question;
    console.log(
      `Grid-in equivalent-form case: question ${q.id}, correct_answer field = "${q.correct_answer}", ` +
        `fabricated user_answer = "${gridInAnswer.userAnswer}"`,
    );
  } else {
    console.log("(No multi-form grid-in question landed in this Module 1 draw -- skipping that specific check.)");
  }

  submitModule1Answers(db, attemptId, "rw", rwAnswers);
  submitModule1Answers(db, attemptId, "math", mathAnswers);
  console.log("Submitted R&W and Math Module 1 answers.");

  console.log("\n=== Assembling Module 2 (adaptive routing) ===");
  const rwResult = assembleModule2ForSection(db, attemptId, "rw");
  const mathResult = assembleModule2ForSection(db, attemptId, "math");

  console.log(
    `R&W Module 1 score: ${rwResult.correctCount}/${rwResult.totalCount} = ${(rwResult.rawScore * 100).toFixed(1)}% -> path = "${rwResult.path}"`,
  );
  console.log(
    `Math Module 1 score: ${mathResult.correctCount}/${mathResult.totalCount} = ${(mathResult.rawScore * 100).toFixed(1)}% -> path = "${mathResult.path}"`,
  );

  console.log("\n=== Routing checks ===");
  check('R&W routed to "harder"', rwResult.path === "harder", `actual path = ${rwResult.path}`);
  check('Math routed to "easier"', mathResult.path === "easier", `actual path = ${mathResult.path}`);

  if (gridInAnswer) {
    const row = db
      .prepare(
        "SELECT is_correct FROM test_attempt_questions WHERE attempt_id = ? AND question_id = ? AND module = 1",
      )
      .get(attemptId, gridInAnswer.questionId) as { is_correct: number };
    check(
      "Grid-in alternate-form answer graded correct (normalization works)",
      row.is_correct === 1,
      `is_correct = ${row.is_correct}`,
    );
  }

  const attemptRow = db
    .prepare("SELECT rw_module2_difficulty_path, math_module2_difficulty_path FROM test_attempts WHERE id = ?")
    .get(attemptId) as { rw_module2_difficulty_path: string; math_module2_difficulty_path: string };
  check(
    "test_attempts.rw_module2_difficulty_path persisted correctly",
    attemptRow.rw_module2_difficulty_path === rwResult.path,
  );
  check(
    "test_attempts.math_module2_difficulty_path persisted correctly",
    attemptRow.math_module2_difficulty_path === mathResult.path,
  );

  console.log("\n=== Module 2 per-domain counts ===");
  checkDomainCounts("R&W Module 2", rwResult.questions, "rw", "module2");
  checkDomainCounts("Math Module 2", mathResult.questions, "math", "module2");

  console.log("\n=== No question repeats within the same attempt across modules ===");
  const rwOverlap = overlap(rwModule1, rwResult.questions);
  const mathOverlap = overlap(mathModule1, mathResult.questions);
  check("R&W: no question appears in both Module 1 and Module 2", rwOverlap.length === 0, `overlap = ${rwOverlap.join(", ")}`);
  check("Math: no question appears in both Module 1 and Module 2", mathOverlap.length === 0, `overlap = ${mathOverlap.join(", ")}`);

  // Also verify at the DB level directly (belt-and-suspenders against the in-memory objects).
  const dbOverlap = db
    .prepare(
      `SELECT section, question_id, COUNT(DISTINCT module) as moduleCount
       FROM test_attempt_questions
       WHERE attempt_id = ?
       GROUP BY section, question_id
       HAVING moduleCount > 1`,
    )
    .all(attemptId) as { section: string; question_id: string; moduleCount: number }[];
  check("DB-level: no (section, question_id) appears under more than one module", dbOverlap.length === 0, JSON.stringify(dbOverlap));

  console.log(`\n=== Result: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
