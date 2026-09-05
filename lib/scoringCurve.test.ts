/**
 * Unit tests for approximate scaled-score curves (`lib/scoringCurve.ts`).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { rawToScaledMath, rawToScaledRw } from "./scoringCurve";

test("rawToScaledRw endpoints map to 200 and 800", () => {
  assert.equal(rawToScaledRw(0), 200);
  assert.equal(rawToScaledRw(54), 800);
});

test("rawToScaledMath endpoints map to 200 and 800", () => {
  assert.equal(rawToScaledMath(0), 200);
  assert.equal(rawToScaledMath(44), 800);
});

test("curves are monotonic non-decreasing", () => {
  for (let raw = 0; raw < 54; raw++) {
    assert.ok(rawToScaledRw(raw + 1) >= rawToScaledRw(raw), `RW not monotonic at ${raw}`);
  }
  for (let raw = 0; raw < 44; raw++) {
    assert.ok(rawToScaledMath(raw + 1) >= rawToScaledMath(raw), `Math not monotonic at ${raw}`);
  }
});

test("curves clamp out-of-range raw scores", () => {
  assert.equal(rawToScaledRw(-5), 200);
  assert.equal(rawToScaledRw(100), 800);
  assert.equal(rawToScaledMath(-1), 200);
  assert.equal(rawToScaledMath(99), 800);
});

test("mid-range raw scores land in the plausible 400–600 band", () => {
  const rwHalf = rawToScaledRw(27);
  const mathHalf = rawToScaledMath(22);
  assert.ok(rwHalf >= 400 && rwHalf <= 600, `RW half-score ${rwHalf} out of band`);
  assert.ok(mathHalf >= 400 && mathHalf <= 600, `Math half-score ${mathHalf} out of band`);
});
