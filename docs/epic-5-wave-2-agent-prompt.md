# Agent prompt — Epic 5 Wave 2: Scoring & Results UI

Use this document as your full task brief. **Implement Epic 5 Wave 2 only.** Do not start Wave 3 (verification gate) or Epic 6 unless explicitly asked.

---

## Mission

Build the **post-submit results experience** for the Bluebook Clone app:

1. **Results dashboard** — approximate scaled scores + domain performance (PRD Story 5.3)
2. **Answer review** — per-question review with rationale, pacing, and "Seen before" badge (PRD Story 5.4)
3. **Navigation wiring** — connect submit confirmation and home history to the new pages

Wave 1 (scoring engine) is **already complete**. You are building UI and guards on top of existing server-side read models.

---

## Authoritative references

Read these before coding:

| Document | Purpose |
|---|---|
| [docs/epic-5-implementation-plan.md](./epic-5-implementation-plan.md) | Wave 2 task tables, decisions D1–D8, parallel rules |
| [PRD.md](../PRD.md) § Epic 5, §8 | Product requirements and visual style |
| [docs/epic-4-implementation-plan.md](./epic-4-implementation-plan.md) | In-test tools — do not break |

---

## What already exists (do not re-implement)

| Capability | Location |
|---|---|
| Raw + scaled scoring, persisted on submit | `lib/scoring.ts` — `getAttemptScores`, `scoreAttempt` |
| Review read model (98 questions, answer key) | `lib/reviewReadModel.ts` — `readReviewQuestions` |
| `ReviewQuestion` type | `lib/resultsContract.ts` |
| Duration formatting (`"2m 15s"`) | `lib/formatDuration.ts` |
| Route helpers | `lib/testFlow.ts` — `resultsPath(attemptId)`, `answerReviewPath(attemptId)` |
| Results API (optional client fetch) | `GET /api/attempts/:id/results` → `AttemptScores` |
| Submit + score on first delivery | `lib/moduleTransition.ts` `submitAttempt` |
| Home list with `totalScaledScore` field (always populated after submit) | `lib/attemptState.ts` `listAttempts` |
| In-test module review (different route!) | `app/(test)/test/[attemptId]/review/` — **do not modify behavior** |

---

## Critical constraints

### Route collision (D5)

- **`/test/:id/review`** = end-of-**module** review during the test (Epic 3). Leave unchanged.
- **`/test/:id/results`** = post-submit score dashboard (you build this).
- **`/test/:id/results/answers`** = post-submit answer review (you build this).

Never reuse `/review` for post-submit content.

### Security (D4)

- `RunnerQuestion` intentionally omits `correctAnswer`, `rationale`, `wasRecycled`.
- Only render answer keys on routes guarded by `status === 'submitted'`.
- Do not add correct answers to runner payloads or mid-test components.

### Architecture (D7)

- **Server Components** for page reads: call `getDb()`, `getAttemptScores()`, `readReviewQuestions()` directly in `page.tsx` (same pattern as `app/(test)/test/[attemptId]/review/page.tsx` and `app/page.tsx`).
- Client components only where interactivity is required (answer review Back/Next pager).
- No new write endpoints. No migrations.

### Scope boundaries — do NOT touch

- `lib/scoring.ts` logic (unless a trivial export is needed — prefer not)
- `lib/moduleTransition.ts`
- `lib/questionState.ts`, answer grading
- `app/(test)/test/[attemptId]/review/ModuleReview.tsx` (in-test review)
- Epic 4 highlight/cross-out code
- `migrations/`

---

## Work breakdown

Implement in this order to minimize merge conflicts:

### Step 0 — Guards (single owner, do first)

Add to `app/(test)/test/[attemptId]/_lib/guardPosition.ts`:

**`guardResultsPage(attemptId)`**
- `await connection()`
- `getDb()` + `getAttemptState(db, attemptId)`
- If attempt missing → `notFound()` (existing `handleMissingAttempt` pattern)
- If `status !== 'submitted'` → `redirect(pathForPosition(attemptId, resolvePositionForAttempt(db, attemptId)))`
- Paused attempts: follow existing convention — `redirectIfPaused` redirects to `/` (results are post-submit only; paused in-progress attempts should not reach here, but be consistent)

**`guardAnswerReviewPage(attemptId)`**
- Same guard logic as `guardResultsPage` (submitted only)

Both guards check **`status === 'submitted'`**, not just `position.kind === 'submitted'`. An attempt in the D10 window (Math M2 done, submit not yet run) has `position.kind === 'submitted'` but `status === 'in_progress'` — results pages must redirect those students to the submitted confirmation flow, not show scores prematurely.

---

### Track A — Results dashboard (Story 5.3)

**Files to create:**
- `app/(test)/test/[attemptId]/results/page.tsx` — Server Component
- `app/(test)/test/[attemptId]/results/ResultsDashboard.tsx` — presentational (client or server; prefer server if no local state)
- `app/(test)/test/[attemptId]/results/ResultsDashboard.test.tsx` — Vitest

**`page.tsx` pattern:**
```tsx
// 1. parse attemptId, notFound if invalid
// 2. await guardResultsPage(attemptId)
// 3. const scores = getAttemptScores(getDb(), attemptId)
// 4. return <ResultsDashboard scores={scores} attemptId={attemptId} />
```

**`ResultsDashboard` must show:**

| Element | Source |
|---|---|
| Total score (400–1600) | `scores.totalScaled` |
| R&W section score (200–800) | `scores.rwScaled` |
| Math section score (200–800) | `scores.mathScaled` |
| **"Approximate score" disclaimer** | Copy per D3 — not official College Board equating |
| Domain performance | `scores.raw.domains` — correct/total per domain |
| Horizontal bar per domain | Width = `correct / total`; PRD §8 blue accent on gray |
| Link: "Review answers" | `answerReviewPath(attemptId)` |
| Link: "Back to home" | `/` |

**Domain layout:** Group by section (R&W four domains, then Math four domains). Use `BLUEPRINT` domain order from `lib/blueprint.ts`.

**Optional benchmark label (D8):** Derive simple band from `% correct` — e.g. ≥70% "Above benchmark", 50–69% "At benchmark", &lt;50% "Below benchmark". Implement as a small pure helper in the component file or `lib/scoring.ts` only if you need reuse; keep scope minimal.

**Visual style (PRD §8):**
- White/near-white background, near-black text
- College Board blue (`accent` / `#0B5CAB` range) for bars and primary links
- Flat, clinical, no drop shadows
- Generous whitespace

**Tests (`ResultsDashboard.test.tsx`):**
- Fixture `AttemptScores` object (no DB)
- Assert total + section scores render
- Assert disclaimer text present
- Assert domain rows render (spot-check one R&W + one Math domain)
- Assert review + home links present with correct hrefs

---

### Track B — Answer review (Story 5.4)

**Files to create:**
- `app/(test)/test/[attemptId]/results/answers/page.tsx` — Server Component
- `app/(test)/test/[attemptId]/results/answers/AnswerReviewRunner.tsx` — `"use client"` pager
- `app/(test)/test/[attemptId]/results/answers/AnswerReviewCard.tsx` — single question display
- `app/(test)/test/[attemptId]/results/answers/SeenBeforeBadge.tsx`
- `app/(test)/test/[attemptId]/results/answers/AnswerReviewRunner.test.tsx`

**`page.tsx` pattern:**
```tsx
// 1. parse attemptId
// 2. await guardAnswerReviewPage(attemptId)
// 3. const questions = readReviewQuestions(getDb(), attemptId)
// 4. return <AnswerReviewRunner attemptId={attemptId} questions={questions} />
```

**`AnswerReviewRunner` behavior:**
- One question at a time, index 0..97
- Header: "Question {number} of 98"
- Back / Next buttons (pill-shaped blue, match `ModuleRunner` bottom bar style)
- Back disabled on Q1; Next on Q98 becomes "Done" or links back to results
- Optional: question number jump grid (nice-to-have; not required if time-constrained)

**`AnswerReviewCard` must show:**

| Element | Source |
|---|---|
| Stimulus | `MarkdownContent` for `stimulusText` (reuse from `app/(test)/_components/question/MarkdownContent.tsx`) |
| Figure | `QuestionFigure` if `figureAssetPath` set |
| User answer | `userAnswer` or "No answer" |
| Correct answer | `correctAnswer` |
| Correct/incorrect indicator | `isCorrect` — subtle green/red or check/x (keep clinical, not garish) |
| Rationale | `rationale` in a distinct block below |
| Time spent | `formatDuration(timeSpentSeconds)` |
| Flagged indicator | If `flagged`, small note |
| Seen before badge | `SeenBeforeBadge` when `wasRecycled` |

**`SeenBeforeBadge`:**
- Text: **"Seen before"**
- Small, outline-style badge (PRD §8: functional accent only)

**R&W layout:** Consider reusing `splitRwStimulus` for two-pane feel, or single-column review layout — either is acceptable if readable. Do not wire interactive cross-out/highlighter on review (read-only).

**MC choices:** Show all choices with user's selection highlighted and correct letter marked. Read-only — no `onSelectChoice`. You may build a simple read-only choice list rather than forcing `QuestionRenderer` (which expects runner interaction props). Reuse `ChoiceRow` styling if practical.

**Grid-in:** Show user value vs correct answer(s); `correctAnswer` may be comma-separated equivalents.

**Tests (`AnswerReviewRunner.test.tsx`):**
- Fixture array of 2–3 `ReviewQuestion` objects
- Assert Q1 renders, Next advances, Back returns
- Assert correct/incorrect styling for one right and one wrong question
- Assert `Seen before` badge when `wasRecycled: true`
- Assert rationale and time spent visible

---

### Track C — Navigation wiring

**Files to modify:**
- `app/(test)/test/[attemptId]/submitted/SubmittedScreen.tsx`
- `app/(test)/test/[attemptId]/submitted/SubmittedScreen.test.tsx`
- `app/_components/home/AttemptHistory.tsx`
- `app/_components/home/AttemptHistory` tests if they exist (or add `AttemptHistory.test.tsx`)
- `app/(test)/test/[attemptId]/_lib/clientApi.ts` — only if needed

**`SubmittedScreen` (2C.1):**
- After `postSubmit` succeeds, navigate to `resultsPath(attemptId)` via `useRouter().push`
- Replace placeholder copy ("future update") with brief confirmation, then auto-redirect OR show a "View results" button — **prefer auto-redirect after successful submit** for smoother flow
- Handle submit error: show message, allow retry (reset `submittedRef` on failure — already partially there)
- Update `SubmittedScreen.test.tsx` to expect navigation to `/test/42/results` after submit

**`AttemptHistory` (2C.2):**
- For completed attempts (`!attempt.resumable` and `status === 'submitted'` or `totalScaledScore != null`):
  - Show total score: e.g. **"Score: 1120"** (format as plain number)
  - Replace static "Completed" with **"View results"** link → `resultsPath(attempt.attemptId)`
- In-progress attempts: unchanged (Resume link)
- Import `resultsPath` from `lib/testFlow`

**`clientApi.ts` (2C.3) — optional:**
- Add `getResults(attemptId): Promise<AttemptScores>` only if a client component needs it
- Prefer Server Components and skip this if unused

---

## Suggested file ownership (parallel work)

If using worktrees/branches:

| Branch | Owns |
|---|---|
| `epic-5/wave-2-guards` | `guardPosition.ts` — merge first |
| `epic-5/wave-2-results-dashboard` | Track A files |
| `epic-5/wave-2-answer-review` | Track B files |
| `epic-5/wave-2-navigation` | Track C files |

**Conflict hotspot:** `guardPosition.ts` — one PR for both guards before parallel UI work, or designate one agent to land guards first.

---

## Testing requirements

Before reporting done, all must pass:

```bash
npm test
npm run test:ui
npm run lint
npm run build
```

**New tests required:**
- `ResultsDashboard.test.tsx` (Vitest)
- `AnswerReviewRunner.test.tsx` (Vitest)
- Update `SubmittedScreen.test.tsx` for results navigation
- Optionally `AttemptHistory.test.tsx` for score + link

**Test conventions (match Epic 3/4):**
- UI components: Vitest + Testing Library in `app/`
- Fixture-driven; mock `next/navigation` router where needed
- No DB in component tests — pass props from fixtures
- `node:test` is for `lib/` only

---

## Acceptance criteria

Wave 2 is **done** when all of the following hold:

1. Submitting a full test → `SubmittedScreen` → lands on `/test/:id/results` with scores visible
2. Results page shows total, R&W, Math scaled scores with **approximate** disclaimer
3. Results page shows all 8 domains with correct/total and progress bars
4. "Review answers" opens `/test/:id/results/answers` with 98 questions navigable via Back/Next
5. Answer review shows user answer, correct answer, rationale, time spent, correct/incorrect state
6. Recycled questions show **"Seen before"** badge
7. Home **Past attempts** shows total score + "View results" for completed tests
8. In-progress attempt URL `/test/:id/results` redirects away (not submitted)
9. In-test `/test/:id/review` still works unchanged
10. Mid-test runner still does not expose answer key
11. All automated tests pass

---

## Manual smoke (optional but recommended)

After implementation, verify in browser:

1. Complete a practice test end-to-end
2. Confirm results dashboard numbers match `GET /api/attempts/:id/results`
3. Walk through several answer-review questions
4. Return home — completed attempt shows score
5. Start a new test, try opening `/test/:newId/results` directly — should redirect

---

## PR / commit guidance

- Do not commit unless the user asks
- Keep diffs focused — no drive-by refactors
- Match existing naming, Tailwind patterns, and component structure in `app/(test)/`
- Follow [AGENTS.md](../AGENTS.md) Next.js rules if touching framework APIs

---

## Quick reference — key types

```ts
// lib/scoring.ts
interface AttemptScores {
  attemptId: number;
  rwScaled: number;
  mathScaled: number;
  totalScaled: number;
  raw: {
    modules: { section; module; correct; total }[];
    sections: { section; correct; total }[];
    domains: { section; domain; correct; total }[];
  };
}

// lib/resultsContract.ts
interface ReviewQuestion {
  id: string;
  number: number;        // 1–98
  section: "rw" | "math";
  module: 1 | 2;
  questionType: "mc" | "grid_in";
  stimulusText: string;
  choices: RunnerChoice[];
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

```ts
// lib/testFlow.ts
resultsPath(42)       // "/test/42/results"
answerReviewPath(42)  // "/test/42/results/answers"
```

---

## Out of scope for this wave

- Epic 5 Wave 3 verification gate (unless fixing regressions you introduced)
- Score trend chart (Epic 7.2)
- Drill mode (Epic 6)
- Changes to scoring curves or `submitAttempt` behavior
- Pixel-perfect College Board score report clone
