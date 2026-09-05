# The finalize-vs-assemble seam (read before writing Epic 3's module transition)

## The one-sentence version

`finalizeModule1` throws on a repeat call, `assembleModule2ForSection` does not — so the
"end module 1" request is **not** safely retryable as a whole, and Epic 3's route handler
has to make it safe.

## What's actually there

Ending Module 1 for a section is two calls (`lib/attemptService.ts`):

| Call | Repeat behaviour |
|---|---|
| `finalizeModule1(db, attemptId, section)` | **Throws** `"...was already submitted at <ts> -- a module cannot be submitted twice"` |
| `assembleModule2ForSection(db, attemptId, section)` | **Idempotent** — returns the Module 2 already on record, inserts nothing |

Both are deliberate:

- Finalize throws because a duplicate submit almost always means a double-clicked button
  or a retried request, and silently accepting it would hide that.
- Assemble is idempotent because before this it inserted a *second* full Module 2 on the
  second call (54 R&W rows for one attempt).

Individually correct. Together they make a seam.

## The failure

A handler that does the obvious thing:

```ts
finalizeModule1(db, attemptId, section);
const module2 = assembleModule2ForSection(db, attemptId, section);
```

breaks on **any** second delivery of that request — double-click, browser retry, React
StrictMode double-effect, the student refreshing the "loading Module 2" screen. The
retry dies at `finalizeModule1` and never reaches the assemble call, even though
assembly would have happily returned the correct existing Module 2.

Result: a student with a fully-assembled, perfectly valid Module 2 sitting in the
database sees a 500 and cannot get into it.

Note the timer makes this likelier, not rarer: Story 3.3's auto-submit on expiry can
fire at the same moment the student clicks Submit — two deliveries of the same
transition, by design.

## What to do

**Recommended:** make the transition idempotent *at the handler*, not by weakening
either primitive. Treat "already finalized" as success and fall through:

```ts
try {
  finalizeModule1(db, attemptId, section);
} catch (err) {
  if (!isAlreadySubmittedError(err)) throw err;
  // Already finalized by an earlier delivery of this same request -- fall through
  // to assembly, which is idempotent and will return the existing Module 2.
}
const module2 = assembleModule2ForSection(db, attemptId, section);
```

This keeps the loud failure available to any caller that wants it, while the one place
that legitimately expects duplicates handles them.

**Prerequisite:** `finalizeModule1` currently signals this with a `new Error()` whose
message must be string-matched. Don't string-match in a route handler. Give it a
distinguishable type first — an exported `ModuleAlreadySubmittedError` subclass, or an
`AlreadyFinalized` sentinel in the return value. That's a small change to
`lib/attemptService.ts` and should be part of this work.

**Rejected alternative:** making `finalizeModule1` a silent no-op on repeat. It closes
the seam but throws away the signal, and a genuinely buggy caller double-submitting
across *different* attempts would then fail silently.

## Done when

- Delivering the same "end Module 1" request twice returns the same Module 2 both times,
  with HTTP 200 both times and exactly 27 (R&W) / 22 (Math) module-2 rows.
- Callers distinguish "already finalized" from other errors without matching on message
  text.
- A test covers the double-delivery path. `lib/attemptService.test.ts` has the in-memory
  DB harness to build on.

## Context

- `lib/attemptService.ts` — the module docblock explains why the answer API is split
  into `saveAnswer` / `finalizeModule1` in the first place.
- `lib/attemptService.test.ts` — existing coverage of both behaviours in isolation
  ("a module cannot be finalized twice", "assembling Module 2 twice...").
- PRD Story 3.2 (per-answer persistence), Story 3.3 (timer auto-submit), Story 3.6
  (submit confirmation).
