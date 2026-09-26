# Task 0128: Restore ISBNdb text and author search

**Status**: Completed
**Created**: 2026-09-26
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-314: ISBNdb returns title and author matches under `books`, while Durtal read only `data`, silently dropping every match. The user's refreshed credential already restored ISBN lookup independently of this fix.

## Implementation Details

- Read `books` with legacy `data` fallback in both text and author adapters. Preserve the separate `book` contract for ISBN lookup.
- Retain `/books/{query}?column=author`: checked live and confirmed to return full book objects. Changing to the suggested exact-author endpoint is unnecessary for the parsing fix and would change matching behavior.
- Report HTTP failures from ISBNdb, Google Books, and Open Library. Search orchestration reports thrown request/JSON/configuration failures by provider while retaining fallback results.
- Diagnostics contain only fixed provider names and status codes; never request URLs, search text, keys, response bodies, or exception messages.
- Preserve search ranking, deduplication, query classification, timeouts, and cache policy.
- No database migration, environment change, or dependency added.

## Completion Notes

- 20 new provider and orchestration regression tests pass, covering current/legacy response shapes, ISBN lookup, author filter, quota/auth errors, missing credentials, malformed JSON, failed requests, and fallback/deduplication behavior.
- Full default suite: 308 tests pass; 43 opt-in database tests skipped. No database code changed.
- `pnpm typecheck`, full application lint, explicit new-test lint, and `git diff --check` pass.
- Isolated preview verified through real API calls and the Add Book browser flow: `Lanark Alasdair Gray` returns Canongate ISBNdb editions; `Alasdair Gray` returns ISBNdb matches; `0749386576` retains the Minerva ISBNdb edition.
- Google Books remains unconfigured locally and returned HTTP 429 during verification. This external configuration limitation is recorded in Linear SLN-309; the app now logs the failure rather than silently concealing it.
