/**
 * Unit tests for the Epic 3 shared contract (`lib/testFlow.ts`).
 *
 * Everything here is pure, so there is no DB and no fixture -- which is itself part of
 * what is being asserted: if any of these functions ever needs a `Database` or a clock to
 * be testable, the parallelism argument that put them in Wave 0 has been broken.
 *
 * The timestamp tests are the load-bearing ones. `datetime('now')` writes UTC without a
 * zone marker, `new Date()` reads that as local time in V8, and the resulting deadline
 * error is a whole UTC offset -- invisible on a UTC machine, and a module that
 * auto-submits on load anywhere else.
 *
 * Run with: `npm test`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BLUEPRINT, BREAK_DURATION_SECONDS } from "./blueprint";
import {
  BREAK_STARTED_AT_COLUMN,
  LATE_ANSWER_GRACE_MS,
  breakDeadline,
  breakPath,
  checkAgainstDeadline,
  formatSqliteTimestamp,
  moduleDeadline,
  moduleStartedAtColumn,
  moduleSubmittedAtColumn,
  moduleTimeLimitSeconds,
  parseSqliteTimestamp,
  answerReviewPath,
  pathForPosition,
  resultsPath,
  reviewPath,
  runnerPath,
  samePosition,
  secondsRemaining,
  submittedPath,
  type ModulePosition,
} from "./testFlow";

test("SQLite timestamps are read as UTC, not as local time", () => {
  // 2026-09-05T14:23:11Z. If this were parsed as local time the result would move by the
  // machine's UTC offset, which is exactly the bug this parser exists to prevent.
  assert.equal(parseSqliteTimestamp("2026-09-05 14:23:11"), Date.UTC(2026, 8, 5, 14, 23, 11));
});

test("ISO-8601 variants of the same instant parse identically", () => {
  const expected = Date.UTC(2026, 8, 5, 14, 23, 11);
  assert.equal(parseSqliteTimestamp("2026-09-05T14:23:11"), expected);
  assert.equal(parseSqliteTimestamp("2026-09-05T14:23:11Z"), expected);
  assert.equal(parseSqliteTimestamp("2026-09-05 14:23:11.000"), expected);
  assert.equal(parseSqliteTimestamp("  2026-09-05 14:23:11  "), expected);
});

test("an unparseable timestamp throws instead of producing NaN", () => {
  // NaN would propagate into a deadline, and `now <= NaN` is false -- a malformed stamp
  // would silently present to the student as "your time is up".
  assert.throws(() => parseSqliteTimestamp("not a timestamp"), /Cannot parse/);
  assert.throws(() => parseSqliteTimestamp(""), /Cannot parse/);
});

test("formatSqliteTimestamp round-trips through parseSqliteTimestamp", () => {
  const instant = Date.UTC(2026, 8, 5, 14, 23, 11);
  assert.equal(formatSqliteTimestamp(instant), "2026-09-05 14:23:11");
  assert.equal(parseSqliteTimestamp(formatSqliteTimestamp(instant)), instant);
});

test("module deadlines are the blueprint limit past the stamped start", () => {
  const startedAt = "2026-09-05 09:00:00";
  const start = parseSqliteTimestamp(startedAt);

  for (const section of ["rw", "math"] as const) {
    const limit = BLUEPRINT[section].moduleTimeLimitSeconds;
    for (const moduleNumber of [1, 2] as const) {
      assert.equal(moduleTimeLimitSeconds(section, moduleNumber), limit);
      assert.equal(moduleDeadline(section, moduleNumber, startedAt), start + limit * 1000);
    }
  }

  // Sanity-check the absolute numbers, so a blueprint edit that silently halved a limit
  // would fail here rather than only in a student's face.
  assert.equal(moduleDeadline("rw", 1, startedAt) - start, 32 * 60 * 1000);
  assert.equal(moduleDeadline("math", 1, startedAt) - start, 35 * 60 * 1000);
});

test("moduleDeadline is pure -- same inputs, same answer, no clock", () => {
  const first = moduleDeadline("rw", 1, "2026-09-05 09:00:00");
  const second = moduleDeadline("rw", 1, "2026-09-05 09:00:00");
  assert.equal(first, second, "a deadline that moved between calls would reset on refresh");
});

test("the break deadline is D8's 10 minutes past break_started_at", () => {
  const breakStartedAt = "2026-09-05 10:30:00";
  assert.equal(
    breakDeadline(breakStartedAt) - parseSqliteTimestamp(breakStartedAt),
    BREAK_DURATION_SECONDS * 1000,
  );
  assert.equal(BREAK_DURATION_SECONDS, 10 * 60);
});

test("the grace window saves a just-late answer but still reports it late", () => {
  const deadline = moduleDeadline("rw", 1, "2026-09-05 09:00:00");

  assert.deepEqual(checkAgainstDeadline(deadline, deadline - 1000), {
    accepted: true,
    isLate: false,
  });
  assert.deepEqual(checkAgainstDeadline(deadline, deadline), { accepted: true, isLate: false });
  assert.deepEqual(checkAgainstDeadline(deadline, deadline + 1), { accepted: true, isLate: true });
  assert.deepEqual(checkAgainstDeadline(deadline, deadline + LATE_ANSWER_GRACE_MS), {
    accepted: true,
    isLate: true,
  });
  assert.deepEqual(checkAgainstDeadline(deadline, deadline + LATE_ANSWER_GRACE_MS + 1), {
    accepted: false,
    isLate: true,
  });
});

test("the grace window is five seconds, expressed in milliseconds", () => {
  // A seconds-vs-millis mixup here is a silent 1000x error in the permissive direction.
  assert.equal(LATE_ANSWER_GRACE_MS, 5_000);
});

test("secondsRemaining floors at zero and never reports a negative countdown", () => {
  const deadline = 1_000_000;
  assert.equal(secondsRemaining(deadline, deadline - 30_000), 30);
  assert.equal(secondsRemaining(deadline, deadline), 0);
  assert.equal(secondsRemaining(deadline, deadline + 60_000), 0);
});

test("stamp column names cover every (section, module) pair exactly once", () => {
  const started = new Set<string>();
  const submitted = new Set<string>();

  for (const section of ["rw", "math"] as const) {
    for (const moduleNumber of [1, 2] as const) {
      started.add(moduleStartedAtColumn(section, moduleNumber));
      submitted.add(moduleSubmittedAtColumn(section, moduleNumber));
    }
  }

  assert.deepEqual(
    [...started].sort(),
    ["math_module1_started_at", "math_module2_started_at", "rw_module1_started_at", "rw_module2_started_at"],
  );
  assert.deepEqual(
    [...submitted].sort(),
    [
      "math_module1_submitted_at",
      "math_module2_submitted_at",
      "rw_module1_submitted_at",
      "rw_module2_submitted_at",
    ],
  );
  assert.equal(BREAK_STARTED_AT_COLUMN, "break_started_at");
});

test("route helpers produce the canonical D4 paths", () => {
  assert.equal(runnerPath(42, "rw", 1), "/test/42/rw/1");
  assert.equal(runnerPath(42, "math", 2), "/test/42/math/2");
  assert.equal(reviewPath(42), "/test/42/review");
  assert.equal(breakPath(42), "/test/42/break");
  assert.equal(submittedPath(42), "/test/42/submitted");
  assert.equal(resultsPath(42), "/test/42/results");
  assert.equal(answerReviewPath(42), "/test/42/results/answers");
});

test("pathForPosition covers every position kind", () => {
  const positions: ModulePosition[] = [
    { kind: "module", section: "rw", module: 1 },
    { kind: "module", section: "math", module: 2 },
    { kind: "break" },
    { kind: "submitted" },
  ];

  assert.deepEqual(
    positions.map((p) => pathForPosition(7, p)),
    ["/test/7/rw/1", "/test/7/math/2", "/test/7/break", "/test/7/submitted"],
  );
});

test("samePosition distinguishes only what D4's guard should act on", () => {
  const rw1: ModulePosition = { kind: "module", section: "rw", module: 1 };

  assert.ok(samePosition(rw1, { kind: "module", section: "rw", module: 1 }));
  assert.ok(!samePosition(rw1, { kind: "module", section: "rw", module: 2 }));
  assert.ok(!samePosition(rw1, { kind: "module", section: "math", module: 1 }));
  assert.ok(!samePosition(rw1, { kind: "break" }));
  assert.ok(samePosition({ kind: "break" }, { kind: "break" }));
  assert.ok(samePosition({ kind: "submitted" }, { kind: "submitted" }));
  assert.ok(!samePosition({ kind: "break" }, { kind: "submitted" }));
});
