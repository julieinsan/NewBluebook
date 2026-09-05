import test from "node:test";
import assert from "node:assert/strict";
import { parseDrillFilters, drillPath, drillSummaryPath } from "./drillFlow";

test("drill route helpers", () => {
  assert.equal(drillPath(5), "/drill/5");
  assert.equal(drillSummaryPath(5), "/drill/5/summary");
});

test("parseDrillFilters accepts domain with optional skill and difficulty", () => {
  assert.deepEqual(parseDrillFilters({ domain: "Algebra" }), {
    domain: "Algebra",
    skill: null,
    difficulty: "any",
  });
  assert.deepEqual(
    parseDrillFilters({ domain: "Algebra", skill: "Skill A", difficulty: "hard" }),
    {
      domain: "Algebra",
      skill: "Skill A",
      difficulty: "hard",
    },
  );
});

test("parseDrillFilters rejects invalid body", () => {
  assert.throws(() => parseDrillFilters(null), /JSON object/);
  assert.throws(() => parseDrillFilters({}), /domain is required/);
  assert.throws(() => parseDrillFilters({ domain: "Algebra", difficulty: "tough" }), /difficulty/);
});
