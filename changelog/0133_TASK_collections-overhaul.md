# Task 0133: Collections creation and management

**Status**: Completed
**Created**: 2026-09-26
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0130, 0132
**Blocks**: None

## Overview

SLN-291: Create a collection with just a name, add books directly or in bulk, and browse and manage its editions. Artwork is optional and can be added later.

## Implementation Details

- Name-first creation opens the new collection's add-books picker. Existing cards link to a detail page; search, pagination, automatic member-cover previews, description editing, rename and confirmed deletion are supported.
- Book headers, edition actions, library card menus and the bulk toolbar share a searchable create-and-add/membership dialog. Exact existing collection names are reused. Multiple editions are explicit; editionless works are explained without inventing edition records.
- Collections retain the existing edition junction model. No schema changes or migrations. Membership operations and actual-change activity events commit atomically, deduplicate IDs, and serialize on the collection row. Client request IDs make create retries idempotent.
- Add-books searches title, author and ISBN, retaining selections across searches. Detail pages support removing and moving editions within the complete collection, including across pagination boundaries.
- Collection deletion preserves works, editions and instances. Artwork cleanup is constrained to that collection's own namespaces and protects keys referenced elsewhere. Partial storage failures are reported. There is no durable cleanup retry queue; broader deletion infrastructure remains SLN-282.
- Dialog Escape respects pending-save guards. Existing image adjustment controls and author processing defaults are preserved.

## Completion Notes

- Full suite: 389 passed, 55 skipped (unconfigured unrelated integration suites); includes 13 local PostgreSQL collection tests and 5 mocked storage cleanup tests, plus the concurrent SLN-321 tests.
- Mandatory `pnpm typecheck`, ESLint, `git diff --check`, and production webpack compilation passed.
- Browser checks used synthetic data in disposable localhost PostgreSQL, with synthetic artwork and disabled external storage cleanup: name-only creation, picker selections, ordering, rename, remove, optional artwork dialog, inline create/reuse, mixed memberships, selecting one edition, bulk add including editionless works, Escape, automatic cover previews, and collection deletion preserving all books.
- No live database writes, test fixtures, migrations, restores or image uploads were used. Temporary preview adapters were restored before final validation. Actual S3 artwork upload/deletion was not exercised against live storage.
