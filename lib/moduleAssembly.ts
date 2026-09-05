/**
 * Stories 2.3 (fixed Module 1 assembly) and 2.4 (adaptive Module 2 difficulty mix).
 *
 * Both stories share the same core mechanic: for each domain in the section's
 * blueprint, split that module's per-domain count into an easy/medium/hard target mix,
 * then fill each difficulty bucket via Story 2.2's `selectQuestions`, falling back to
 * the nearest available difficulty within the same domain when a bucket is short
 * (the bank is skewed hard -- see `npm run qa:questions` -- so this fallback is
 * expected to trigger routinely, not just in edge cases).
 *
 * ## Documented difficulty mixes
 *
 * Module 1 (fixed, same for every attempt -- Story 2.3): target ~25% easy / 50% medium
 * / 25% hard per domain, rounded (easy and hard counts round-to-nearest independently;
 * medium absorbs whatever's left so the three always sum exactly to the domain's
 * module1 count). This isn't a PRD-specified number -- it's a reasonable "moderate"
 * baseline for a non-adaptive first module, deliberately not skewed toward the bank's
 * natural hard-heavy distribution, so Module 1 gives a fair read on ability before
 * Module 2 adapts.
 *
 * Module 2 (adaptive -- Story 2.4), keyed by the routed path:
 *  - "harder" path (Module 1 score >= 60%): ~10% easy / 35% medium / 55% hard.
 *  - "easier" path (Module 1 score < 60%): ~50% easy / 40% medium / 10% hard.
 * These aren't published College Board numbers either; they're a reasonable
 * approximation of a harder/easier follow-on pool, adjustable here if a better-
 * justified split turns up later.
 *
 * ## Difficulty fallback rule ("nearest available difficulty")
 *
 * Difficulties are ordered easy < medium < hard. When a target bucket's own difficulty
 * doesn't have enough remaining, unclaimed questions in that domain, the shortfall is
 * filled from the nearest other difficulty first:
 *  - easy target short  -> try medium, then hard
 *  - hard target short  -> try medium, then easy
 *  - medium target short -> ties (both neighbors are distance 1) are broken toward
 *    easy first, then hard -- since the bank already skews hard, leaning easy on ties
 *    avoids compounding that skew into an even-harder-than-intended module.
 * If a domain still can't produce its full module count even after exhausting every
 * difficulty, this throws (that would mean the domain's total bank size is smaller
 * than the blueprint's per-module need, which does happen only for edge cases the
 * blueprint doesn't anticipate; today, every domain's bank is large enough).
 */
import type Database from "better-sqlite3";
import type { Section, Difficulty, ModuleNumber } from "./blueprint";
import { getSectionBlueprint } from "./blueprint";
import { selectQuestions, type SelectedQuestion } from "./questionSelector";

export type DifficultyMix = Record<Difficulty, number>;

export const MODULE1_DIFFICULTY_MIX: DifficultyMix = { easy: 0.25, medium: 0.5, hard: 0.25 };

export const MODULE2_DIFFICULTY_MIX: Record<"harder" | "easier", DifficultyMix> = {
  harder: { easy: 0.1, medium: 0.35, hard: 0.55 },
  easier: { easy: 0.5, medium: 0.4, hard: 0.1 },
};

const FALLBACK_ORDER: Record<Difficulty, Difficulty[]> = {
  easy: ["easy", "medium", "hard"],
  medium: ["medium", "easy", "hard"],
  hard: ["hard", "medium", "easy"],
};

/**
 * Order in which leftover units are handed out when two difficulties have an equal
 * claim to them. Leans easy for the same reason `FALLBACK_ORDER` breaks medium's ties
 * toward easy: the bank already skews hard, so a coin-flip resolved hard-ward would
 * compound that skew.
 */
const REMAINDER_TIE_BREAK: Difficulty[] = ["easy", "medium", "hard"];

/**
 * Splits `total` into easy/medium/hard counts per `mix`, guaranteed to sum to `total`
 * with no negative bucket, for ANY mix that sums to 1.
 *
 * Uses largest-remainder (Hamilton) allocation: floor every bucket, then hand the
 * leftover units to whichever buckets were cut hardest by that flooring.
 *
 * The previous implementation rounded easy and hard independently and let medium
 * absorb the difference (`medium = total - easy - hard`). That summed to `total` only
 * by luck: whenever rounding pushed easy + hard above `total`, medium went NEGATIVE,
 * and `assembleModuleForSection`'s `if (remaining <= 0) continue` silently swallowed
 * it -- over-filling the domain past its blueprint count. Not reachable with today's
 * three mixes, but these constants are documented as tunable, so the invariant should
 * hold by construction rather than by arithmetic coincidence.
 *
 * Largest-remainder also tracks the requested proportions more closely than
 * independent rounding did. For a 25/50/25 mix over 6 questions, the old code returned
 * 2/2/2 (medium a full question short of its 3.0 target); this returns 2/3/1.
 *
 * Throws if `mix` doesn't sum to 1 -- with a mix summing to less than 1 there'd be no
 * principled home for the surplus, and with one summing to more the floors alone could
 * exceed `total`. Either way it's a caller bug worth surfacing loudly.
 */
export function splitByDifficulty(total: number, mix: DifficultyMix): Record<Difficulty, number> {
  const mixSum = mix.easy + mix.medium + mix.hard;
  if (Math.abs(mixSum - 1) > 1e-9) {
    throw new Error(
      `Difficulty mix must sum to 1, got ${mixSum} ` +
        `(easy ${mix.easy}, medium ${mix.medium}, hard ${mix.hard})`,
    );
  }

  const exact: Record<Difficulty, number> = {
    easy: total * mix.easy,
    medium: total * mix.medium,
    hard: total * mix.hard,
  };

  const counts: Record<Difficulty, number> = {
    easy: Math.floor(exact.easy),
    medium: Math.floor(exact.medium),
    hard: Math.floor(exact.hard),
  };

  // Hand out the units lost to flooring, largest fractional remainder first.
  // Array#sort is stable, so equal remainders keep REMAINDER_TIE_BREAK's order.
  const byRemainder = REMAINDER_TIE_BREAK.slice().sort(
    (a, b) => exact[b] - Math.floor(exact[b]) - (exact[a] - Math.floor(exact[a])),
  );

  let leftover = total - (counts.easy + counts.medium + counts.hard);
  for (let i = 0; leftover > 0; i += 1) {
    counts[byRemainder[i % byRemainder.length]] += 1;
    leftover -= 1;
  }

  return counts;
}

interface AssembleParams {
  section: Section;
  module: ModuleNumber;
  mix: DifficultyMix;
  attemptId: number;
  /**
   * Question IDs that must never be (re-)selected in this call, regardless of domain
   * -- used to hard-exclude questions this same attempt already served in another
   * module of the same section (e.g. Module 1's picks, when assembling Module 2), so
   * the same question can never appear twice within one attempt. This is a stronger,
   * different rule than the LRU selector's recency preference: recency just prefers
   * fresher questions across DIFFERENT attempts, whereas this prevents a same-attempt
   * repeat outright.
   */
  excludeIds?: string[];
}

/**
 * Assembles one module for one section: for every domain in the blueprint, selects
 * that domain's module count of questions split per `mix`, with difficulty fallback.
 * Returns questions grouped by domain in blueprint order (each domain's own questions
 * are not meaningfully ordered beyond that -- Story 2.5 assigns the final
 * `order_index`).
 */
export function assembleModuleForSection(
  db: Database.Database,
  { section, module, mix, attemptId, excludeIds: hardExcludeIds = [] }: AssembleParams,
): SelectedQuestion[] {
  const blueprint = getSectionBlueprint(section);
  const results: SelectedQuestion[] = [];

  for (const domainBlueprint of blueprint.domains) {
    const domainCount = module === 1 ? domainBlueprint.module1 : domainBlueprint.module2;
    const targets = splitByDifficulty(domainCount, mix);
    const excludeIds: string[] = [...hardExcludeIds, ...results.map((q) => q.id)];

    for (const targetDifficulty of ["easy", "medium", "hard"] as const) {
      let remaining = targets[targetDifficulty];
      if (remaining <= 0) continue;

      for (const fallbackDifficulty of FALLBACK_ORDER[targetDifficulty]) {
        if (remaining <= 0) break;

        const got = selectQuestions(db, {
          section,
          domain: domainBlueprint.domain,
          difficulty: fallbackDifficulty,
          count: remaining,
          attemptId,
          excludeIds,
        });

        results.push(...got);
        excludeIds.push(...got.map((q) => q.id));
        remaining -= got.length;
      }

      if (remaining > 0) {
        throw new Error(
          `Not enough "${domainBlueprint.domain}" questions in section "${section}" to fill ` +
            `the "${targetDifficulty}" target for module ${module} even after difficulty ` +
            `fallback (short by ${remaining}). Bank does not have enough distinct questions ` +
            `in this domain to meet the blueprint's per-module count.`,
        );
      }
    }
  }

  return results;
}

/** Story 2.3: assembles Module 1 (fixed, moderate mix) for a section. */
export function assembleModule1(db: Database.Database, section: Section, attemptId: number): SelectedQuestion[] {
  return assembleModuleForSection(db, {
    section,
    module: 1,
    mix: MODULE1_DIFFICULTY_MIX,
    attemptId,
  });
}
