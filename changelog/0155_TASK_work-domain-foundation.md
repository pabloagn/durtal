# Task 0155: Explicit Work Domains

**Status**: Completed locally; awaiting review and deployment
**Created**: 2026-09-30
**Priority**: HIGH
**Type**: Infrastructure
**Linear**: SLN-346 (parent SLN-345)
**Depends On**: Existing migration 0032 and harmonization baseline 0e11740
**Blocks**: SLN-347, SLN-348 and domain-specific implementation

## Overview

Begin the curated-library expansion with explicit book, film, perfume and
painting identities. Preserve the current book catalogue while the other
domains and legacy-query isolation are implemented. The complete design,
layouts and 37-issue delivery graph are in docs/14_CURATED_LIBRARY_PLAN.md.

## Implementation Details

- Added the exhaustive work-kind and domain registries. Retained existing book
  URLs; author-role constants now use the registry. New domains are disabled.
- Generated migration 0033: the PostgreSQL enum and non-null works.kind column,
  defaulting every existing row and legacy insert to book.
- Added a database CHECK allowing only the currently enabled book domain.
  A later reviewed activation migration must widen it alongside domain
  readiness. A separate trigger keeps identity immutable even after activation.
- Book and fast-track creation reject explicit non-book identities. Work updates
  now validate with the update schema and reject kind changes before DB access.
- Removed create-time defaults from partial-update fields. Zod 4 otherwise
  applies those defaults inside optional fields; a notes edit must preserve
  language, anthology flag, lifecycle and acquisition priority.
- Updated data-model documentation and added contract, action-boundary and
  populated migration tests. Existing art-tagged works remain books.

## Verification

- Baseline: typecheck passed; 488 non-database tests passed, 149 integration tests
  were initially skipped without explicit disposable database URLs.
- Final: **54 test files, 681 tests passed, zero skipped**. All 21 PostgreSQL
  integration suites were explicitly enabled against separate local test
  databases in a disposable postgres:16 container.
- The populated migration test compares every public-table row before and after
  the upgrade (69 tables). Fixtures include art taxonomy, work type, authors,
  translators, two editions, physical/digital copies, publisher aliases,
  edition-specific collections, orders, images, comments and merge redirects.
- Verified legacy insert defaults, invalid/null/disabled kinds, identity
  immutability after a simulated future activation, ordinary edits and repeated
  migration application.
- pnpm typecheck passed. ESLint passed for all changed application files;
  the repository excludes test files from ESLint. git diff --check passed.
- Regenerating the Drizzle schema reports no changes.
- Production build (`pnpm build --webpack`) compiled and passed TypeScript,
  then failed prerendering /_not-found and /collections because the isolated
  checkout has no DATABASE_URL. This exposes the existing database-at-build-time
  problem in SLN-283; it now explicitly blocks the expansion's release task
  SLN-382. A complete production build is not claimed.
- No frontend rendering changed in this task. Domain page and visual QA work
  remains in SLN-364 through SLN-370 and SLN-380.

Run the focused database test by setting
DURTAL_WORK_KIND_TEST_DATABASE_URL to a disposable localhost database named
sln346_migration_test, then:

```sh
pnpm test src/__tests__/catalogue src/__tests__/integration/work-kind-migration.test.ts
pnpm typecheck
```

The test deliberately resets that named database's public and drizzle schemas;
it rejects remote hosts or a different database name and never loads DATABASE_URL.

## Rollout and Completion Notes

The SQL was applied only in disposable tests. Apply migration 0033 before running
this application revision. No production database or S3 assets were changed.
With only book rows allowed, reverting the application retains compatibility;
future non-book activation requires the compatible rollback plan in SLN-382.

The perfume, film and painting data models and screens are still backlog work.
This foundation is not their release. Implementation is isolated on
codex/curated-library; the original checkout and its uncommitted author-picker
changes were preserved and verified by hashes.
