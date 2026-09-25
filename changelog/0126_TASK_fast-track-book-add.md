# Task 0126: Fast Track book creation

**Status**: Completed
**Created**: 2026-09-25
**Priority**: HIGH
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview

Linear SLN-320. Add Fast Track immediately left of Edition details in the new-book Details footer. Save directly and open the book without visiting Edition, Instance, Categorize or Confirm. No database migration.

## Implementation Details

- Both save paths read the same Details and edition payload builders. Fast Track preserves title, author, original language/year, description, series, recommenders, status, priority, ISBN metadata and source. Existing defaults are retained.
- Dedicated validated server action atomically creates the author (if needed), work, author/recommender links, edition and activity events. Reuses the existing accent-insensitive author matcher. ISBN/slug uniqueness is also enforced by the database, including concurrent requests.
- Reuses the Neon HTTP batch helper from SLN-281; does not merge or change the rest of that pending issue or replace the full wizard's save sequence.
- Skipped copy, taxonomy and collection fields are excluded from the action schema. Returning from later steps cannot create an accidental copy or category assignment. Edition metadata already entered remains available.
- Blank title/author disable Fast Track. A synchronous in-flight guard prevents repeated clicks; the form and step navigation are locked until success or failure. Errors retain the draft. Existing-work edition additions remain in the established edition flow.
- Uses existing cover processing. On failed database writes, newly uploaded cover assets are cleaned up; unavailable downloads retain the source URL and report a warning after the book saves.
- Browser verification exposed a pre-existing concurrent first-render gallery insert failure. A targeted ON CONFLICT guard returns the existing layout instead of failing the newly created book page.

## Completion Notes

- 304 tests passed, including 16 disposable PostgreSQL Fast Track/gallery tests and 4 atomic helper tests. Nine unrelated opt-in rare-feature database tests were skipped.
- PostgreSQL cases cover all Details values, every offered catalogue status, default values, author reuse, duplicate ISBN, concurrent submissions, invalid data, deleted recommenders, late failure rollback and retry, cover handling, excluded skipped-step fields and concurrent gallery creation.
- Browser verified ISBN-to-Details-to-save using deterministic lookup results, manual entry, button position, changed fields, validation recovery, duplicate warning/rejection, no copies/categories after back-navigation, and successful book-page navigation.
- Full wizard browser regression saved one physical copy, subject and collection through Confirm.
- Browser preview used only local sln320_test and temporary DB/search adapters. Both adapters restored; no preview code or test data is shipped. No live test books were created.
- pnpm typecheck and scoped ESLint passed. Production webpack compile passed using compile-only build mode, without live database prerendering.
- Implemented in isolated codex/fast-track-book-add worktree. Publisher migrations 0025–0026 remain pending separate approval.
