# Bluebook Clone — Product Requirements Document

**Status:** Draft for review
**Owner:** Julie
**Date:** 2026-09-04

## 1. Summary

A single-user, locally-run clone of the College Board Bluebook digital SAT testing app, built from two supplied question banks (150 Reading & Writing questions, 120 Math questions). The app delivers full-length, multistage-adaptive practice tests that mirror the real Bluebook experience (timed modules, flagging, review screen, in-test tools) plus an untimed drill mode for targeted practice, approximate scaled scoring, and a results dashboard modeled on the real College Board score report.

## 2. Goals / Non-Goals

**Goals**
- Faithfully reproduce the *structure* of a real digital SAT: two sections (Reading & Writing, Math), each split into two timed modules, with Module 2's difficulty adaptively routed based on Module 1 performance.
- Reproduce the in-test tools called out in the Bluebook guide: timer, flagging, review screen, answer elimination, highlighter/annotation (R&W), Desmos calculator + reference sheet (Math).
- Score attempts with an approximate 200–800 per-section / 400–1600 total scale, plus a domain-level performance view styled after the real score report.
- Support an untimed drill mode for targeted domain/skill practice.
- Run entirely locally for one user — no accounts, no hosted backend.

**Non-goals (out of scope for this build)**
- Exact official College Board scoring/equating tables (proprietary, not available — we approximate).
- The "Career Insights Snapshot" feature from the score report.
- Multi-user accounts, auth, or an admin/teacher view.
- Proctoring, lockdown browser behavior, or exam-security features — this is a practice tool.
- Pixel-perfect visual clone of Bluebook's UI — a clean, faithful-in-structure UI is the target, not asset-for-asset replication.

## 3. Source Material & Key Findings

| Source file | Contents | Key finding |
|---|---|---|
| `digital_sat_k12_student_weekend_...pdf` | Real score report (1 page) | Confirms official blueprint: R&W = 4 domains at 26/28/20/26%, question ranges 12-14/13-15/8-12/11-15 (~54 total). Math = 4 domains at 35/35/15/15%, ranges 13-15/13-15/5-7/5-7 (~44 total). Confirms 200-800 per section / 400-1600 total scale with percentiles. |
| `929675922-...Bluebook-App.pdf` | App user guide (4 pages) | Confirms module timing (R&W: two 32-min modules; Math: two 35-min modules), and in-test tools: Desmos calculator (Math only), highlighting/annotation (R&W), flagging + review screen, answer elimination (cross-out), digital reference sheet (Math). |
| `Copy of new_rw_questions_with_answers.pdf` | 150 R&W questions | Clean, fully text-extractable. 4 domains / 10 skills, Easy/Medium/Hard tagged. Every question is self-contained (no shared passages, even Cross-Text Connections embeds both texts in one stimulus). No images. |
| `Copy of new_math_questions_with_answers.pdf` | 120 Math questions | **Font encoding is broken for plain-text extraction** — numbers/variables/equations don't come through as text via standard PDF text tools. Verified by direct visual read that the content (including diagrams, which are vector-drawn, not embedded images) is fully legible and can be transcribed correctly by reading page images. Ingestion requires a vision-transcription pass, not a text scrape. 4 domains / 18 skills, Easy/Medium/Hard tagged, mix of multiple-choice (90) and student-produced/grid-in (30) response types. |
| `Copy of difficulty_changes.csv` | 177 rows: question ID, Previous Difficulty, New Difficulty, Domain, Skill | Confirms the real Bluebook is a multistage-adaptive test where item difficulty routing is tracked per-question. **IDs do not overlap** with either supplied question bank — this is reference/template data for a fuller official item bank, not directly joinable today. Schema should anticipate future bank imports where IDs *do* match.

### 3.1 Question bank inventory

**Reading & Writing — 150 questions**

| Domain | Count | Skills (count) |
|---|---|---|
| Information and Ideas | 47 | Command of Evidence (18), Inferences (16), Central Ideas and Details (13) |
| Craft and Structure | 32 | Words in Context (18), Text Structure and Purpose (11), Cross-Text Connections (3) |
| Expression of Ideas | 33 | Transitions (21), Rhetorical Synthesis (12) |
| Standard English Conventions | 38 | Boundaries (21), Form/Structure/Sense (17) |

Difficulty: 85 Hard / 37 Medium / 28 Easy.

**Math — 120 questions**

| Domain | Count |
|---|---|
| Geometry and Trigonometry | 51 |
| Advanced Math | 27 |
| Algebra | 23 |
| Problem-Solving and Data Analysis | 19 |

Difficulty: 65 Hard / 35 Medium / 20 Easy. Format: 90 multiple-choice / 30 grid-in.

### 3.2 Test blueprint (derived from score-report percentages)

| Section | Domain | Questions/test |
|---|---|---|
| R&W (54 total, 27+27 per module) | Information and Ideas | 14 |
| | Craft and Structure | 15 |
| | Expression of Ideas | 11 |
| | Standard English Conventions | 14 |
| Math (44 total, 22+22 per module) | Algebra | 15 |
| | Advanced Math | 15 |
| | Problem-Solving and Data Analysis | 7 |
| | Geometry and Trigonometry | 7 |

### 3.3 Bank capacity vs. blueprint

Dividing bank size by per-test need, per domain:

- R&W bottleneck: **Craft and Structure**, 32 ÷ 15/test = 2.1 tests
- Math bottleneck: **Algebra**, 23 ÷ 15/test = 1.5 tests

**Conclusion: the bank supports exactly 1 fully non-repeating full-length test end-to-end.** Starting on test 2, Math/Algebra (and soon Advanced Math) will need to reuse previously-served questions; R&W stays fully fresh through test 2 and starts recycling in Craft & Structure by test 3. Per your direction, the app recycles rather than blocking further attempts, using least-recently-used selection within the constrained domain and flagging any recycled question as "seen before" in review. Drill mode is exempt from this constraint and can draw from the full 270-question pool freely.

## 4. Design Decisions (confirmed)

| Decision | Choice |
|---|---|
| Audience | Single user, no accounts |
| Fidelity | Full adaptive clone (real MST structure, not a static test or simple quiz runner) |
| In-test tools in scope | Timer/nav/flagging/review screen, answer elimination, highlighter/annotation (R&W), Desmos + reference sheet (Math) |
| Tech stack | Next.js (React + TypeScript), local SQLite via `better-sqlite3`, no hosted backend — runs via `npm run dev` |
| Scoring | Approximate 200-800/section, 400-1600 total, built from a plausible curve (not official equating tables) |
| Question reuse | No repeats until a domain is exhausted, then recycle least-recently-used, flagged as "seen before" |
| Drill mode | Included — untimed, by domain/skill/difficulty, instant feedback |
| Review timing | Only after the full test is submitted (matches real Bluebook) |

### 4.1 Assumed engineering defaults (flag if you want these changed)

- **Adaptive routing threshold:** Module 2 difficulty routes to the "harder" pool if the user scores ≥60% correct on Module 1, otherwise the "easier" pool. This threshold isn't published by College Board; it's a reasonable approximation, adjustable via config.
- **Diagram handling (Math):** the ~16 questions with figures will have their diagram cropped from a rendered page image during ingestion (source PDF draws them as vectors, not embedded images) rather than being redrawn as new SVGs — faster to ingest, and visually accurate since it's a direct render of the original.
- **Deployment:** local-only, no hosting step is in scope.

## 5. Data Model (high level)

```
questions
  id (pk, string)            -- source question ID where available
  section (enum: rw | math)
  domain (string)
  skill (string)
  difficulty (enum: easy | medium | hard)
  question_type (enum: mc | grid_in)
  stimulus_text (text)        -- passage or math problem text (markdown/LaTeX)
  choice_a/b/c/d (text, null for grid_in)
  correct_answer (string)     -- letter, or value(s) for grid_in
  rationale (text)
  figure_asset_path (string, nullable)

test_attempts
  id (pk)
  started_at, submitted_at
  status (enum: in_progress | submitted)
  rw_module1_difficulty_path, math_module1_difficulty_path (fixed)
  rw_module2_difficulty_path, math_module2_difficulty_path (easier | harder, set after module 1)
  rw_scaled_score, math_scaled_score, total_scaled_score

test_attempt_questions
  attempt_id (fk), question_id (fk), module (1|2), section, order_index
  user_answer, is_correct, flagged (bool), crossed_out_choices (json), highlights (json)

drill_sessions
  id (pk), started_at, filters (json: domain/skill/difficulty)

drill_session_questions
  session_id (fk), question_id (fk), user_answer, is_correct

question_serve_log
  question_id (fk), attempt_id or session_id, served_at   -- powers least-recently-used recycling
```

## 6. Agile Delivery Plan

Organized as epics, each broken into independently implementable user stories with acceptance criteria, sized for a subagent to pick up and build. Epics are ordered by dependency — later epics assume earlier ones are done.

---

### Epic 0 — Project Foundation

**Story 0.1: Project scaffold**
*As a developer, I want a working Next.js + TypeScript project with SQLite wired up, so that all later features have a foundation to build on.*
- Next.js app router project initialized with TypeScript, ESLint, Prettier.
- `better-sqlite3` integrated with a migration runner; local `.db` file created on first run, gitignored.
- Base layout, theming (light/dark), and a placeholder home page render successfully via `npm run dev`.
- README documents setup and run steps.

**Story 0.2: Schema migrations**
*As a developer, I want the data model from Section 5 codified as versioned migrations, so that ingestion and app code have a stable schema to target.*
- All tables in Section 5 exist with appropriate indexes (question lookups by domain/skill/difficulty; serve log by question_id).
- Migration runner is idempotent and safe to re-run.

---

### Epic 1 — Question Bank Ingestion

**Story 1.1: R&W bank parser**
*As a developer, I want the 150 R&W questions parsed from the source PDF into the `questions` table, so that the app has real content to serve.*
- Parses question ID, domain, skill, difficulty, stimulus, 4 choices, correct answer, rationale for all 150 entries.
- Validates: exactly 150 rows imported, no duplicate IDs, every row has all required fields non-null, correct_answer is one of A-D.
- Import is scriptable/re-runnable (`npm run ingest:rw`).

**Story 1.2: Math bank vision-transcription pipeline**
*As a developer, I want the 120 Math questions transcribed from rendered page images (not text-extracted, since the source PDF's font encoding is broken) into the `questions` table, so that math content — including numbers, equations, and diagrams — is captured correctly.*
- Each of the 120 questions' page(s) rendered to image and transcribed into: question ID, domain, skill, difficulty, question_type, stimulus (with equations in LaTeX), choices (mc only), correct_answer (letter or grid-in value(s), preserving equivalent forms like "6.5, 13/2"), rationale.
- The ~16 questions with figures have the figure cropped to an image asset and linked via `figure_asset_path`.
- Validates: 120 rows imported, no duplicate IDs, grid-in rows have null choices, mc rows have exactly 4 choices.
- Spot-check report comparing a sample of transcribed entries against the original page images for accuracy.

**Story 1.3: Ingestion QA tooling**
*As a developer, I want automated sanity checks over the imported question bank, so that bad data is caught before it reaches the test-assembly engine.*
- Report: counts by section/domain/skill/difficulty (should match Section 3.1 tables).
- Flags: any question missing a rationale, any mc question without a correct_answer matching a real choice, any orphaned figure asset.

**Story 1.4: Difficulty-recalibration reference table**
*As a developer, I want `Copy of difficulty_changes.csv` loaded into a standalone reference table (not joined to current questions, since IDs don't overlap), so that a future, larger official bank import can apply these recalibrations automatically if IDs match.*
- CSV loaded into a `difficulty_recalibrations` table (question_id, previous_difficulty, new_difficulty, domain, skill).
- Ingestion pipeline checks new imports against this table by ID and logs any matches (none expected today, but the hook exists).

---

### Epic 2 — Test Blueprint & Adaptive Assembly Engine

**Story 2.1: Blueprint configuration**
*As a developer, I want the Section 3.2 domain/question-count blueprint and module timings expressed as config, so that assembly logic and the UI both read from one source of truth.*
- Config defines, per section: total questions, module split, per-domain counts, module time limits (R&W 32 min x2, Math 35 min x2).

**Story 2.2: Least-recently-used question selection with recycling**
*As the assembly engine, I want to select questions per domain/skill/difficulty preferring never-served questions, falling back to least-recently-served ones once a domain is exhausted, so that repeats are minimized and, when unavoidable, spread out and flagged.*
- Given a domain/skill/difficulty/count request, returns that many questions preferring `question_serve_log`-absent rows, else oldest `served_at`.
- Every returned question is logged to `question_serve_log` immediately.
- Unit tests cover: fresh pool, partially exhausted pool, fully exhausted pool (confirms recycling kicks in exactly as described in Section 3.3).

**Story 2.3: Module 1 assembly (fixed)**
*As the assembly engine, I want to assemble a balanced Module 1 for each section per the blueprint, so that every attempt starts from a consistent baseline.*
- Produces the correct per-domain question counts (Section 3.2, split ~evenly across module 1/2) at a fixed, moderate Easy/Medium/Hard mix, using Story 2.2's selector.

**Story 2.4: Adaptive Module 2 routing**
*As the assembly engine, I want Module 2's difficulty pool chosen based on Module 1 performance (≥60% correct → harder pool, else easier pool, per Section 4.1), so that the test mirrors real Bluebook's multistage-adaptive behavior.*
- Computes Module 1 raw score immediately on submission (not shown to user).
- Selects Module 2 questions from the routed difficulty pool, same per-domain counts as Module 1.
- Attempt record stores which path was taken for both sections.

**Story 2.5: Full attempt assembly service**
*As a user, I want to start a new practice test and have it assembled correctly end-to-end, so that I can begin testing immediately.*
- Single entry point creates a `test_attempts` row, assembles R&W Module 1 and Math Module 1 (Module 2s assembled lazily after each Module 1 submits).
- Returns everything the UI needs to render Module 1 of R&W first.

---

### Epic 3 — Test-Taking Experience

**Story 3.1: Home screen**
*As a user, I want a home screen showing "Start new test," any in-progress test to resume, drill mode entry, and past test history, so that I always know where to pick up.*

**Story 3.2: Module runner**
*As a user, I want to answer one question at a time with Next/Back navigation and a visible progress indicator, so that the experience matches real Bluebook.*
- Renders passage/problem + choices (or grid-in input); persists each answer as it's given (survives a refresh mid-module).

**Story 3.3: Countdown timer**
*As a user, I want a per-module countdown timer that I can hide/reveal, with auto-submit when time expires, so that pacing pressure matches the real test.*

**Story 3.4: Flagging and review screen**
*As a user, I want to flag questions for later and see a review screen at the end of each module listing flagged/unanswered questions, so that I can manage my time like on the real test.*

**Story 3.5: Section break screen**
*As a user, I want a break screen between the R&W and Math sections, so that the pacing of a full test mirrors the real exam.*

**Story 3.6: Submit flow**
*As a user, I want clear confirmation before submitting a module or the full test, so that I don't accidentally end a section early.*

---

### Epic 4 — In-Test Tools

**Story 4.1: Answer elimination (cross-out)**
*As a user, I want to cross out answer choices I've ruled out, so that I can narrow down multiple-choice questions like in real Bluebook.*

**Story 4.2: Highlighter & annotation (R&W)**
*As a user, I want to highlight passage text and attach short notes, so that I can mark evidence and track my reasoning during R&W questions.*

**Story 4.3: Desmos calculator (Math)**
*As a user, I want an embedded Desmos graphing calculator available throughout the Math module, so that I can graph, solve, and check my work as in real Bluebook.*
- Uses the official Desmos API embed (free tier).

**Story 4.4: Digital reference sheet (Math)**
*As a user, I want a reference sheet of common formulas accessible via a button during Math, so that I don't need to memorize them.*

---

### Epic 5 — Scoring & Results

**Story 5.1: Raw scoring**
*As the scoring engine, I want to compute raw correct/incorrect counts per module, section, domain, and skill for a submitted attempt, so that all downstream scoring and reporting has accurate inputs.*

**Story 5.2: Approximate scaled score**
*As a user, I want my raw score converted to an approximate 200-800 per-section and 400-1600 total scaled score, so that I get a sense of real SAT scoring, clearly labeled as an approximation.*
- Curve built from public score-distribution data (e.g., the supplied sample report) — documented in code comments as approximate, not official.

**Story 5.3: Results dashboard**
*As a user, I want a results screen styled after the real score report — total score, section scores, and domain performance bands — so that I can see my strengths and weaknesses at a glance.*

**Story 5.4: Full answer review**
*As a user, I want to review every question after submitting, with my answer, the correct answer, and the rationale, so that I can learn from mistakes.*
- Any recycled ("seen before") questions are visibly flagged in this view.

---

### Epic 6 — Drill Mode

**Story 6.1: Domain/skill/difficulty picker**
*As a user, I want to choose a domain, skill, and difficulty (or "any") before starting a drill session, so that I can target specific weak areas.*

**Story 6.2: Untimed drill runner**
*As a user, I want instant correct/incorrect feedback and the rationale immediately after each drill question, so that I can learn in real time without waiting for a full test to end.*

**Story 6.3: Drill session summary**
*As a user, I want a short summary at the end of a drill session (accuracy, questions covered), so that I know how the session went.*

---

### Epic 7 — Progress Tracking & History

**Story 7.1: Attempt & drill persistence**
*As a user, I want every test attempt and drill session saved locally, so that my history survives across app restarts.*

**Story 7.2: History view with trend**
*As a user, I want to see my past test attempts and a simple score-over-time trend, so that I can track improvement.*

**Story 7.3: Reset utility**
*As a user, I want a way to reset all local progress, so that I can start fresh if needed.*

---

## 7. Resolved Questions

1. **Adaptive threshold:** ≥60% Module 1 → harder-path confirmed as reasonable.
2. **Bank capacity:** "1 guaranteed fresh full test, then recycling starts" (Section 3.3) confirmed acceptable — no need to shrink test length to stretch content further.
3. **Visual style:** should draw from the real Bluebook app's look (referenced a YouTube walkthrough, which could not be watched directly — no tool available to extract video frames/transcript). Styled instead from general knowledge of the real app's design language; see Section 8. User can correct specifics once the build is visible.

## 8. Visual Style Reference

The real Bluebook app is deliberately sober and "clinical" — designed to not distract from test content, high contrast, almost no color outside of functional accents. Target this look rather than an original UI:

**Palette**
- Background: white / near-white (`#ffffff` / `#fafafa`)
- Text: near-black (`#1a1a1a`), not pure black
- Primary accent (Next/Back buttons, links, active states, progress bar): a deep College-Board blue, approx. `#003882`–`#0B5CAB` range
- Highlighter: standard yellow (`#FFEB3B`-ish), applied as a text background, not a border
- Flag/review marker: a small flag glyph, no bright color needed — outline is enough
- Everything else stays grayscale: thin 1px hairline dividers, no drop shadows, no gradients

**Typography**
- Clean humanist sans-serif throughout (system sans or something in the Roboto/Inter family reads correctly — not a display or serif face anywhere)
- Generous line-height on passage/stimulus text for readability
- Black text on white, no colored body text

**Layout**
- Fixed top bar: small logo mark (left), section/module name, a centered countdown timer (togglable hidden/shown), overflow "more" menu (right)
- R&W questions: two-pane split — passage/stimulus scrolls on the left, question stem + lettered (A–D) choices on the right
- Math questions: single-pane, problem + choices or grid-in input, calculator and reference-sheet buttons available via icon buttons near the top
- Answer choices: each choice is a full-width selectable row/oval, not a bare radio dot; a per-choice cross-out toggle (answer eliminator) sits near each choice, not in a separate global mode
- Fixed bottom bar: Back (left) and Next (right) as filled, pill-shaped blue buttons; a simple "Question X of Y" indicator that expands into the full review grid (numbered bubbles: answered/unanswered/flagged states, click to jump)
- Overall: flat design, rounded-corner buttons, circular icon buttons for tools, generous white space, no visual clutter

This is a starting point, not gospel — correct anything that looks wrong once the first screens are built, since it's built from memory of the real app rather than a frame-by-frame reference.
