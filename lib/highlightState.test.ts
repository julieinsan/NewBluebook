/**
 * Unit tests for Epic 4 highlight JSON helpers (`lib/highlightState.ts`).
 *
 * Pure parse/serialize/merge only — no DB, no HTTP. Run with: `npm test`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeHighlight,
  parseHighlights,
  serializeHighlights,
  type HighlightRange,
} from "./highlightState";

test("parseHighlights treats null and empty as no highlights", () => {
  assert.deepEqual(parseHighlights(null), []);
  assert.deepEqual(parseHighlights(""), []);
  assert.deepEqual(parseHighlights("[]"), []);
});

test("parseHighlights returns validated sorted ranges", () => {
  assert.deepEqual(parseHighlights('[{"start":42,"end":87}]'), [{ start: 42, end: 87 }]);
  assert.deepEqual(parseHighlights('[{"start":10,"end":20,"note":"key term"}]'), [
    { start: 10, end: 20, note: "key term" },
  ]);
});

test("parseHighlights drops invalid entries and merges overlaps", () => {
  assert.deepEqual(parseHighlights("not json"), []);
  assert.deepEqual(parseHighlights('[{"start":5,"end":3}]'), []);
  assert.deepEqual(parseHighlights('[{"start":10,"end":20},{"start":15,"end":30}]'), [
    { start: 10, end: 30 },
  ]);
});

test("serializeHighlights returns null for empty and JSON otherwise", () => {
  assert.equal(serializeHighlights([]), null);
  assert.equal(
    serializeHighlights([{ start: 42, end: 87 }]),
    '[{"start":42,"end":87}]',
  );
});

test("serialize and parse round-trip", () => {
  const ranges: HighlightRange[] = [{ start: 1, end: 5 }, { start: 10, end: 15 }];
  const serialized = serializeHighlights(ranges);
  assert.equal(serialized, '[{"start":1,"end":5},{"start":10,"end":15}]');
  assert.deepEqual(parseHighlights(serialized), ranges);
});

test("mergeHighlight adds a range and merges overlapping or adjacent spans", () => {
  const existing: HighlightRange[] = [{ start: 10, end: 20 }];
  assert.deepEqual(mergeHighlight(existing, { start: 15, end: 30 }), [{ start: 10, end: 30 }]);
  assert.deepEqual(mergeHighlight(existing, { start: 20, end: 25 }), [{ start: 10, end: 25 }]);
  assert.deepEqual(mergeHighlight(existing, { start: 30, end: 40 }), [
    { start: 10, end: 20 },
    { start: 30, end: 40 },
  ]);
});

test("mergeHighlight ignores invalid new ranges", () => {
  const existing: HighlightRange[] = [{ start: 10, end: 20 }];
  assert.deepEqual(mergeHighlight(existing, { start: 25, end: 20 }), existing);
});
