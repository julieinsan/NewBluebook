# Epic 3 — Test-Taking Experience: implementation plan

**Status:** Waves 0–3 and Task 4.1 landed; **Task 4.2 (manual QA) is the only remaining gate** (revision 4 — see §11)
**Covers:** PRD Stories 3.1–3.6, plus the requirement in
[epic-3-module-transition-seam.md](epic-3-module-transition-seam.md), plus practice-app pause/resume (§3.1, D13)
**Depends on:** Epics 0–2 (schema, ingestion, assembly engine) — all landed.
**Verification:** 93 `npm test`, 29 `npm run test:ui`, `npm run build` clean, `npm run smoke:flow` passes.

---

## 1. Where we started (Epic 2 handoff)

Epic 2 left a complete, tested server-side assembly engine and no UI. Epic 3 closed the
five gaps identified at kickoff:

| Gap | Resolution |
|---|---|
| No transition seam | `lib/moduleTransition.ts` — §4, Task 1.1 |
| No timer authority | Migration 0009 + D3/D3a — module/break `started_at` stamps |
| No completion state past Module 1 | `{section}_module2_submitted_at` columns + D10 |
| No read model for a runner | `readModuleQuestions` export — Task 0.3, `getRunnerModule` |
| No UI test runner | Vitest + Testing Library — Task 0.5 |

Everything below §2 is the original plan; Waves 0–3 and 4.1 are **done**. See §11 for the
completion log.

---

## 2. Architectural decisions

Decisions confirmed with Julie are marked ✔; the rest are defaults — flag any that look
wrong before Wave 1 starts, they are cheap to change now and expensive later.

**D1 — The whole module ships to the client at once.** A module is 27 (R&W) or 22 (Math)
questions. The runner page loads all of them in one payload and Next/Back is pure client
state, with zero network in the interaction path. This is what makes navigation feel like
real Bluebook and makes the review-grid jump instant. Answers flow back in the background.

**D2 — Mutations go through Route Handlers, not Server Actions.** Three reasons, all
specific to this app: Next dispatches Server Actions *one at a time per client*
(`node_modules/next/dist/docs/01-app/02-guides/server-actions.md`), so a slow autosave
would queue ahead of the end-of-module submit — the one request that must not be delayed;
`fetch(..., {keepalive:true})` / `sendBeacon` let us flush a pending answer on unload; and
the seam doc frames the transition as a route handler. Server Components still do all
*reads* directly against SQLite.

**D3 — Server-authoritative deadline, soft enforcement.** ✔ Each module stamps a
`started_at` server-side; the deadline is `started_at + blueprint limit`. The API returns
`{deadline, serverNow}` so the client corrects for clock skew and a refresh resumes the
true remaining time. Answers arriving slightly late are still saved (5-second grace, one
named constant); expiry auto-submits by POSTing the *same* end-module request the Submit
button posts — precisely the double-delivery §4 makes safe.

**D3a — Every timestamp stamp is write-if-null and happens in a Route Handler.** Never
during render. A Server Component that stamps `started_at` would re-stamp on every
refresh and reset the countdown forever; it is also a write during a render pass Next may
retry. Concretely, every stamp in this epic is owned by a handler (§5.5):

| Column | Stamped by |
|---|---|
| `rw_module1_started_at` | `POST /api/attempts` |
| `rw_module2_started_at`, `math_module2_started_at` | `end-module` (module 1), on first assembly only |
| `break_started_at` | `end-module` (R&W module 2) |
| `math_module1_started_at` | `end-break` |
| `{section}_module{1,2}_submitted_at` | `end-module` |
| `submitted_at`, `status` | `submit` |

One consequence worth naming, because it constrains Wave 3: since each transition stamps
the *next* module's clock, Module 2's countdown starts at the `end-module` request, not
when the student loads the page. A student who ends Module 1 and walks away returns to a
partly-burned Module 2. That is correct for a timed test and is the direct price of "no
stamping during render" — but it means there can be no "ready to begin Module 2?"
interstitial unless someone deliberately gives it a stamp owner.

**D4 — One canonical position, enforced by redirect, at module granularity only.**
`resolveCurrentPosition(state)` returns the attempt's current *(section, module)* — or
`break`, or `submitted`. Test routes compare their own params against it and redirect when
they disagree, which kills back-button-into-a-finalized-module, hand-typed URLs and stale
tabs in one code path. It deliberately stops at module granularity: which question the
student is on, and whether they are on that module's review screen, is **sub-position**
that `test_attempts` cannot see. The guard must let sub-position through untouched, or it
will bounce students off `/review` and back into the runner.

**D5 — Flagging is real; cross-out and highlights get plumbing only.** ✔ Story 3.4
flagging ships fully. `crossed_out_choices` and `highlights` ride the same save endpoint
(already columns on `test_attempt_questions`) but no Epic 4 UI is built, so Epic 4 adds
components against a persistence path that already works.

**D6 — Final submit lands on a stub.** ✔ Submitting Math Module 2 sets
`status='submitted'` + `submitted_at` and lands on a plain confirmation page. Epic 5
replaces that page; nothing else in Epic 3 depends on scoring.

**D7 — DB-reading pages must call `connection()` first.** ✔ Not optional and easy to miss:
without a Request-time API, Next prerenders these pages at build and a synchronous
`better-sqlite3` query *completes during prerendering*. The framework docs call out
better-sqlite3 by name
(`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/connection.md`).
Added to `app/page.tsx` and all test routes in Task 3.1.

**D8 — The section break is 10 minutes, counted down, skippable.** ✔ `break_started_at`
is stamped when R&W Module 2 ends; the break screen counts down against it (so a refresh
resumes it) and offers "Resume testing" to end early. Either way Math's clock starts only
when the break ends, via `end-break`. Duration is a named constant beside the module
limits in `lib/blueprint.ts`.

**D9 — Start-new-test is idempotent against an in-progress attempt.** ✔ (review §9.5)
**Superseded by D9′** — see [home-test-selection.md](./home-test-selection.md). The home
screen now offers Practice Test 1 / 2 and allows multiple in-progress attempts; resume is
explicit via Attempt History.

_Original D9 (Epic 3):_ A double-clicked "Start new test" must not create two in-progress
attempts — "resume" becomes ambiguous the moment it does. `POST /api/attempts` returned the
existing in-progress attempt with `reused: true` rather than creating a second.

**D10 — An attempt is finished when Math Module 2 is.** (Wave 0 finding.) `end-module`
stamps `math_module2_submitted_at`, while `submit` separately sets `status='submitted'` —
so there is a window where the last section is over but the attempt row still says
`in_progress`. `resolveCurrentPosition` keys off **`math_module2_submitted_at`**, not
`status`, and returns `{kind:"submitted"}` the moment it is set. `submitAttempt` stays
separately idempotent, so a crash between the two POSTs leaves the student on the
confirmation page rather than stranded inside a finalized module. `status` remains the
field Epics 5 and 7 query for "is this attempt scoreable/historical"; it is not the field
the runner routes on.

**D11 — `next` is a path string.** Every endpoint in §5.5 returns `next`; it is the string
from `pathForPosition(attemptId, position)` in `lib/testFlow.ts`, never a structured
`ModulePosition`. The client navigates to it directly and never re-derives a route.

**D12 — Flagging is not deadline-checked.** The question-state endpoint takes no grace
window: flagging, un-flagging and (later) cross-out are navigation aids, not answers, and
a student tidying flags a second after the buzzer has not gained anything. Only
`POST .../answers` enforces D3's grace window.

**D13 — Practice-app pause freezes the active clock; resume is explicit from home.** ✔
Added post-Wave 3 (migration 0010). Intentionally diverges from real Bluebook, where module
time never stops. `pauseAttempt` stamps `paused_at` + `paused_phase` (which of the five
clocks is frozen: `rw:1`, `rw:2`, `break`, `math:1`, `math:2`) without changing position
stamps. `resumeAttempt` accumulates elapsed seconds into the matching `*_pause_seconds`
column and clears the pause stamp. While paused:

- Countdowns freeze via `effectiveNow` / `effectiveModuleDeadline` / `effectiveBreakDeadline`
- Answers are rejected (`saveAnswerWithDeadline` returns `{saved: false}`)
- All test routes redirect to `/` (`redirectIfPaused` in `guardPosition.ts`)
- Resume is **only** from home (`ResumeButton` → `POST .../resume` → `next`); in-progress
  attempts that are not paused deep-link directly via `listAttempts().path`

Resume lands at the **module runner** (question 1), not review or the exact question —
consistent with D4's module-granular position (§9 item 8). Pausing from the review screen
still resumes to the runner; review sub-position is not persisted.

---

## 3. Schema change (migration 0009)

One migration, seven columns, all nullable — no backfill, no data risk:

```sql
ALTER TABLE test_attempts ADD COLUMN rw_module1_started_at     TEXT;
ALTER TABLE test_attempts ADD COLUMN rw_module2_started_at     TEXT;
ALTER TABLE test_attempts ADD COLUMN math_module1_started_at   TEXT;
ALTER TABLE test_attempts ADD COLUMN math_module2_started_at   TEXT;
ALTER TABLE test_attempts ADD COLUMN rw_module2_submitted_at   TEXT;
ALTER TABLE test_attempts ADD COLUMN math_module2_submitted_at TEXT;
ALTER TABLE test_attempts ADD COLUMN break_started_at          TEXT;
```

`started_at` powers D3's timer and resume; `break_started_at` does the same for D8's
break. `module2_submitted_at` closes gap 1.3 — with it, section and attempt completion are
fully derivable from `test_attempts` alone, with no counting of answered rows.

### 3.1 Schema change (migration 0010 — pause/resume, D13)

Seven columns on `test_attempts`, all landed:

```sql
ALTER TABLE test_attempts ADD COLUMN paused_at TEXT;
ALTER TABLE test_attempts ADD COLUMN paused_phase TEXT
  CHECK (paused_phase IS NULL OR paused_phase IN ('rw:1', 'rw:2', 'break', 'math:1', 'math:2'));
ALTER TABLE test_attempts ADD COLUMN rw_module1_pause_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE test_attempts ADD COLUMN rw_module2_pause_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE test_attempts ADD COLUMN break_pause_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE test_attempts ADD COLUMN math_module1_pause_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE test_attempts ADD COLUMN math_module2_pause_seconds INTEGER NOT NULL DEFAULT 0;
```

Domain: `lib/pauseTransition.ts` (`pauseAttempt` / `resumeAttempt`). Pause-adjusted
deadlines and frozen clocks live in `lib/testFlow.ts`; read models in `lib/attemptState.ts`
(`getBreakTimer`, `TimerInfo.paused`).

---

## 4. The transition seam (the seam doc's requirement)

Implemented exactly as the doc recommends — idempotence at the handler, neither primitive
weakened:

1. **`ModuleAlreadySubmittedError`** — an exported `Error` subclass thrown by
   `finalizeModule1`, carrying `attemptId`, `section`, `submittedAt`. Same message text as
   today so existing tests keep passing; callers now branch on `instanceof`, never on
   message text. This is the doc's stated prerequisite.
2. **`endModule1(db, attemptId, section)`** in a new `lib/moduleTransition.ts` — the one
   place that legitimately expects duplicates:

   ```ts
   try {
     finalizeModule1(db, attemptId, section);
   } catch (err) {
     if (!(err instanceof ModuleAlreadySubmittedError)) throw err;
     // An earlier delivery of this same request already finalized -- fall through to
     // assembly, which is idempotent and returns the Module 2 already on record.
   }
   const module2 = assembleModule2ForSection(db, attemptId, section);
   ```

   It also stamps `{section}_module2_started_at` write-if-null (D3a), so a retry cannot
   restart the Module 2 clock.
3. **Test** covering double delivery: same result twice, exactly 27 (R&W) / 22 (Math)
   module-2 rows, and a non-seam error from `finalizeModule1` still propagating.

Done when the seam doc's three "Done when" bullets hold.

---

## 5. Work breakdown

Thirteen tasks in four waves. Wave *n* may not start until wave *n−1* is merged.

### Wave 0 — Contracts ✅ Done

| # | Task | Files | Status |
|---|---|---|---|
| 0.1 | Migration 0009 (§3) | `migrations/0009_add_module_timing.sql` | ✅ |
| 0.2 | Shared types + deadline functions | `lib/testFlow.ts` | ✅ |
| 0.3 | Widen and export `readModuleQuestions` | `lib/attemptService.ts` | ✅ |
| 0.4 | Break duration constant (D8) | `lib/blueprint.ts` | ✅ |
| 0.5 | Vitest + Testing Library setup (§5.6) | `vitest.config.mts`, `package.json` | ✅ |
| 0.6 | Freeze the HTTP contract (§5.5) into this doc | this file | ✅ |

**0.2's deadline functions are load-bearing for parallelism.** Task 1.3 needs a deadline
to enforce D3's grace window and Task 1.2 needs one to build `TimerInfo`. If that logic
lived in either task's file, the other would be blocked on unmerged work by a different
agent in the same wave. As a pure function over `blueprint.ts` + a timestamp, both import
it and neither waits.

**0.3 must widen, not just rename.** `readAssembledModule` currently selects `q.*`,
`order_index` and `was_recycled` only. Exporting it as-is would leave Task 1.2 writing its
own query and duplicating the `wasRecycled` CTE — the one piece of logic in that file with
a subtle correctness argument behind it (it compares serve-log `id`, not `served_at`,
because whole-second timestamps tie). One owner for that query.

### Wave 1 — Server domain ✅ Done

| # | Task | Owns | Status |
|---|---|---|---|
| 1.1 | **Transitions & the seam** (§4) | `lib/moduleTransition.ts`, `lib/moduleTransition.test.ts` | ✅ |
| 1.2 | **State machine + read models** | `lib/attemptState.ts`, `lib/attemptState.test.ts` | ✅ |
| 1.3 | **Per-question state** | `lib/questionState.ts`, `lib/questionState.test.ts` | ✅ |

Each imports from `attemptService.ts` / `blueprint.ts` / `testFlow.ts`, but only 1.1 edits
any pre-existing file.

### Wave 2 — HTTP + presentational UI ✅ Done

| # | Task | Owns | Status |
|---|---|---|---|
| 2.1 | **Route handlers** per §5.5 | `app/api/attempts/**/route.ts` | ✅ |
| 2.2 | **Chrome & primitives** | `app/(test)/_components/*` + `*.test.tsx` | ✅ |
| 2.3 | **Question renderers** | `app/(test)/_components/question/*` + `*.test.tsx` | ✅ |

2.2 and 2.3 consume only Wave 0 types, so they can start the moment Wave 0 lands — in
practice alongside Wave 1, not after it.

### Wave 3 — Pages & integration ✅ Done

| # | Task | Stories | Owns | Status |
|---|---|---|---|---|
| 3.1 | **Home screen** | 3.1 | `app/page.tsx`, `app/_components/home/*` | ✅ |
| 3.2 | **Module runner** | 3.2, 3.3, 3.4 | `app/(test)/test/[attemptId]/[section]/[module]/*` | ✅ |
| 3.3 | **Review, break, submit, stub** | 3.4, 3.5, 3.6 | `app/(test)/test/[attemptId]/review\|break\|submitted/*` | ✅ |

**Post-Wave 3 add-on (D13):** pause/resume UI and API — `PauseAndExitMenu`, `ResumeButton`,
`POST .../pause`, `POST .../resume`, migration 0010.

### Wave 4 — Verification

| # | Task | Owns | Status |
|---|---|---|---|
| 4.1 | **Lifecycle test** — full start→submit domain walk, double-delivery at both section boundaries, expired-module behavior, break stamping, resume-after-refresh, D9 double-start | `lib/testFlowLifecycle.test.ts`, `scripts/smoke-test-flow.ts`, `package.json` | ✅ |
| 4.2 | **Manual QA** — browser walk-through against PRD §8 (see checklist below) | — | ⬜ Remaining |

### 5.5 HTTP contract (frozen — Task 2.1 implements exactly this)

| Method + path | Body | Returns | Notes |
|---|---|---|---|
| `POST /api/attempts` | — | `{attemptId, reused, next}` | `startNewAttempt`; stamps `rw_module1_started_at`. **Idempotent** per D9 — returns the in-progress attempt if one exists |
| `POST /api/attempts/:id/answers` | `{section, module, questionId, userAnswer}` | `{saved, isLate}` | D3 grace; never returns correctness |
| `POST /api/attempts/:id/questions/:qid/state` | `{section, module, flagged?, crossedOut?, highlights?}` | `{ok}` | D5. No deadline check (D12) |
| `POST /api/attempts/:id/end-module` | `{section, module}` | `{next, module2?}` | **Idempotent** — §4. Same 200 on every delivery. Stamps the next clock (D3a); ending R&W module 2 stamps `break_started_at` |
| `POST /api/attempts/:id/end-break` | — | `{next}` | **Idempotent.** Ends D8's break early or on expiry; stamps `math_module1_started_at` |
| `POST /api/attempts/:id/submit` | — | `{ok}` | Idempotent; sets `status='submitted'` |
| `POST /api/attempts/:id/pause` | — | `{ok}` | **D13.** Freezes active clock; idempotent. Client navigates to `/` |
| `POST /api/attempts/:id/resume` | — | `{next}` | **D13.** Accumulates pause seconds; returns D11 path to module/break/submitted |

Every response is JSON; every handler returns the caller's *next position* so the client
never has to guess a route. Per **D11** `next` is always the path string from
`pathForPosition`. Ending Math Module 2 returns `submittedPath(...)` per **D10**, whether
or not `submit` has been called yet. (`pause` is the exception — it returns `{ok}` and the
client always goes home.)

### 5.6 UI test setup (Task 0.5) and its hard limit

Per the framework's own Vitest guide
(`node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md`):

```
npm i -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom vite-tsconfig-paths
```

`vitest.config.mts` uses `plugins: [tsconfigPaths(), react()]` and
`test: { environment: 'jsdom' }`.

Two constraints that will otherwise cost an afternoon:

- **Scope the `include` glob to `app/**/*.test.tsx`.** Vitest's default picks up
  `lib/**/*.test.ts`, which would drag the `node:test` + `better-sqlite3` suite into jsdom.
  `npm test` stays `node:test` for `lib/`; add a separate `npm run test:ui`.
- **Vitest cannot render `async` Server Components** — the guide says so explicitly and
  recommends E2E for them. So Vitest covers Tasks 2.2 and 2.3 in full and the *client*
  subcomponents of 3.1 and 3.3; the async pages themselves stay on Task 4.2's manual pass.
  This is the honest coverage boundary, not an aspiration.

---

## 6. Rules for the parallel work

1. **One file, one owner, one wave.** The tables above are the authority. An agent that
   needs a change in someone else's file stops and reports it rather than editing.
2. **Read the framework docs first.** Per `AGENTS.md` this is not the Next.js in your
   training data. Relevant here: `01-app/01-getting-started/15-route-handlers.md`,
   `05-server-and-client-components.md`, `04-functions/connection.md`,
   `02-guides/testing/vitest.md`. Confirmed specifics: `params` is a Promise; typed helpers
   are `PageProps<'/route'>` / `LayoutProps<'/route'>` (already used in `app/layout.tsx`).
3. **`better-sqlite3` is synchronous and must stay that way.** Every `db.transaction`
   callback is sync. No `async` anywhere in `lib/` DB code.
4. **No writes during render.** Mutations live in Route Handlers only (D2, D3a). A Server
   Component reads and redirects; it never stamps.
5. **`npm test`, `npm run test:ui` and `npm run lint` pass before reporting done.** New
   behaviour comes with a test in the matching harness style.
6. **Never touch `data/bluebook.db` from a test.** In-memory DB seeded from the real
   migrations, as the existing harness does.
7. **Never call `new Date()` on a database timestamp.** SQLite's `datetime('now')`
   writes `"2026-09-05 14:23:11"` — UTC, but with no `T` and no `Z`, so it is not ISO-8601
   and V8 parses it as *local* time. Measured on this machine's timezone the skew is 240
   minutes against a 32-minute module: every deadline either expires on load or grants
   hours of extra time, and it is invisible in CI, which runs UTC. Use
   `parseSqliteTimestamp` / `formatSqliteTimestamp` from `lib/testFlow.ts`, which throw on
   a malformed stamp rather than returning `NaN` (`now <= NaN` is `false`, so a bad stamp
   would otherwise read silently as "time expired").
8. `lib/attemptService.test.ts` gained a test in Wave 0. Task 1.1 owns that file next —
   rebase onto it rather than assuming the Epic 2 version.
9. The repo is **not** Prettier-clean at baseline (`lib/moduleAssembly.ts`,
   `lib/questionSelector.ts`, `scripts/*` were already failing `npm run format:check`
   before Epic 3). Match surrounding hand-formatting; do not reformat files you don't own,
   or the diff will bury the actual change.
10. The `AGENTS.md` header block is rewritten by `next dev`; commit it with the work rather
   than reverting it.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Autosave races the end-module POST and an answer is lost | Runner tracks in-flight saves and flushes them before posting end-module; D3's grace window covers the straggler |
| Timer double-fires with a manual submit (the seam doc's own warning) | §4 makes the endpoint idempotent; 4.1 tests exactly this at both section boundaries |
| A stamp lands during render and resets the clock every refresh | D3a: stamps are write-if-null and handler-only; §6 rule 4; 4.1 asserts a refresh does not move a deadline |
| Prerendering silently freezes DB reads | D7 — `connection()` in every DB-reading Server Component; added to `app/page.tsx` in Task 3.1 |
| Double-clicked "Start new test" strands two in-progress attempts | D9 — the endpoint returns the existing attempt; 4.1 covers it |
| Bank capacity (PRD §3.3): only ~1 fresh full test | Expected. Recycled questions must surface in Epic 5's review — don't lose `wasRecycled` through Wave 1's read models |
| A DB timestamp is parsed as local time, skewing every deadline | §6 rule 7 — `parseSqliteTimestamp` only; it throws instead of yielding `NaN`. 4.1 asserts deadlines under a non-UTC `TZ` |
| `resolveCurrentPosition` and `status` disagree about a finished attempt | D10 — position keys off `math_module2_submitted_at`; `status` is for Epics 5/7 |
| Runner state sprawls into an unmaintainable client component | 2.2/2.3 stay presentational; all state lives in the one runner in 3.2 |
| UI coverage looks better than it is | §5.6 names the boundary: async Server Components are manual-QA only |
| Stale tab POSTs while paused | Guards block page loads; transition endpoints do not yet reject paused attempts |
| Pause from review resumes to runner Q1 | By design per D4/D13; review sub-position is not persisted |

---

## 8. Suggested execution order

```
Wave 0  ✅  0.1–0.6
Wave 1  ✅  1.1–1.3
Wave 2  ✅  2.1–2.3
Wave 3  ✅  3.1–3.3  (+ pause/resume, D13)
Wave 4       4.1 ✅   4.2 ⬜ manual QA
```

Epic 3 closes when Task 4.2 passes. Next epic: **Epic 4 — In-Test Tools** (PRD Stories 4.1–4.4).

### Task 4.2 manual QA checklist

Run `npm run dev`, walk a full attempt in the browser:

1. **Home (3.1):** Start new test; resume in-progress; attempt history; drill stub disabled
2. **Runner (3.2):** Next/Back; review-grid jump; answers persist after refresh
3. **Timer (3.3):** Hide/reveal countdown; auto-submit on expiry
4. **Flagging + review (3.4):** Flag toggle; end-of-module review lists flagged/unanswered; confirm dialog
5. **Break (3.5):** 10-min countdown; "Resume testing" ends early; refresh resumes break timer
6. **Submit (3.6):** Module submit confirmation; Math M2 → submitted stub
7. **Guards (D4):** Back button / stale URL redirects to canonical position; `/review` not bounced
8. **Pause (D13):** Pause from runner, review, and break → home; timer frozen; resume → same module/break with same remaining time; answers blocked while paused
9. **Visual (PRD §8):** Top/bottom bars, two-pane R&W, single-pane Math, blue accent palette

Known deferrals (not Epic 3): Math calculator and reference sheet (Epic 4.3/4.4); cross-out UI (Epic 4.1).

---

## 9. Review log (revision 1 → 2)

What changed and why, so the reasoning isn't lost:

1. **Timer stamps had no owner, and the only natural one was illegal.** Revision 1 listed a
   `startModule` nothing called; the runner's Server Component would have been the de facto
   caller, re-stamping on every refresh. → **D3a**, the stamp-ownership table, and Task 1.1
   restructured so each transition stamps the next module's clock.
2. **Wave 1 wasn't actually parallel.** Task 1.3's grace-window check needed the deadline
   from Task 1.2's file. → deadline functions moved into Wave 0's `testFlow.ts`.
3. **D4's guard would have bounced students off the review screen.** Position derived from
   `test_attempts` is module-granular and cannot see sub-position. → D4 rewritten to guard
   at module granularity and pass sub-position through.
4. **Task 0.3's rationale didn't hold.** `readAssembledModule` returns no `user_answer` or
   `flagged`, so exporting it unchanged would have left Task 1.2 duplicating the
   `wasRecycled` CTE. → 0.3 widens the query as well as exporting it.
5. **`POST /api/attempts` wasn't idempotent.** → **D9**.
6. **Four subagent tasks had no automated verification** while the plan implied `npm test`
   covered everything. → Task 0.5 adds Vitest + Testing Library, and §5.6 states the
   async-Server-Component limit rather than papering over it.
7. **Broken cross-reference and an unspecified break.** Revision 1 cited "D6 timing rules"
   for the section break; D6 is the post-submit stub, and no break duration existed
   anywhere. → **D8** (10 minutes, counted down off `break_started_at`, skippable).
8. **Resume granularity was unstated.** Resuming lands at the *module*, not the exact
   question — consistent with D4's module-granular position. Tasks 3.1 and 3.2 both assume
   this; it is written down here so they don't diverge.

---

## 10. Review log (revision 2 → 3, after Wave 0)

Wave 0 landed as specified — migration 0009, `lib/testFlow.ts`, the widened
`readModuleQuestions`, `BREAK_DURATION_SECONDS`, and the Vitest setup — with 34/34
`node:test`, 2/2 Vitest, `tsc` and `lint` clean, and migration idempotence verified against
an in-memory DB. Building it surfaced four things:

1. **The SQLite-timestamp / `new Date()` hazard** (§6 rule 7). Verified empirically at 240
   minutes of skew in US Eastern against a 32-minute module. This was latent in every
   revision of this plan, which said "deadline is `started_at` + limit" without saying how
   `started_at` gets parsed. Now owned by `parseSqliteTimestamp`.
2. **The Math Module 2 endgame was ambiguous** — `end-module` and `submit` both claim a
   piece of "the attempt is over", and Tasks 1.1 and 1.2 would have resolved it
   differently in parallel. → **D10**.
3. **`next` had no type** despite every endpoint returning it. → **D11**.
4. **The question-state endpoint had no deadline rule.** → **D12**.

Also folded in from Wave 0: `AssembledModuleQuestion` now carries a `state` field so
assembly and read-back share one shape (this was the compatibility risk flagged in Task
0.3); `is_correct` is deliberately excluded from that shape, since it feeds D1's runner
payload and correctness must not reach the client mid-test; and `crossed_out_choices` /
`highlights` stay raw JSON text, because D5 plumbs them and Epic 4 owns their shape.

---

## 11. Review log (revision 3 → 4, Waves 1–4.1 + pause)

All thirteen original tasks plus pause/resume landed on branch `epic-3/wave-0-contracts`:

1. **Waves 1–3 shipped as specified.** Domain layer (`moduleTransition`, `attemptState`,
   `questionState`), seven HTTP route handlers, presentational components, and integrated
   pages (home, runner, review, break, submitted stub). `connection()` on all DB-reading
   Server Components (D7).
2. **Wave 4.1 automated verification.** `lib/testFlowLifecycle.test.ts` (8 tests) covers
   full lifecycle, double-delivery at both section boundaries, expired-module grace,
   break stamping, resume-after-refresh deadline stability, and D9 double-start.
   `scripts/smoke-test-flow.ts` (`npm run smoke:flow`) replays the same invariants against
   the real DB.
3. **Pause/resume added (D13, migration 0010).** Practice-app feature beyond the original
   thirteen tasks. `lib/pauseTransition.ts`, pause/resume API routes, `PauseAndExitMenu` on
   runner/review/break, `ResumeButton` on home, pause-adjusted deadlines in `testFlow.ts`.
   `lib/pauseTransition.test.ts` covers freeze, idempotence, answer block, and break pause.
4. **Build fix.** `BREAK_DURATION_SECONDS` imported from `lib/blueprint.ts` in
   `attemptState.ts` (was incorrectly imported from `testFlow.ts`, which does not re-export it).
5. **Test counts at close of 4.1:** 93 `npm test`, 29 `npm run test:ui`, `npm run build`
   clean. Task 4.2 (manual browser QA per §8 checklist) is the remaining gate.
