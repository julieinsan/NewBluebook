# Epic 4 — In-Test Tools: implementation plan

**Status:** Waves 0–2 complete; Wave 3 = verification gate. Math tools (Stories 4.3–4.4) **deferred — not shipping in v1** (revision 2)
**Covers:** PRD Stories 4.1–4.2 ([PRD.md](../PRD.md) § Epic 4, §8 visual spec)
**Out of scope:** PRD Stories 4.3–4.4 (Desmos calculator, digital reference sheet) — see [§ Deferred: Math tools](#deferred-math-tools-stories-43--44)
**Depends on:** Epic 3 complete
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
| Cross-out helpers + runner wiring | `lib/choiceState.ts`, `ModuleRunner.tsx`, `useQuestionStateSave.ts` |
| Passage highlighter | `HighlightablePassage.tsx`, wired through `RwQuestionLayout` → `ModuleRunner` |

| Shipped (Waves 0–2) | Stories |
|---|---|
| Cross-out parse/serialize/toggle + runner wiring | 4.1 ✅ |
| Passage highlight UI + render | 4.2 ✅ |

| Deferred (not shipping) | Stories |
|---|---|
| Desmos calculator embed | 4.3 ⏸ |
| Digital reference sheet modal | 4.4 ⏸ |

```
getRunnerModule → ModuleRunner
                    ├─ postQuestionState(flagged)        ✅ wired (Epic 3)
                    ├─ crossedOutChoices parse/use      ✅ Epic 4.1
                    ├─ highlights parse/use             ✅ Epic 4.2
                    └─ QuestionRenderer
                           ├─ onToggleCrossOut          ✅ wired
                           └─ passage highlight layer   ✅ HighlightablePassage

TopBar (Math) → calculator / reference buttons          ⏸ deferred (4.3/4.4)
```

---

## 2. Architectural decisions

Decisions confirmed with Julie are marked ✔.

**D1 — No new migrations or domain writes.** Epic 4 owns JSON shapes and client serialization only. `setChoiceState` continues to store opaque JSON text; validation is client-side for UX, server accepts any string (existing tests).

**D2 — Cross-out JSON shape: `string[]` of choice letters.**

```json
["B", "D"]
```

Serialize sorted `["A","B","C","D"]` subset; `null` / `[]` = none crossed. Helpers in `lib/choiceState.ts`: `parseCrossedOutChoices`, `serializeCrossedOutChoices`, `toggleCrossedOut`.

**D3 — Crossed-out choices cannot be selected.** ✔ Tapping a crossed-out letter is a no-op (matches real Bluebook). Uncross to select.

**D4 — Highlight JSON shape (MVP: yellow only, notes deferred).** ✔

```json
[{ "start": 42, "end": 87 }]
```

Offsets are **UTF-16 code-unit indices** into the **passage string** (left pane of `RwQuestionLayout`), not the question stem. One color only: PRD yellow (`#FFEB3B` background). Helpers in `lib/highlightState.ts`: `parseHighlights`, `serializeHighlights`, `mergeHighlight` (non-overlapping merge on add). **Notes deferred** to a follow-up; shape leaves room for optional `note?: string` later without migration.

**D5 — Highlight offset stability rule.** Offsets index the raw `passage` prop string passed to the highlight component. If `splitRwStimulus` changes how passage is derived, saved highlights for that question may drift — acceptable for MVP; document in code. Do not index into rendered DOM `textContent` (breaks on refresh/re-render).

**D6 — Highlight rendering strategy.** Split passage into segments at highlight boundaries, render each segment through existing `MarkdownContent`, wrap highlighted segments in `<mark className="bg-[#FFEB3B]">`. Highlights must not span partial markdown tokens (user selection that crosses `*` or `$` boundaries is rejected with no-op).

**D11 — Same save pattern as flagging.** Optimistic local update → `postQuestionState` → rollback on error. Cross-out and highlights use the existing question-state endpoint (Epic 3 D12 still applies: no deadline check).

**D12 — Coalesce rapid highlight/cross-out saves.** Reuse the in-flight coalescing pattern from `useAutosave` or a sibling `useQuestionStateSave` hook so toggling three cross-outs doesn't queue three serial requests.

**D13 — Math tools out of scope for v1.** ✔ Desmos calculator and digital reference sheet are deferred per product decision (2026-09-05). Math modules ship without in-app calculator or reference buttons; no Desmos API key or reference-sheet asset required.

---

## 3. JSON contracts (Wave 0 — freeze before UI)

| Field | Column | Shape | Owner file |
|---|---|---|---|
| `crossedOutChoices` | `crossed_out_choices` | `string \| null` → `["A","C"]` | `lib/choiceState.ts` |
| `highlights` | `highlights` | `string \| null` → `[{start,end}]` | `lib/highlightState.ts` |

Add `lib/choiceState.test.ts` and `lib/highlightState.test.ts` in Wave 0 (pure parse/serialize/toggle, no DB).

---

## 4. Work breakdown

Three waves shipped; one deferred; verification gate remains.

### Wave 0 — Contracts ✅

| # | Task | Files |
|---|---|---|
| 0.1 | Cross-out parse/serialize/toggle helpers | `lib/choiceState.ts`, `lib/choiceState.test.ts` |
| 0.2 | Highlight parse/serialize/merge helpers | `lib/highlightState.ts`, `lib/highlightState.test.ts` |
| 0.3 | Extend `postQuestionState` payload types | `app/(test)/test/[attemptId]/_lib/clientApi.ts` |
| 0.4 | This plan doc | `docs/epic-4-implementation-plan.md` |

### Wave 1 — Story 4.1: Answer elimination (cross-out) ✅

| # | Task | Files |
|---|---|---|
| 1.1 | `useQuestionStateSave` hook for `crossedOut` / `highlights` | `app/(test)/test/[attemptId]/_lib/useQuestionStateSave.ts` |
| 1.2 | Wire `ModuleRunner`: parse `crossedOutChoices` per question, `handleToggleCrossOut`, pass props to `QuestionRenderer` | `ModuleRunner.tsx` |
| 1.3 | Block `handleSelectChoice` when letter is crossed out (D3) | `ModuleRunner.tsx` |
| 1.4 | Strengthen `ChoiceRow.test.tsx` — callback + `aria-pressed` + line-through | `ChoiceRow.test.tsx` |
| 1.5 | Integration test: toggle cross-out → `postQuestionState` called with serialized JSON | `ModuleRunner.test.tsx` |

**Done when:** Cross-outs survive refresh (read back from server payload), toggling is idempotent, crossed-out choice cannot be selected.

### Wave 2 — Story 4.2: Highlighter (MVP, yellow only) ✅

| # | Task | Files |
|---|---|---|
| 2.1 | `HighlightablePassage` — text selection → `{start,end}`, reject invalid ranges (D6) | `app/(test)/_components/question/HighlightablePassage.tsx` |
| 2.2 | Segment-split render with `<mark>` + `MarkdownContent` per segment | same file |
| 2.3 | "Remove highlight" on click of existing mark (toggle off) | same file |
| 2.4 | Wire through `RwQuestionLayout` → `QuestionRenderer` → `ModuleRunner` | layouts + runner |
| 2.5 | Vitest: selection → offset mapping, segment split, render highlights | `HighlightablePassage.test.tsx` |

**Out of scope (follow-up):** annotation notes UI, highlight color picker, highlights on question stem.

**Done when:** User can yellow-highlight passage text on R&W MC questions; highlights persist across refresh; Math modules show no highlight UI.

### Wave 3 — Verification (was Wave 4)

| # | Task | Notes |
|---|---|---|
| 3.1 | `npm test`, `npm run test:ui`, `npm run build`, `npm run lint` | Gate before merge |
| 3.2 | Manual QA walk-through (§6) | Browser-only; async pages |

---

## Deferred: Math tools (Stories 4.3 + 4.4)

**Decision (2026-09-05):** Ship without in-app Desmos calculator or digital reference sheet. The following was planned but is **not part of v1**. Retained here as a reference if math tools are revisited later.

| # | Task | Story | Files |
|---|---|---|---|
| — | Shared `ToolModal` shell | both | `app/(test)/_components/ToolModal.tsx` |
| — | `DesmosCalculator` + `next/script` loader | 4.3 | `app/(test)/_components/DesmosCalculator.tsx` |
| — | `ReferenceSheet` image viewer | 4.4 | `app/(test)/_components/ReferenceSheet.tsx`, `public/reference-sheet.png` |
| — | `MathToolBar` icon buttons | both | `app/(test)/_components/MathToolBar.tsx` |
| — | Mount in `TopBar` when `section === "math"` | both | `TopBar.tsx` |

**Sketch decisions (not implemented):**

- **D7** — Tools are ephemeral overlays; calculator state module-scoped only.
- **D8** — Desmos via official API script (`next/script`), `NEXT_PUBLIC_DESMOS_API_KEY`.
- **D9** — Reference sheet as static `public/reference-sheet.png`.
- **D10** — Math section only; never on R&W, review, or break screens.

---

## 5. HTTP contract (unchanged from Epic 3)

No new routes. Epic 4 only extends **client usage** of the existing endpoint:

| Method + path | Body | Returns | Notes |
|---|---|---|---|
| `POST /api/attempts/:id/questions/:qid/state` | `{ section, module, flagged?, crossedOut?, highlights? }` | `{ ok }` | Epic 3 D5/D12. `crossedOut` and `highlights` are raw JSON strings |

---

## 6. Manual QA checklist

1. **Cross-out (4.1):** Cross out B and D; line-through visible; cannot select crossed-out; refresh preserves; uncross and select works
2. **Highlighter (4.2):** Select passage phrase on R&W; yellow background appears; second selection adds highlight; click highlight to remove; refresh preserves; stem (right pane) not highlightable
3. **Regression:** Flagging, autosave, timer, pause/resume, review grid unchanged
4. **Math modules:** No calculator or reference-sheet buttons in top bar; answering (MC + grid-in) works as before

~~3. Calculator (4.3)~~ — deferred  
~~4. Reference sheet (4.4)~~ — deferred

---

## 7. Execution order (actual)

```
Wave 0  ✅  0.1–0.4
Wave 1  ✅  4.1 cross-out wiring
Wave 2  ✅  4.2 highlights
Wave 3       verification gate (automated + manual QA)
```

Math tools (formerly Wave 3) cancelled for v1 per **D13**.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Highlight offsets drift when passage split logic changes | D5 — index raw passage string; document; accept MVP limitation |
| Selection across markdown syntax produces garbage offsets | D6 — reject invalid ranges; only allow selections within plain-text runs |
| Rapid cross-out toggles flood API | D12 — coalesce saves |
| Users expect Bluebook-parity math tools | Documented in PRD non-goals and D13; external calculator acceptable for practice |

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

**Not built (deferred):** `ToolModal.tsx`, `DesmosCalculator.tsx`, `ReferenceSheet.tsx`, `MathToolBar.tsx`, `public/reference-sheet.png`, `.env.example` Desmos key.

**Explicitly not touched:** `lib/questionState.ts`, API route handlers, migrations, `lib/testFlow.ts` types (raw JSON on `RunnerQuestion` stays as-is).

---

## 11. Review log (revision 1 → 2)

1. **Math tools deferred (D13).** Product decision to ship v1 without Desmos calculator or digital reference sheet. PRD Stories 4.3–4.4 moved to deferred; Wave 3 (math tools) removed from scope; former Wave 4 verification renamed to Wave 3.
2. **Waves 0–2 marked complete** per session work (cross-out, highlighter, home test selection on same branch timeline).
