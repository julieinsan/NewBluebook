/**
 * Unit tests for POST /api/attempts practice-test parsing.
 *
 * Run with: `npm test`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parsePracticeTest } from "./practiceTest";

test("parsePracticeTest defaults to 1 for null, non-object, and empty body", () => {
  assert.equal(parsePracticeTest(null), 1);
  assert.equal(parsePracticeTest(undefined), 1);
  assert.equal(parsePracticeTest("oops"), 1);
  assert.equal(parsePracticeTest({}), 1);
});

test("parsePracticeTest accepts 1 and 2", () => {
  assert.equal(parsePracticeTest({ practiceTest: 1 }), 1);
  assert.equal(parsePracticeTest({ practiceTest: 2 }), 2);
});

test("parsePracticeTest rejects invalid values", () => {
  assert.throws(() => parsePracticeTest({ practiceTest: 0 }), /practiceTest must be 1 or 2/);
  assert.throws(() => parsePracticeTest({ practiceTest: 3 }), /practiceTest must be 1 or 2/);
  assert.throws(() => parsePracticeTest({ practiceTest: "2" }), /practiceTest must be 1 or 2/);
  assert.throws(() => parsePracticeTest({ practiceTest: null }), /practiceTest must be 1 or 2/);
});
