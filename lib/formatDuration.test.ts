/**
 * Unit tests for `formatDuration` (`lib/formatDuration.ts`).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { formatDuration } from "./formatDuration";

test("formatDuration renders sub-minute seconds", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(45), "45s");
});

test("formatDuration renders whole minutes", () => {
  assert.equal(formatDuration(60), "1m");
  assert.equal(formatDuration(120), "2m");
});

test("formatDuration renders minutes and seconds", () => {
  assert.equal(formatDuration(135), "2m 15s");
  assert.equal(formatDuration(61), "1m 1s");
});

test("formatDuration floors and clamps negatives", () => {
  assert.equal(formatDuration(135.9), "2m 15s");
  assert.equal(formatDuration(-10), "0s");
});
