# Home test selection (supersedes Epic 3 D9)

**Status:** Implemented

## Decision D9′

Epic 3 **D9** ("start-new-test is idempotent against an in-progress attempt") is superseded.

- **Old:** `POST /api/attempts` returned the existing in-progress attempt; home disabled "Start new test" when one was resumable.
- **New:** Server always creates a new attempt when asked. Resume is explicit via Attempt History. Double-click protection is client-side (`loading` on start buttons).

## Practice Test 1 vs 2

Per PRD §3.3 bank capacity:

| Slot | Assembly |
|------|----------|
| **Practice Test 1** | Standard LRU selector (never-served first) |
| **Practice Test 2** | Prefer questions not used in Practice Test 1; relax that preference and recycle via LRU when a domain bucket is still short (PRD §3.3 — never block) |

Stored on `test_attempts.practice_test` (`1` or `2`).
