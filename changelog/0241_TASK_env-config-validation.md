# Task 0241: Environment Config Validation (SLN-309)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Infrastructure
**Depends On**: None
**Blocks**: None

## Overview
The documented environment did not match what the code reads. A missing
variable failed late, at the first request that needed it. ISBNdb was read
from a misspelled key, `ISBNDN_API_KEY`.

## Implementation Details
- `src/lib/env.ts` declares every variable the app reads. `serverEnv()`
  validates the server variables with zod and throws one error that lists
  every problem. It parses on each call, so tests can stub a variable per case.
- `src/instrumentation.ts` calls `serverEnv()` when the Node server starts, so
  a missing `DATABASE_URL` or AWS key stops the server with a clear message.
  `next build` does not validate, so a build needs no secrets.
- `S3_BUCKET` stays a module-level constant (it has a default, so it never
  throws at load). The S3 client reads region and keys through provider
  functions, so nothing validates at import time.
- `NEXT_PUBLIC_MAPBOX_TOKEN` is exported as `publicEnv`, read with a literal
  `process.env.NEXT_PUBLIC_*` so Next.js still inlines it.
- `ISBNDB_API_KEY` is the new name. `ISBNDN_API_KEY` is still accepted, with
  one warning, for one release. `docker-compose.yml` passes both.
- Code now reads env through the module: db, S3 client and covers, Google
  Books, ISBNdb, match sources, Google Places routes, REST token check, the
  settings integrations checks and the authors map.
- `vitest.config.ts` sets placeholders for the required variables. The
  database placeholder uses a host that never resolves.
- `scripts/qa/preview-local.py` passes placeholder AWS keys, so the local
  preview starts without credentials. They are no credential: an S3 call is
  refused.
- `.env.example` and `docs/13_CONFIGURATION.md` now list every variable the
  code reads, and none it does not. Removed: `CALIBRE_WEB_URL`,
  `NEXT_PUBLIC_APP_URL`, `INGEST_PARQUET_PATH`.

## Completion Notes
- Left out on purpose, because other issues own them: the admin routes still
  skip the token check when `ADMIN_TOKEN` is unset (SLN-423), and the Google
  Places and Books keys and their error messages (SLN-424, SLN-425).
- Still direct `process.env` reads, by design: `NODE_ENV`, `NEXT_RUNTIME`,
  `NEXT_PHASE`, the presence checks on the settings integrations and about
  pages (they show whether a variable is set), the three admin routes, and
  the integration tests' own `DURTAL_*_TEST_DATABASE_URL` variables.
