/**
 * Unit tests for `splitByDifficulty`'s allocation invariants.
 *
 * These are pure-function tests (no DB): the point is that the "sums to total, never
 * negative" guarantee holds for ANY mix summing to 1, not just the three mixes this
 * app ships today. The old independent-rounding implementation held it only for the
 * shipped mixes -- see the adversarial case below, which it got wrong.
 *
 * Run with: `npm test`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  splitByDifficulty,
  MODULE1_DIFFICULTY_MIX,
  MODULE2_DIFFICULTY_MIX,
  type DifficultyMix,
} from "./moduleAssembly";

const SHIPPED_MIXES: [string, DifficultyMix][] = [
  ["module 1", MODULE1_DIFFICULTY_MIX],
  ["module 2 harder", MODULE2_DIFFICULTY_MIX.harder],
  ["module 2 easier", MODULE2_DIFFICULTY_MIX.easier],
];

test("shipped mixes: always sum to total and never go negative, for every plausible domain count", () => {
  for (const [label, mix] of SHIPPED_MIXES) {
    for (let total = 0; total <= 40; total++) {
      const split = splitByDifficulty(total, mix);
      const sum = split.easy + split.medium + split.hard;
      assert.equal(sum, total, `${label} @ total=${total}: summed to ${sum}`);
      for (const difficulty of ["easy", "medium", "hard"] as const) {
        assert.ok(
          split[difficulty] >= 0,
          `${label} @ total=${total}: ${difficulty} was negative (${split[difficulty]})`,
        );
      }
    }
  }
});

test("arbitrary mixes summing to 1 also sum to total and stay non-negative", () => {
  // Walk a grid of mixes rather than only the shipped three -- the constants are
  // documented as tunable, so the invariant has to hold for whatever replaces them.
  for (let e = 0; e <= 10; e++) {
    for (let m = 0; m + e <= 10; m++) {
      const mix: DifficultyMix = { easy: e / 10, medium: m / 10, hard: (10 - e - m) / 10 };
      for (let total = 0; total <= 20; total++) {
        const split = splitByDifficulty(total, mix);
        assert.equal(
          split.easy + split.medium + split.hard,
          total,
          `mix ${JSON.stringify(mix)} @ total=${total}`,
        );
        assert.ok(
          split.easy >= 0 && split.medium >= 0 && split.hard >= 0,
          `mix ${JSON.stringify(mix)} @ total=${total} produced a negative bucket`,
        );
      }
    }
  }
});

test("adversarial mix that the old independent-rounding split got wrong", () => {
  // 50/0/50 over 3: old code did round(1.5)=2 easy, round(1.5)=2 hard, leaving
  // medium = 3 - 2 - 2 = -1. assembleModuleForSection's `remaining <= 0` check then
  // silently skipped that bucket and over-filled the domain.
  const split = splitByDifficulty(3, { easy: 0.5, medium: 0, hard: 0.5 });
  assert.equal(split.easy + split.medium + split.hard, 3);
  assert.ok(split.medium >= 0, `medium was ${split.medium}`);
  // Tie on the leftover unit (both remainders .5) resolves toward easy.
  assert.deepEqual(split, { easy: 2, medium: 0, hard: 1 });
});

test("exact proportions are honoured when the split is clean", () => {
  assert.deepEqual(splitByDifficulty(4, MODULE1_DIFFICULTY_MIX), { easy: 1, medium: 2, hard: 1 });
  assert.deepEqual(splitByDifficulty(20, MODULE2_DIFFICULTY_MIX.harder), {
    easy: 2,
    medium: 7,
    hard: 11,
  });
});

test("largest-remainder beats the old rounding on the 6-question domain", () => {
  // R&W "Expression of Ideas" has module1 = 6. Target is 1.5 / 3.0 / 1.5; the old code
  // returned 2/2/2, a full question short on medium. Largest remainder gives medium its
  // exact 3 and breaks the easy/hard tie toward easy.
  assert.deepEqual(splitByDifficulty(6, MODULE1_DIFFICULTY_MIX), { easy: 2, medium: 3, hard: 1 });
});

test("total of 0 yields an empty split rather than throwing", () => {
  assert.deepEqual(splitByDifficulty(0, MODULE1_DIFFICULTY_MIX), { easy: 0, medium: 0, hard: 0 });
});

test("a mix that does not sum to 1 is rejected", () => {
  assert.throws(
    () => splitByDifficulty(10, { easy: 0.5, medium: 0.5, hard: 0.5 }),
    /must sum to 1/,
  );
  assert.throws(() => splitByDifficulty(10, { easy: 0.1, medium: 0.1, hard: 0.1 }), /must sum to 1/);
});
