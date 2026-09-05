# Epic 6 — Drill Mode: implementation plan

**Status:** Wave 1–2 landed (revision 1)
**Covers:** PRD Stories 6.1–6.4
**Depends on:** Epics 0–2 (schema, question bank, `question_serve_log`); Epic 3 Story 3.7 time-tracking semantics

---

## Architectural decisions

**D1 — Random selection from filtered pool.** Drill is exempt from full-test LRU recycling (PRD §3.3). Questions are picked with `ORDER BY RANDOM()` within domain/skill/difficulty filters.

**D2 — One question at a time, unlimited session.** Student ends explicitly via “End session” or when the filtered pool is exhausted.

**D3 — Instant feedback after “Check answer”.** MC requires a selected letter; grid-in allows blank (graded incorrect).

**D4 — Route namespace `/drill/*`.** Separate from `/test/*` guards.

**D5 — Time tracking reuses Story 3.7 rules.** `useDrillTimeTracker` mirrors active-view semantics; persisted on `drill_session_questions.time_spent_seconds` (migration 0013).

---

## Routes

| Route | Purpose |
|---|---|
| `/drill` | Domain/skill/difficulty picker (6.1) |
| `/drill/:id` | Untimed runner with instant feedback (6.2) |
| `/drill/:id/summary` | Session summary (6.3) |

## API

| Method + path | Purpose |
|---|---|
| `POST /api/drill/sessions` | Start session + serve Q1 |
| `POST /api/drill/sessions/:id/answers` | Grade current question |
| `POST /api/drill/sessions/:id/next` | Serve next question |
| `POST /api/drill/sessions/:id/time` | Accumulate `time_spent_seconds` |

---

## Files

| Layer | Files |
|---|---|
| Contract | `lib/drillContract.ts`, `lib/drillFlow.ts` |
| Service | `lib/drillService.ts` |
| Migration | `migrations/0013_add_drill_time_spent.sql` |
| API | `app/api/drill/**` |
| UI | `app/drill/**`, `app/_components/home/DrillModeEntry.tsx` |

---

## Manual QA checklist

1. Home → **Drill mode** → picker loads domains/skills from bank
2. Start drill → first question renders (R&W two-pane and Math single column)
3. Check answer → correct/incorrect + rationale + time spent
4. Next question → new item; repeat until pool exhausted or End session
5. Summary shows accuracy, answered count, filters
6. Time accumulates on refresh mid-question (within ~15s flush window)
