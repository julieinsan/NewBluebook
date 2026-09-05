/**
 * SCAFFOLD TEST -- delete me.
 *
 * Task 0.5 exists to make Wave 2's component tests possible, and a test setup nobody has
 * run is a setup that does not work. This renders a trivial inline component through
 * Testing Library so `npm run test:ui` proves the whole chain end to end: the jsdom
 * environment, the React plugin's JSX transform, and Testing Library's render/query.
 *
 * It also imports one value through the `@/` alias, which is the only part of the setup
 * that fails *silently* rather than loudly: without `tsconfigPaths()` the alias resolves
 * in `tsc` but not in Vitest, so the first Wave 2 test to import `@/lib/testFlow` would
 * be the one to discover it.
 *
 * It asserts nothing else about this app. The moment Wave 2 lands a real
 * `app/(test)/_components/*.test.tsx`, this file and its `_scaffold` directory should be
 * deleted -- the leading underscore makes the directory private to the App Router, so it
 * is never routable in the meantime.
 */
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { BREAK_DURATION_SECONDS } from "@/lib/blueprint";

function ScaffoldHeading() {
  return <h1>Vitest scaffold</h1>;
}

test("Testing Library renders a component into jsdom", () => {
  render(<ScaffoldHeading />);
  expect(screen.getByRole("heading", { level: 1, name: "Vitest scaffold" })).toBeDefined();
});

test("the @/ path alias resolves inside the Vitest environment", () => {
  expect(BREAK_DURATION_SECONDS).toBe(600);
});
