/**
 * Story 2.1: Test blueprint configuration.
 *
 * Single source of truth for the per-section / per-domain question counts and module
 * time limits described in PRD.md Section 3.2. Assembly logic (Stories 2.2-2.5) and,
 * later, the UI (Epic 3) should read from here rather than re-deriving or hardcoding
 * any of these numbers.
 *
 * Per-domain totals come directly from PRD Section 3.2. Each domain's total is split
 * as evenly as possible across the two modules of its section (module1 gets the ceil
 * half when the total is odd), per the PRD's own module1/module2 split description.
 */

export type Section = "rw" | "math";
export type Difficulty = "easy" | "medium" | "hard";
export type ModuleNumber = 1 | 2;

export interface DomainBlueprint {
  /** Must match `questions.domain` exactly. */
  domain: string;
  /** Total questions drawn from this domain per full test (module 1 + module 2). */
  total: number;
  /** Questions drawn from this domain for module 1. */
  module1: number;
  /** Questions drawn from this domain for module 2. */
  module2: number;
}

export interface SectionBlueprint {
  section: Section;
  /** Per-module timer duration, in seconds. */
  moduleTimeLimitSeconds: number;
  domains: DomainBlueprint[];
}

export const BLUEPRINT: Record<Section, SectionBlueprint> = {
  rw: {
    section: "rw",
    moduleTimeLimitSeconds: 32 * 60, // 1920s, per PRD 3.2 / App user guide
    domains: [
      { domain: "Information and Ideas", total: 14, module1: 7, module2: 7 },
      { domain: "Craft and Structure", total: 15, module1: 7, module2: 8 },
      { domain: "Expression of Ideas", total: 11, module1: 6, module2: 5 },
      { domain: "Standard English Conventions", total: 14, module1: 7, module2: 7 },
    ],
  },
  math: {
    section: "math",
    moduleTimeLimitSeconds: 35 * 60, // 2100s, per PRD 3.2 / App user guide
    domains: [
      { domain: "Algebra", total: 15, module1: 7, module2: 8 },
      { domain: "Advanced Math", total: 15, module1: 7, module2: 8 },
      { domain: "Problem-Solving and Data Analysis", total: 7, module1: 4, module2: 3 },
      { domain: "Geometry and Trigonometry", total: 7, module1: 4, module2: 3 },
    ],
  },
};

export function getSectionBlueprint(section: Section): SectionBlueprint {
  return BLUEPRINT[section];
}

/** Total question count for a given section + module across all its domains. */
export function moduleQuestionCount(section: Section, module: ModuleNumber): number {
  const key = module === 1 ? "module1" : "module2";
  return BLUEPRINT[section].domains.reduce((sum, d) => sum + d[key], 0);
}

/** Per-domain count for a given section + module. */
export function domainCountForModule(
  section: Section,
  domain: string,
  module: ModuleNumber,
): number {
  const d = BLUEPRINT[section].domains.find((d) => d.domain === domain);
  if (!d) {
    throw new Error(`Unknown domain "${domain}" for section "${section}"`);
  }
  return module === 1 ? d.module1 : d.module2;
}
