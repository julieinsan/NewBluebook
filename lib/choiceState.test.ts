/**
 * Unit tests for Epic 4 cross-out JSON helpers (`lib/choiceState.ts`).
 *
 * Pure parse/serialize/toggle only — no DB, no HTTP. Run with: `npm test`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCrossedOutChoices,
  serializeCrossedOutChoices,
  toggleCrossedOut,
} from "./choiceState";

test("parseCrossedOutChoices treats null and empty as no cross-outs", () => {
  assert.deepEqual(parseCrossedOutChoices(null), []);
  assert.deepEqual(parseCrossedOutChoices(""), []);
  assert.deepEqual(parseCrossedOutChoices("[]"), []);
});

test("parseCrossedOutChoices returns sorted valid letters", () => {
  assert.deepEqual(parseCrossedOutChoices('["D","B"]'), ["B", "D"]);
  assert.deepEqual(parseCrossedOutChoices('["a","c"]'), ["A", "C"]);
});

test("parseCrossedOutChoices ignores invalid JSON and non-letter entries", () => {
  assert.deepEqual(parseCrossedOutChoices("not json"), []);
  assert.deepEqual(parseCrossedOutChoices('{"A":true}'), []);
  assert.deepEqual(parseCrossedOutChoices('["B",2,"E","C"]'), ["B", "C"]);
});

test("serializeCrossedOutChoices returns null for empty and sorted JSON otherwise", () => {
  assert.equal(serializeCrossedOutChoices([]), null);
  assert.equal(serializeCrossedOutChoices(["D", "B"]), '["B","D"]');
});

test("serialize and parse round-trip", () => {
  const letters = ["A", "C"];
  const serialized = serializeCrossedOutChoices(letters);
  assert.equal(serialized, '["A","C"]');
  assert.deepEqual(parseCrossedOutChoices(serialized), letters);
});

test("toggleCrossedOut adds, removes, and keeps letters sorted", () => {
  assert.deepEqual(toggleCrossedOut([], "B"), ["B"]);
  assert.deepEqual(toggleCrossedOut(["B"], "B"), []);
  assert.deepEqual(toggleCrossedOut(["A", "C"], "B"), ["A", "B", "C"]);
  assert.deepEqual(toggleCrossedOut(["A", "C"], "Z"), ["A", "C"]);
});
