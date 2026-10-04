# Task 0290: Duplicate names and numbers get the app's message

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Noted during SLN-303: a rename to a name that already exists showed the
database's "duplicate key value violates unique constraint" text instead of
the app's message. Every create and rename path that a unique constraint can
refuse now returns the app's own message.

## Implementation Details

The paths, from every unique constraint in the migrations:

- Taxonomy item rename (`updateTaxonomyItem`): the system families keep
  `name` unique (keywords, tags, subjects, genres and the others). The rename
  now goes through `withReadableErrors` with the create's message, "This
  family already has an item with this name". The create, the custom
  families and the family names already did.
- Edition ISBNs (`editions_isbn_13_unique`, `editions_isbn_10_unique`):
  `src/lib/catalogue/isbn-clash.ts` checks both numbers before the write and
  names the book that holds one (`isbnClash`), and turns a constraint
  refusal from a racing save into the same message (`isbnTaken`). Used by
  `createEdition`, `updateEdition` (which had no check: an edit to another
  edition's ISBN showed the raw error), the wizard and Fast Track. The add
  dialog and the wizard checked only the ISBN-13 before.
- Recommenders (`recommenders_name_unique`): the check before the write
  stays; a racing save now gets the same `"Name" already exists` result.
- Slugs of authors and series (`authors_slug_unique`,
  `series_slug_unique`): chosen just before the write, so only a save of the
  same name at the same moment can clash. That save now gets "Another save
  took this name's address at the same moment. Save again."
- `uniqueConstraint(error)` in `src/lib/db/errors.ts` names the constraint
  behind an ORM-wrapped error.

Not changed: organization, publisher and venue slugs end in their id, and
work slugs and new people already retry on a clash.

## Completion Notes

- Tests: `src/__tests__/integration/duplicate-names.test.ts` (DB suite,
  `DURTAL_DUPLICATE_NAMES_TEST_DATABASE_URL`, `/sln303_duplicate_names`) and
  `src/__tests__/db/unique-errors.test.ts`.
- No UI change: the dialogs and toasts already show the action's message.
