# Epic 5 — Scoring & Results: implementation plan

**Status:** Wave 1 complete; Wave 2 (UI) next (revision 1)
**Covers:** PRD Stories 5.1–5.4 ([PRD.md](../PRD.md) § Epic 5, §8 visual spec)
**Depends on:** Epic 3 complete (submit flow, per-question grading, time tracking); Epic 4 Wave 3 verification gate recommended before starting UI
**No schema migration** — `rw_scaled_score`, `math_scaled_score`, `total_scaled_score` on `test_attempts` and `is_correct` on `test_attempt_questions` landed in Epic 0/3.

---

## 1. Where we're starting from

Epic 3 delivered the **full test-taking loop** and grades every answer on save. Epic 5 adds **aggregation, scaled scoring, and post-submit UI**. Today the student lands on a placeholder:

```tsx
// SubmittedScreen.tsx — current
"Scoring and review will be available in a future update."
```

| Already exists | Where |
|---|---|
| `is_correct` graded on every answer save | `lib/attemptService.ts` `saveAnswer` |
| Grid-in equivalent-answer grading | `lib/adaptiveRouting.ts` |
| `rw_scaled_score`, `math_scaled_score`, `total_scaled_score` columns (nullable) | `migrations/0002_create_test_attempts.sql` |
| `submitAttempt` — idempotent `status = 'submitted'` + `submitted_at` | `lib/moduleTransition.ts` |
| `POST /api/attempts/:id/submit` | `app/api/attempts/[id]/submit/route.ts` |
| `wasRecycled` reconstruction from `question_serve_log` | `lib/attemptService.ts` `readModuleQuestions` CTE |
| `time_spent_seconds` per question (Story 3.7) | `test_attempt_questions`, `useQuestionTimeTracker` |
| `AttemptSummary.totalScaledScore` (read, always null today) | `lib/attemptState.ts` `listAttempts` |
| Domain blueprint for performance bands | `lib/blueprint.ts` |
| End-of-**module** review screen (in-test, not post-submit) | `app/(test)/test/[attemptId]/review/` |

| Not built yet | Stories |
|---|---|
| Raw score aggregation | 5.1 |
| Approximate scaled curve | 5.2 |
| Results dashboard (score report) | 5.3 |
| Post-submit answer review + "seen before" badge | 5.4 |

```
submitAttempt (today)
  └─ status = submitted, submitted_at stamped
  └─ scaled scores: null

submitAttempt (Epic 5)
  └─ scoreAttempt on first delivery (D1)
       ├─ aggregate is_correct → raw breakdown (5.1)
       ├─ apply curve → rw/math/total scaled (5.2)
       └─ persist to test_attempts

SubmittedScreen → /test/:id/results (5.3)
                    └─ "Review answers" → /test/:id/results/answers (5.4)
```

**Route naming note:** `/test/:id/review` is already the **end-of-module** review screen (Epic 3 Story 3.4). Post-submit answer review must use a different path — **`/test/:id/results/answers`** (D5) — so guards and links never collide.

---

## 2. Architectural decisions

Decisions confirmed with Julie are marked ✔; defaults are flagged for review before Wave 1.

**D1 — Score on first `submitAttempt` delivery.** ✔ When `submittedNow === true`, call `scoreAttempt(db, attemptId)` in the same transaction. Re-submit (`submittedNow === false`) returns cached scores without recomputing. Matches the idempotent submit pattern from Epic 3 D10.

**D2 — Raw score = count of `is_correct = 1`.** Unanswered questions (`user_answer IS NULL` or `is_correct = 0`) count as incorrect. Aggregation dimensions:

| Dimension | Source |
|---|---|
| Per module | `section` + `module` on `test_attempt_questions` |
| Per section | R&W (54) / Math (44) totals |
| Per domain | join `questions.domain` |
| Per skill | join `questions.skill` |

**D3 — Approximate scaled curve, not official equating.** ✔ Map section raw correct (0–54 R&W, 0–44 Math) to 200–800 via a piecewise lookup table in `lib/scoringCurve.ts`. Document in file comments that values are **approximate** (PRD §2 non-goals). Total = `rw_scaled + math_scaled` (400–1600). UI must label scores as approximate.

**D4 — Review payload is a separate read model.** ✔ `RunnerQuestion` deliberately omits `correct_answer`, `rationale`, `wasRecycled` (see `lib/testFlow.ts`). Epic 5 introduces `ReviewQuestion` in `lib/resultsContract.ts` with those fields plus `isCorrect`, `timeSpentSeconds`. Never served mid-test.

**D5 — Post-submit routes and guards.** ✔

| Route | Guard | Purpose |
|---|---|---|
| `/test/:id/submitted` | `position.kind === "submitted"` (existing) | Confirmation; redirects to results once scored |
| `/test/:id/results` | `status === 'submitted'` | Score report dashboard (5.3) |
| `/test/:id/results/answers` | `status === 'submitted'` | Per-question answer review (5.4) |

Add `resultsPath(attemptId)` and `answerReviewPath(attemptId)` to `lib/testFlow.ts` in Wave 0. Guards live in `guardPosition.ts` alongside existing module/break/submitted guards.

**D6 — "Seen before" from existing `wasRecycled` logic.** ✔ No new column. `readReviewQuestions` reuses the serve-log CTE from `readModuleQuestions` (PRD §3.3 / Story 5.4). Badge copy: **"Seen before"**.

**D7 — Server Components for reads; no new write endpoints.** Scoring runs inside `submitAttempt`. Results pages are Server Components that read SQLite directly (same pattern as home and runner pages). One new **read** route: `GET /api/attempts/:id/results` for client-side refresh if needed; primary path is RSC.

**D8 — Domain performance bands on the dashboard.** For each domain in `BLUEPRINT`, show correct/total and a simple horizontal bar (PRD §8: grayscale + blue accent). Band thresholds (e.g. "Above benchmark" / "Below benchmark") are derived from `% correct` with documented cutoffs in `lib/scoring.ts` — not official College Board bands.

---

## 3. Type contracts (Wave 0 — freeze before engine + UI)

### 3.1 Score breakdown (`lib/scoring.ts`)

```ts
interface ModuleRawScore { section: Section; module: 1 | 2; correct: number; total: number }
interface DomainRawScore { section: Section; domain: string; correct: number; total: number }
interface SectionRawScore { section: Section; correct: number; total: number }

interface AttemptScores {
  attemptId: number;
  rwScaled: number;
  mathScaled: number;
  totalScaled: number;
  raw: {
    modules: ModuleRawScore[];
    sections: SectionRawScore[];
    domains: DomainRawScore[];
  };
}
```

### 3.2 Review question (`lib/resultsContract.ts`)

```ts
interface ReviewQuestion {
  id: string;
  number: number;           // 1-based across full test (1–98)
  section: Section;
  module: 1 | 2;
  questionType: "mc" | "grid_in";
  stimulusText: string;
  choices: RunnerChoice[];  // empty for grid-in
  figureAssetPath: string | null;
  userAnswer: string | null;
  correctAnswer: string;
  isCorrect: boolean;
  rationale: string | null;
  wasRecycled: boolean;
  timeSpentSeconds: number;
  flagged: boolean;
}
```

### 3.3 Curve (`lib/scoringCurve.ts`)

Pure functions: `rawToScaledRw(correct: number): number`, `rawToScaledMath(correct: number): number`. Monotonic, endpoints `(0 → 200)`, `(max → 800)`. Unit-tested at endpoints and a few interior points.

Add `lib/scoringCurve.test.ts` in Wave 0 (no DB).

---

## 4. Work breakdown

Four waves. Wave *n* UI tracks may not start until Wave 1's read API / scoring functions land.

### Wave 0 — Contracts ✅

| # | Task | Files | Parallel? |
|---|---|---|---|
| 0.1 | Score + review types (§3) | `lib/scoring.ts`, `lib/resultsContract.ts` | ✅ with 0.2 |
| 0.2 | Approximate curve tables + tests | `lib/scoringCurve.ts`, `lib/scoringCurve.test.ts` | ✅ with 0.1 |
| 0.3 | Route helpers `resultsPath`, `answerReviewPath` | `lib/testFlow.ts`, `lib/testFlow.test.ts` | after 0.1 |
| 0.4 | `formatDuration(seconds)` for review UI ("2m 15s") | `lib/formatDuration.ts`, `lib/formatDuration.test.ts` | ✅ with 0.1 |
| 0.5 | This plan doc | `docs/epic-5-implementation-plan.md` | — |

**Done when:** types compile; curve tests pass; path helpers tested.

### Wave 1 — Scoring engine (Stories 5.1 + 5.2) ✅

Sequential within this wave — one owner recommended for `moduleTransition.ts`.

| # | Task | Files | Story |
|---|---|---|---|
| 1.1 | `computeRawScores(db, attemptId)` | `lib/scoring.ts`, `lib/scoring.test.ts` | 5.1 |
| 1.2 | `computeScaledScores(raw)` — apply curve | `lib/scoring.ts` | 5.2 |
| 1.3 | `scoreAttempt(db, attemptId)` — compute + UPDATE `test_attempts` | `lib/scoring.ts` | 5.1–5.2 |
| 1.4 | Call `scoreAttempt` inside `submitAttempt` when `submittedNow` | `lib/moduleTransition.ts`, `lib/moduleTransition.test.ts` | 5.2 |
| 1.5 | `readReviewQuestions(db, attemptId)` — all 98 questions, answer key + `wasRecycled` | `lib/reviewReadModel.ts`, `lib/reviewReadModel.test.ts` | 5.4 |
| 1.6 | `GET /api/attempts/:id/results` | `app/api/attempts/[id]/results/route.ts` | 5.3 |
| 1.7 | Extend `scripts/smoke-test-flow.ts` — assert scores after submit | `scripts/smoke-test-flow.ts` | 5.1–5.2 |

**Done when:** full test submit writes all three scaled scores; second submit is idempotent; API returns `AttemptScores`; review read model returns 98 questions with correct answers hidden from runner payload.

### Wave 2 — UI (three parallel tracks)

All three tracks depend on Wave 1. They must not edit each other's primary files.

#### Track A — Results dashboard (Story 5.3)

| # | Task | Files |
|---|---|---|
| 2A.1 | `guardResultsPage(attemptId)` — `status === 'submitted'` | `guardPosition.ts` |
| 2A.2 | `ResultsDashboard` — total, section scores, domain bars (D8) | `app/(test)/test/[attemptId]/results/page.tsx`, `ResultsDashboard.tsx` |
| 2A.3 | "Approximate score" disclaimer copy | same |
| 2A.4 | Link to answer review + home | same |
| 2A.5 | Vitest with fixture scores | `ResultsDashboard.test.tsx` |

#### Track B — Answer review (Story 5.4)

| # | Task | Files |
|---|---|---|
| 2B.1 | `guardAnswerReviewPage(attemptId)` | `guardPosition.ts` (coordinate with 2A.1 — one PR for guards) |
| 2B.2 | `AnswerReviewRunner` — one question at a time, Back/Next, correct/incorrect styling | `app/(test)/test/[attemptId]/results/answers/` |
| 2B.3 | `SeenBeforeBadge` when `wasRecycled` | `SeenBeforeBadge.tsx` |
| 2B.4 | Show rationale, user answer vs correct answer, `formatDuration` | `AnswerReviewCard.tsx` |
| 2B.5 | Reuse `MarkdownContent` / `QuestionRenderer` read-only where practical | shared question components |
| 2B.6 | Vitest | `AnswerReviewRunner.test.tsx` |

#### Track C — Navigation wiring

| # | Task | Files |
|---|---|---|
| 2C.1 | `SubmittedScreen` — link/redirect to results after `postSubmit` succeeds | `SubmittedScreen.tsx` |
| 2C.2 | `AttemptHistory` — show `totalScaledScore` + "View results" for completed attempts | `AttemptHistory.tsx`, `positionLabel.ts` |
| 2C.3 | `clientApi.ts` — `getResults(attemptId)` if client fetch needed | `clientApi.ts` |

**Done when:** submit → results dashboard → answer review → home shows score; guards block in-progress attempts from results routes.

### Wave 3 — Verification

| # | Task | Notes |
|---|---|---|
| 3.1 | `npm test`, `npm run test:ui`, `npm run build`, `npm run lint` | Gate before merge |
| 3.2 | `npm run smoke:flow` — scores asserted | Extends Wave 1.7 |
| 3.3 | Manual QA walk-through (§6) | Browser-only |

---

## 5. HTTP contract

| Method + path | Body | Returns | Notes |
|---|---|---|---|
| `POST /api/attempts/:id/submit` | — | `{ ok }` | **Extended:** first delivery now also scores (D1) |
| `GET /api/attempts/:id/results` | — | `AttemptScores` | New; 404 if not submitted; optional client refresh |

No changes to answer or question-state endpoints.

---

## 6. Manual QA checklist

1. **Submit flow:** Complete Math Module 2 → confirm dialog → submitted screen → results dashboard loads with scores
2. **Scores (5.2):** Total = R&W + Math section scores; values in 200–800 / 400–1600 range; "approximate" label visible
3. **Domain bands (5.3):** Four R&W + four Math domains show correct/total and bars; counts sum to 54 / 44
4. **Answer review (5.4):** Navigate all 98 questions; correct/incorrect clear; rationale shown; time spent shown
5. **Seen before (5.4):** Start Practice Test 2 after Test 1; recycled questions show badge in answer review
6. **Home history (2C.2):** Completed attempt shows total score and links to results
7. **Guards:** In-progress attempt cannot open `/results` or `/results/answers` (redirects appropriately)
8. **Regression:** Re-submit idempotent; in-test module review (`/review`) unchanged; runner still hides answer key mid-test
9. **Practice Test 2:** Scores compute correctly when bank recycles questions

---

## 7. Execution order

```
Wave 0   contracts (parallel: types ∥ curve ∥ formatDuration)
Wave 1   scoring engine + review read model + API (sequential)
Wave 2   Track A (dashboard) ∥ Track B (answer review) ∥ Track C (wiring)
Wave 3   verification gate
```

### Parallel work matrix

| Phase | Parallel tracks | Blocked on |
|---|---|---|
| Wave 0 | 0.1 + 0.2 + 0.4 | — |
| Wave 1 | 1.7 (smoke) can follow 1.4 | Wave 0 |
| Wave 2A | Dashboard UI | Wave 1 (`AttemptScores` + guards) |
| Wave 2B | Answer review UI | Wave 1 (`readReviewQuestions`) |
| Wave 2C | Submitted + home wiring | Wave 1 (scores persisted) |
| Wave 3 | Automated ∥ manual QA | Wave 2 |

**Suggested worktree split for Wave 2:**

| Branch | Owns |
|---|---|
| `epic-5/wave-2-results-dashboard` | 2A.*, `guardResultsPage` |
| `epic-5/wave-2-answer-review` | 2B.*, `guardAnswerReviewPage` |
| `epic-5/wave-2-navigation` | 2C.* |

Merge guards in one branch first (or designate one owner for `guardPosition.ts`) to avoid conflicts.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Grid-in equivalent answers already graded inconsistently | Scoring only reads `is_correct`; fix grader separately if found |
| Curve feels arbitrary to user | D3 documentation + UI disclaimer; adjustable table |
| Answer key leaks mid-test | D4 separate type; review routes guard on `submitted` |
| `/review` vs `/results/answers` confusion | D5 distinct paths; never reuse module-review URL |
| `wasRecycled` wrong if serve log pruned | Existing fallback in `attemptService.ts`; acceptable for local app |
| Scoring runs before all answers graded | Unanswered rows have `is_correct = 0` or NULL treated as incorrect (D2) |

---

## 9. Rules for parallel work

1. **One file, one owner, one wave.** The tables above are the authority.
2. **Wave 1 owns `moduleTransition.ts` and `lib/scoring.ts`** — single agent recommended.
3. **`guardPosition.ts` has one owner per wave** — Tracks A and B coordinate guard additions.
4. **Do not expose `correct_answer` on `RunnerQuestion`** — review read model only.
5. **`npm test`, `npm run test:ui`, `npm run lint` pass before reporting done.**
6. **New pure helpers get `node:test` coverage** in `lib/`; UI components get Vitest in `app/`.
7. **Match Epic 3 conventions:** Server Components for reads, fixture-driven component tests, no writes during render.

---

## 10. Files touched (summary)

| Area | New | Modified |
|---|---|---|
| Scoring | `lib/scoring.ts`, `lib/scoringCurve.ts`, `lib/formatDuration.ts` | `lib/moduleTransition.ts` |
| Review read model | `lib/reviewReadModel.ts`, `lib/resultsContract.ts` | — |
| API | `app/api/attempts/[id]/results/route.ts` | `app/api/attempts/[id]/submit/route.ts` (indirect via transition) |
| Results UI | `results/ResultsDashboard.tsx`, `results/answers/AnswerReviewRunner.tsx`, `SeenBeforeBadge.tsx` | — |
| Wiring | — | `SubmittedScreen.tsx`, `AttemptHistory.tsx`, `guardPosition.ts`, `testFlow.ts` |
| Tests | `*.test.ts` / `*.test.tsx` per above | `moduleTransition.test.ts`, `smoke-test-flow.ts` |

**Explicitly not touched:** `lib/questionState.ts`, answer grading logic, migrations, in-test `ModuleReview.tsx`, Epic 4 highlight/cross-out code.

---

## 11. What comes after Epic 5

| Epic | Dependency on Epic 5 | Notes |
|---|---|---|
| **Epic 6 — Drill mode** | None for Wave 0 picker | Can start drill schema/service in parallel with Epic 5 Wave 2 UI |
| **Epic 7.2 — Score trend** | Requires `total_scaled_score` populated | Build after Epic 5 Wave 1 |
| **Epic 4 Wave 3** | None | Run before or in parallel with Epic 5 Wave 0 |

---

## 12. Review log

1. **Revision 1 (2026-09-05):** Initial plan. Post-submit answer review at `/results/answers` to avoid collision with in-test `/review`. Scoring hooks into existing `submitAttempt`. No migration.
