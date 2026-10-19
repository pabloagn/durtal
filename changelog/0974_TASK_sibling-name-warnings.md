# Task 0974: A repeated sibling name says so and saves anyway only when asked

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0886, 0973
**Blocks**: None

## Overview

SLN-1159. Categories, Themes, Literary movements and custom families keep no name index, so "Novel" could be added a second time under Fiction, and a rename in place gave three. SLN-1016 (0886) refused accented twins family-wide on create and rename only. Now a create, a rename or a move that repeats a sibling's name, exactly or apart from accents and case, names that sibling and offers to open it or save anyway, as other duplicate names do.

## Implementation Details

- `src/lib/actions/taxonomy-families.ts`: the twin check compares within the same parent (`parent_id is not distinct from`), so one name may sit under two different items. Create, rename and a parent change refuse a twin with `This family already has "Novel" under Fiction` (or "at the top level") unless `allowDuplicateName` is set; the create's lock-time re-check is skipped then. Where a family's table keeps each exact name once, an exact clash anywhere is returned with `saveAnyway: false` and is never saved. `findTaxonomyNameTwin(familySlug, name, { parentId, exceptId })` returns the sibling, its parent's name and `saveAnyway`.
- `src/lib/catalogue/taxonomy-storage.ts`: `uniqueNames(storage)` from the table's `name` column.
- `src/lib/validations/taxonomy-management.ts`: `allowDuplicateName` on create and update.
- `src/components/taxonomy/name-twin-notice.tsx`: the 300 ms lookup and the notice ("You can still use this name." or "Choose another name.", then Open Novel).
- Add to…, Edit item and Move to…: the notice under the name (under the parent for a move); the button becomes Create anyway, Save anyway or Move anyway, or stays off where the name cannot be saved.
- A rename in place that repeats a sibling's name opens Edit item with the typed name.
- No migration.

## Completion Notes

- Disposable PostgreSQL: in a custom family, Categories, Themes and Literary movements, create, rename and move beside "Novel" (exact and "NOVÉL") are refused with the sibling and parent named, then saved with `allowDuplicateName`; the same name under another parent and an item's own accented rename pass; Keywords refuses an exact repeat even when asked and saves an accented one.
