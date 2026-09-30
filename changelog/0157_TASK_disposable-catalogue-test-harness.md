# Task 0157: Disposable Catalogue Test Harness

**Status**: Completed locally; awaiting review
**Created**: 2026-09-30
**Priority**: HIGH
**Type**: Infrastructure
**Linear**: SLN-348 (parent SLN-345)
**Depends On**: SLN-346
**Blocks**: Shared models and migration rehearsal

## Implementation Details

`pnpm test:local` creates a fresh PostgreSQL container and a separate explicitly
named database for each integration suite. It requires Docker and the locally
installed postgres:16 image; it does not install or pull dependencies. It
rejects unrecognized/shared database guards, removes application database
environment variables, suppresses dotenv config loading, waits for the final
TCP server, and removes its container and volume on exit or interruption.
Skipped tests fail the run. Optional positional file filters support focused
runs; `--report-dir` chooses the log/report directory.

The populated migration fixture includes multiple editions, translators,
physical/digital copies, publisher/imprint identities and aliases, confirmed
edition publishers, fulfilled targets, Calibre links, status history, art
taxonomy, series, edition collections, images, comments, activity, orders and
harmonization redirects. Every expansion migration is applied independently
and all existing public-table rows are reconciled. Kind is the sole expected
addition in migrations 0033–0034. Reapplying the migration runner is verified.
Other integration suites exercise clean installation of the complete chain.

The Neon contract suite uses the installed Neon client and Drizzle neon-http
driver, intercepting only the HTTP endpoint to execute its serialized batches
against disposable PostgreSQL. It verifies one request, statement ordering,
returning-row decoding, read-after-write within a batch, empty batches, and full
rollback on a later constraint failure. It explicitly verifies that interactive
transactions are unsupported. This covers our production driver path and SQL
semantics; it is not a test of the hosted Neon service.

Reports are `vitest.log`, `vitest.json`, `summary.json`, and
`migration-reconciliation.json` (migration names, preserved table/row counts and
SHA-256 digests). They contain no database credentials.

## Verification

Final baseline: **56 Vitest files, 702 tests passed, zero skipped**, with all
23 integration suites enabled in isolated databases. All five Python import
regressions passed. TypeScript, changed-source ESLint, whitespace checks and
Drizzle migration drift checks passed. The original author-picker changes
matched their saved hashes. The runner confirmed container removal.

```sh
pnpm test:local
pnpm test:local book-domain-isolation work-kind-migration neon-batch-contract
pnpm typecheck
```

The existing production-build issue remains tracked by SLN-283 and blocks the
release rehearsal SLN-382: prerendering currently requires an application
DATABASE_URL. This task does not claim a complete production build or change
domain readiness. No production database, external provider or S3 was used.
