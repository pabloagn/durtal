# Task 1143: Server code stays out of browser bundles

**Status**: Completed
**Created**: 2026-10-20
**Priority**: HIGH
**Type**: Fix
**Depends On**: 1065
**Blocks**: None

## Overview

SLN-1278. Pick one for me (`pick-one.tsx`, a client file) reached the
database client through `score.ts` -> `features.ts` -> `lib/reading/series.ts`,
whose `nextToRead` dynamically imported `@/lib/db` and
`@/lib/harmonization/store`. The bundler put the Neon driver, drizzle and the
schema into a lazy browser chunk. The Mapbox token's `publicEnv` lived in
`lib/env.ts`, so two client files also shipped the server env schema (names,
no values), and the library filters shipped drizzle's `pgEnum` builders through
`filter-params.ts`.

## Implementation Details

- `nextToRead` moved to `src/lib/reading/series-next.ts`. `series.ts` is pure
  again (series order and `nextVolume`); `actions/reading.ts` and the two
  integration tests import the new module.
- `publicEnv` moved to `src/lib/env-public.ts`; `authors-map.tsx` and
  `integration-checks.tsx` import it from there.
- `filter-params.ts` takes the catalogue statuses from `lib/types` (plain
  values) instead of `catalogueStatusEnum.enumValues`, and the enum is built
  from the same list, so the two cannot drift. Values and order are
  unchanged, so no migration.
- `client-import-graph.test.ts` now follows dynamic `import()` too (not the
  `typeof import()` type form) and forbids any client path to a file under
  `lib/db/`, `lib/env.ts` or `lib/harmonization/store.ts`, or to
  `drizzle-orm/pg-core`, `@neondatabase/*` and `@aws-sdk/*`. Bare
  `drizzle-orm` stays allowed: `at-hand.ts` and `holdings.ts` use its `sql`
  tag, which tree-shakes out of the browser build. On main the test lists
  the four chains above.

## Completion Notes

- Sentinel build first, on main: every secret variable set to a sentinel.
  No sentinel value was found under `.next/static` or `.next/server`.
- After the fix `.next/static` has no `DATABASE_URL`, `AWS_SECRET_ACCESS_KEY`,
  `neondatabase`, `serverEnv`, "Invalid environment configuration",
  `drizzle:` or `pgEnum` (on main: 6, 4, 2, 4 files; drizzle in 7).
- No `import "server-only"` marker: the package is not installed (Next only
  aliases it), and tsx scripts under `scripts/ebooks/` import `lib/db`
  directly, where the marker would throw. The import-graph test is the guard.
- Pick one for me draws a book in Chromium, Firefox and WebKit; page weight
  within budget on /reading/suggestions, /authors, /settings/integrations.
