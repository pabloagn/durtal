# Task 0243: Production Build Returns 500 on Author Pages

**Status**: Completed
**Created**: 2026-10-04
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: SLN-382 (the release rehearsal needs a working production build)

## Overview
A production build of main (`next build` + `next start`) returned 500 on
`/authors/<slug>`. The server logged
`There is not enough information to infer relation "works.workAuthors"` and
the same for `works.media`. `next dev` served the same pages without errors.

## Implementation Details
- Cause, measured with a temporary log in `getDb` (not committed): in the
  production build, the `works` table that `workAuthorsRelations` and
  `mediaRelations` point to is a different object from `schema.works`. Drizzle
  pairs the two sides of a relation by table object identity, so it found no
  reverse side.
- Each table is defined once in the server chunks. Turbopack scope hoisting
  merges the 33 modules of the `src/lib/db/schema` import cycle into one
  factory. The factory runs more than once, so `schema/index.ts` re-exports a
  mix of copies. `next dev` does not hoist, which is why it works there.
- Fix: `experimental.turbopackScopeHoisting: false` in `next.config.ts`.
- Rejected: adding `relationName` to `works.workAuthors` only. The build also
  fails on `works.media`, and 31 `many()` relations point to a table in another
  schema file. Naming them all would still leave two copies of the schema.

## Completion Notes
- Before (production build of main c9f6359): `/authors/david-peace` and
  `/authors/sigrid-undset` return 500.
- After: `/`, `/library`, `/library/identify`, `/authors`, both author pages,
  `/collections`, `/series`, `/publishers`, `/recommenders`, `/places`,
  `/provenance`, `/locations`, `/reader`, `/taxonomy` and `/settings` return
  200, with no errors in the server log. The temporary log showed every
  relation pointing to `schema.works`.
- Cost: client scripts grow about 3.4% because hoisting is off for the whole
  build. 404 page 1,089,834 to 1,127,519 bytes, `/` 1,214,905 to 1,255,722,
  `/authors` 1,174,073 to 1,213,723, `/library` 1,286,728 to 1,329,962.
- No migration.
