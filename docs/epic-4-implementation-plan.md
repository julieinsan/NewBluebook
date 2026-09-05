# Epic 4 — In-Test Tools: implementation plan

**Status:** Ready to start (revision 1)
**Covers:** PRD Stories 4.1–4.4 ([PRD.md](../PRD.md) § Epic 4, §8 visual spec)
**Depends on:** Epic 3 complete (Task 4.2 manual QA can run in parallel with Wave 1)
**No schema migration** — `crossed_out_choices` and `highlights` columns and `POST .../questions/:qid/state` landed in Epic 3 (D5).

---

## 1. Where we're starting from

Epic 3 delivered the **persistence layer**; Epic 4 is almost entirely **client UI + wiring**.

| Already exists | Where |
|---|---|
| DB columns `crossed_out_choices`, `highlights` | `migrations/0003_create_test_attempt_questions.sql` |
| `setChoiceState` (partial updates, no deadline check) | `lib/questionState.ts` |
| API route `{ flagged?, crossedOut?, highlights? }` | `app/api/attempts/[id]/questions/[qid]/state/route.ts` |
| `RunnerQuestion.crossedOutChoices` / `.highlights` in payload | `lib/testFlow.ts`, `lib/attemptState.ts` |
| `ChoiceRow` cross-out button + line-through styling | `app/(test)/_components/ChoiceRow.tsx` |
| Layout props `crossedOutLetters`, `onToggleCrossOut` | `QuestionRenderer`, `RwQuestionLayout`, `MathQuestionLayout` |
| Flag wiring pattern (optimistic + rollback) | `ModuleRunner.tsx` `handleToggleFlag` |
| R&W two-pane passage (left) | `RwQuestionLayout.tsx` |

| Still missing | Stories |
|---|---|
| `ModuleRunner` → cross-out handlers + `postQuestionState` | 4.1 |
| `postQuestionState` TypeScript types for `crossedOut` / `highlights` | 4.1, 4.2 |
| Passage highlight UI + render | 4.2 |
| Math tool buttons on TopBar | 4.3, 4.4 |
| Desmos embed + reference sheet modal | 4.3, 4.4 |

```
getRunnerModule → ModuleRunner
                    ├─ postQuestionState(flagged)        ✅ wired (Epic 3)
                    ├─ crossedOutChoices parse/use      ❌ Epic 4.1
                    ├─ highlights parse/use             ❌ Epic 4.2
                    └─ QuestionRenderer
                           ├─ onToggleCrossOut          ❌ not passed
                           └─ passage highlight layer   ❌ absent

TopBar (Math) → calculator / reference buttons          ❌ Epic 4.3/4.4
```

---

## 2. Architectural decisions

Decisions confirmed with Julie are marked ✔; the rest are defaults — flag any that look wrong before Wave 1 starts.

**D1 — No new migrations or domain writes.** Epic 4 owns JSON shapes and client serialization only. `setChoiceState` continues to store opaque JSON text; validation is client-side for UX, server accepts any string (existing tests).

**D2 — Cross-out JSON shape: `string[]` of choice letters.**

```json
["B", "D"]
```

Serialize sorted `["A","B","C","D"]` subset; `null` / `[]` = none crossed. Helpers in new `lib/choiceState.ts`: `parseCrossedOutChoices`, `serializeCrossedOutChoices`, `toggleCrossedOut`.

**D3 — Crossed-out choices cannot be selected.** ✔ Tapping a crossed-out letter is a no-op (matches real Bluebook). Uncross to select.

**D4 — Highlight JSON shape (MVP: yellow only, notes deferred).** ✔

```json
[{ "start": 42, "end": 87 }]
```

Offsets are **UTF-16 code-unit indices** into the **passage string** (left pane of `RwQuestionLayout`), not the question stem. One color only: PRD yellow (`#FFEB3B` background). Helpers in new `lib/highlightState.ts`: `parseHighlights`, `serializeHighlights`, `mergeHighlight` (non-overlapping merge on add). **Notes deferred** to a follow-up; shape leaves room for optional `note?: string` later without migration.

**D5 — Highlight offset stability rule.** Offsets index the raw `passage` prop string passed to the highlight component. If `splitRwStimulus` changes how passage is derived, saved highlights for that question may drift — acceptable for MVP; document in code. Do not index into rendered DOM `textContent` (breaks on refresh/re-render).

**D6 — Highlight rendering strategy.** Split passage into segments at highlight boundaries, render each segment through existing `MarkdownContent`, wrap highlighted segments in `<mark className="bg-[#FFEB3B]">`. Highlights must not span partial markdown tokens (user selection that crosses `*` or `$` boundaries is rejected with no-op).

**D7 — Math tools are ephemeral overlays.** Calculator and reference sheet open in a modal/drawer; state does not persist to SQLite. Calculator graph state lives in React state for the current module session only (cleared on module navigation).

**D8 — Desmos via official API script, not a wrapper package.** Load with `next/script`:

```
https://www.desmos.com/api/v1.12/calculator.js?apiKey=...
```

Client component mounts `Desmos.GraphingCalculator(elt)` in `useEffect`. API key from `NEXT_PUBLIC_DESMOS_API_KEY` (demo key for dev; production key from Desmos developer portal). No `desmos-react` dependency.

**D9 — Reference sheet is a static asset.** Single-page image under `public/reference-sheet.png` sourced from the official SAT Math reference sheet. Modal with scroll/zoom; no server route.

**D10 — Math tools gated by section.** Calculator and reference buttons render only when `section === "math"` in `ModuleRunner` / `TopBar`. Never on R&W, review, or break screens.

**D11 — Same save pattern as flagging.** Optimistic local update → `postQuestionState` → rollback on error. Cross-out and highlights use the existing question-state endpoint (Epic 3 D12 still applies: no deadline check).

**D12 — Coalesce rapid highlight/cross-out saves.** Reuse the in-flight coalescing pattern from `useAutosave` or a sibling `useQuestionStateSave` hook so toggling three cross-outs doesn't queue three serial requests.

---

## 3. JSON contracts (Wave 0 — freeze before UI)

| Field | Column | Shape | Owner file |
|---|---|---|---|
| `crossedOutChoices` | `crossed_out_choices` | `string \| null` → `["A","C"]` | `lib/choiceState.ts` |
| `highlights` | `highlights` | `string \| null` → `[{start,end}]` | `lib/highlightState.ts` |

Add `lib/choiceState.test.ts` and `lib/highlightState.test.ts` in Wave 0 (pure parse/serialize/toggle, no DB).

---

## 4. Work breakdown

Four waves. Wave 1 is the template for all client wiring; Waves 2–3 can partially overlap.

### Wave 0 — Contracts (serial, main session)

| # | Task | Files |
|---|---|---|
| 0.1 | Cross-out parse/serialize/toggle helpers | `lib/choiceState.ts`, `lib/choiceState.test.ts` |
| 0.2 | Highlight parse/serialize/merge helpers | `lib/highlightState.ts`, `lib/highlightState.test.ts` |
| 0.3 | Extend `postQuestionState` payload types | `app/(test)/test/[attemptId]/_lib/clientApi.ts` |
| 0.4 | This plan doc | `docs/epic-4-implementation-plan.md` |

### Wave 1 — Story 4.1: Answer elimination (cross-out)

| # | Task | Files |
|---|---|---|
| 1.1 | `useQuestionStateSave` hook for `crossedOut` / `highlights` | `app/(test)/test/[attemptId]/_lib/useQuestionStateSave.ts` |
| 1.2 | Wire `ModuleRunner`: parse `crossedOutChoices` per question, `handleToggleCrossOut`, pass props to `QuestionRenderer` | `ModuleRunner.tsx` |
| 1.3 | Block `handleSelectChoice` when letter is crossed out (D3) | `ModuleRunner.tsx` |
| 1.4 | Strengthen `ChoiceRow.test.tsx` — callback + `aria-pressed` + line-through | `ChoiceRow.test.tsx` |
| 1.5 | Integration test: toggle cross-out → `postQuestionState` called with serialized JSON | `ModuleRunner.test.tsx` (new, fixture-driven) |

**Done when:** Cross-outs survive refresh (read back from server payload), toggling is idempotent, crossed-out choice cannot be selected.

### Wave 2 — Story 4.2: Highlighter (MVP, yellow only)

| # | Task | Files |
|---|---|---|
| 2.1 | `HighlightablePassage` — text selection → `{start,end}`, reject invalid ranges (D6) | `app/(test)/_components/question/HighlightablePassage.tsx` |
| 2.2 | Segment-split render with `<mark>` + `MarkdownContent` per segment | same file |
| 2.3 | "Remove highlight" on click of existing mark (toggle off) | same file |
| 2.4 | Wire through `RwQuestionLayout` → `QuestionRenderer` → `ModuleRunner` | layouts + runner |
| 2.5 | Vitest: selection → offset mapping, segment split, render highlights | `HighlightablePassage.test.tsx` |

**Out of scope (follow-up):** annotation notes UI, highlight color picker, highlights on question stem.

**Done when:** User can yellow-highlight passage text on R&W MC questions; highlights persist across refresh; Math modules show no highlight UI.

### Wave 3 — Stories 4.3 + 4.4: Math tools (parallel subagents)

| # | Task | Story | Files |
|---|---|---|---|
| 3.1 | Shared `ToolModal` shell (open/close, focus trap, escape) | both | `app/(test)/_components/ToolModal.tsx` |
| 3.2 | `DesmosCalculator` client component + `next/script` loader | 4.3 | `app/(test)/_components/DesmosCalculator.tsx` |
| 3.3 | `ReferenceSheet` image viewer modal | 4.4 | `app/(test)/_components/ReferenceSheet.tsx`, `public/reference-sheet.png` |
| 3.4 | `MathToolBar` — calculator + reference icon buttons (PRD §8) | both | `app/(test)/_components/MathToolBar.tsx` |
| 3.5 | Mount in `TopBar` or `ModuleRunner` when `section === "math"` (D10) | both | `TopBar.tsx`, `ModuleRunner.tsx` |
| 3.6 | Vitest: modal open/close, Math-only visibility | both | `MathToolBar.test.tsx`, `ToolModal.test.tsx` |
| 3.7 | `.env.example` entry for `NEXT_PUBLIC_DESMOS_API_KEY` | 4.3 | `.env.example` |

**Done when:** Math runner shows two circular icon buttons; calculator opens a working Desmos graphing calculator; reference sheet opens scrollable formula image; neither appears on R&W.

### Wave 4 — Verification

| # | Task | Notes |
|---|---|---|
| 4.1 | `npm test`, `npm run test:ui`, `npm run build`, `npm run lint` | Gate before merge |
| 4.2 | Manual QA walk-through (§6) | Browser-only; async pages |

---

## 5. HTTP contract (unchanged from Epic 3)

No new routes. Epic 4 only extends **client usage** of the existing endpoint:

| Method + path | Body | Returns | Notes |
|---|---|---|---|
| `POST /api/attempts/:id/questions/:qid/state` | `{ section, module, flagged?, crossedOut?, highlights? }` | `{ ok }` | Epic 3 D5/D12. `crossedOut` and `highlights` are raw JSON strings |

---

## 6. Manual QA checklist (Task 4.2)

1. **Cross-out (4.1):** Cross out B and D; line-through visible; cannot select crossed-out; refresh preserves; uncross and select works
2. **Highlighter (4.2):** Select passage phrase on R&W; yellow background appears; second selection adds highlight; click highlight to remove; refresh preserves; stem (right pane) not highlightable
3. **Calculator (4.3):** Math module only; opens/closes; can enter `y=x^2`; does not block answering questions behind modal
4. **Reference sheet (4.4):** Math module only; image readable; scroll/zoom works
5. **Regression:** Flagging, autosave, timer, pause/resume, review grid unchanged

---

## 7. Suggested execution order

```
Wave 0  (main, serial)     ──►  0.1  0.2  0.3  0.4
Wave 1  (main)             ──►  4.1 cross-out wiring
Wave 3  (2 subagents)      ──►  4.3 Desmos  ||  4.4 reference sheet   (can start after 0.3)
Wave 2  (main)             ──►  4.2 highlights
Wave 4                       ──►  4.1 automated + 4.2 manual QA
```

Rationale: ship cross-out first (smallest, validates wiring pattern), then Math tools (visible Epic 3 deferral, independent of highlights), then highlights (most UX complexity).

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Highlight offsets drift when passage split logic changes | D5 — index raw passage string; document; accept MVP limitation |
| Selection across markdown syntax produces garbage offsets | D6 — reject invalid ranges; only allow selections within plain-text runs |
| Desmos script load race | `next/script` `onReady` callback before `GraphingCalculator` mount |
| Reference sheet asset licensing | Use official College Board SAT Math reference sheet (public exam material) |
| Modal blocks test interaction | ToolModal is overlay; runner remains mounted; close to answer |
| Rapid cross-out toggles flood API | D12 — coalesce saves |

---

## 9. Rules for parallel work

1. **One file, one owner, one wave.** The tables above are the authority.
2. **Do not touch `lib/questionState.ts` or API routes** unless a bug is found — Epic 3 owns them.
3. **`npm test`, `npm run test:ui`, `npm run lint` pass before reporting done.**
4. **New pure helpers get `node:test` coverage** in `lib/`; UI components get Vitest in `app/`.
5. **Match Epic 3 conventions:** optimistic update + rollback, fixture-driven component tests, no writes during render.

---

## 10. Files touched (summary)

| Area | New | Modified |
|---|---|---|
| Pure helpers | `lib/choiceState.ts`, `lib/highlightState.ts` | — |
| Runner wiring | `useQuestionStateSave.ts` | `ModuleRunner.tsx`, `clientApi.ts` |
| R&W highlights | `HighlightablePassage.tsx` | `RwQuestionLayout.tsx`, `QuestionRenderer.tsx` |
| Math tools | `ToolModal.tsx`, `DesmosCalculator.tsx`, `ReferenceSheet.tsx`, `MathToolBar.tsx` | `TopBar.tsx` |
| Assets | `public/reference-sheet.png` | `.env.example` |

**Explicitly not touched:** `lib/questionState.ts`, API route handlers, migrations, `lib/testFlow.ts` types (raw JSON on `RunnerQuestion` stays as-is).
