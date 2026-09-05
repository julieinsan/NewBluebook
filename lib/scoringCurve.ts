/**
 * Epic 5 (Story 5.2): approximate raw → scaled score conversion.
 *
 * These curves are **not** official College Board equating tables (PRD §2 non-goals).
 * They are piecewise-linear maps derived from plausible SAT score-distribution shape:
 * steep in the middle, compressed at the low and high ends, endpoints at 200 and 800.
 *
 * R&W: 54 questions per section. Math: 44 questions per section.
 * Adjust anchor tables here if product wants a different approximation.
 */

/** Inclusive raw-correct anchors → scaled score (200–800). */
const RW_ANCHORS: readonly (readonly [number, number])[] = [
  [0, 200],
  [8, 260],
  [16, 340],
  [22, 420],
  [27, 480],
  [32, 540],
  [38, 610],
  [44, 680],
  [50, 750],
  [54, 800],
];

const MATH_ANCHORS: readonly (readonly [number, number])[] = [
  [0, 200],
  [6, 270],
  [12, 350],
  [18, 430],
  [22, 490],
  [26, 550],
  [30, 610],
  [36, 690],
  [40, 750],
  [44, 800],
];

const RW_MAX = 54;
const MATH_MAX = 44;

function interpolateAnchors(
  anchors: readonly (readonly [number, number])[],
  rawCorrect: number,
  maxRaw: number,
): number {
  const clamped = Math.max(0, Math.min(maxRaw, Math.floor(rawCorrect)));

  for (let i = 0; i < anchors.length - 1; i++) {
    const [x0, y0] = anchors[i];
    const [x1, y1] = anchors[i + 1];
    if (clamped >= x0 && clamped <= x1) {
      if (x0 === x1) return y1;
      const t = (clamped - x0) / (x1 - x0);
      return Math.round(y0 + t * (y1 - y0));
    }
  }

  return anchors[anchors.length - 1][1];
}

/** Map R&W raw correct (0–54) to an approximate scaled score (200–800). */
export function rawToScaledRw(rawCorrect: number): number {
  return interpolateAnchors(RW_ANCHORS, rawCorrect, RW_MAX);
}

/** Map Math raw correct (0–44) to an approximate scaled score (200–800). */
export function rawToScaledMath(rawCorrect: number): number {
  return interpolateAnchors(MATH_ANCHORS, rawCorrect, MATH_MAX);
}
