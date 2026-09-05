/**
 * Vitest + Testing Library, for component tests only (`npm run test:ui`).
 *
 * Set up per the framework's own guide
 * (`node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md`): `tsconfigPaths()`
 * so `@/*` resolves the same way it does in the app, `react()` so JSX and Fast Refresh
 * transforms apply, and the jsdom environment so components can be rendered.
 *
 * ## Two deliberate constraints
 *
 * **The `include` glob is narrowed to `app/**` on purpose.** Vitest's default picks up
 * the `.test.ts` files under `lib/` too -- the `node:test` + `better-sqlite3` suite -- and runs them
 * under jsdom with Vitest's runner, where `node:test`'s `test()` never reports to Vitest
 * and better-sqlite3's native binding has no business being loaded. The two suites stay
 * strictly separated: `npm test` is `node:test` over `lib/`, `npm run test:ui` is Vitest
 * over `app/`.
 *
 * **Vitest cannot render `async` Server Components** -- the guide says so explicitly and
 * recommends E2E for them. So this config covers the presentational components and the
 * client subcomponents; the async pages themselves are covered by the manual QA pass.
 * That is the honest coverage boundary, not a gap to be closed later with more config.
 */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    include: ["app/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
