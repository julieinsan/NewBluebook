import { expect, test } from "vitest";
import { formatAttemptStartedAt, positionLabel, practiceTestLabel } from "./positionLabel";

test("positionLabel maps module positions", () => {
  expect(positionLabel({ kind: "module", section: "rw", module: 1 })).toBe(
    "Reading and Writing · Module 1",
  );
  expect(positionLabel({ kind: "module", section: "math", module: 2 })).toBe(
    "Math · Module 2",
  );
  expect(positionLabel({ kind: "break" })).toBe("Section break");
  expect(positionLabel({ kind: "submitted" })).toBe("Submitted");
});

test("practiceTestLabel maps practice test numbers", () => {
  expect(practiceTestLabel(1)).toBe("Practice Test 1");
  expect(practiceTestLabel(2)).toBe("Practice Test 2");
});

test("formatAttemptStartedAt formats SQLite timestamps", () => {
  expect(formatAttemptStartedAt("2026-09-05 14:23:11")).toMatch(/2026/);
});
