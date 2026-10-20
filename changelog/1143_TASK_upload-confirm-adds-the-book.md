# Task 1143: Upload Confirm adds the book

**Status**: Completed
**Created**: 2026-10-20
**Priority**: HIGH
**Type**: Fix
**Depends On**: 1141
**Blocks**: None

## Overview

Confirming a checked e-book upload always failed with "The upload response is uncertain. Retry the same request." The file was checked and stored in S3, but it never reached the library.

## Implementation Details

`src/lib/ebooks/upload-core/effect-store.ts` checks the book row and the match candidates after the write. Three of those checks passed a JavaScript array straight into SQL as `${array}::text[]`. Drizzle sends a raw array as a row expression, so PostgreSQL refused the statement with "cannot cast type record to text[]". The whole write rolled back, and the upload service answered 503.

The checks now build the arrays with `textArraySql` (`src/lib/db/sql-arrays.ts`), as the rest of the upload code does.

## Completion Notes

Before: Confirm on the live app failed every time, with the service error "cannot cast type record to text[]". After: Confirm on an uploaded EPUB (`epub2.epub` from the test fixtures, "The Narrow House") answered 200 "Upload registered", and the book shows on `/ebooks`. The upload database suites pass (`pnpm test:local ebook-upload upload-job upload-run`, 49 tests).
