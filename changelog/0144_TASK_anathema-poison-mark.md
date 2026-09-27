# Task 0144: Anathema mark (poison) with a skull icon

**Status**: Completed
**Created**: 2026-09-27
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0123, 0124
**Blocks**: None

## Overview

SLN-335: a personal mark for works that are dangerous to recommend because they are explicit and transgressive. It works like the rare mark: a skull shows on the book wherever the rare gem shows. The UI calls it "Anathema". The code and database call it `poison`.

## Implementation Details

- Migration `0030_poison_flag`: `works.is_poison boolean not null default false`. No date, unlike rarity: the activity log records when a book was marked.
- `src/lib/constants/poison.ts`: the UI name and its menu strings. A rename changes one line.
- `src/lib/actions/poison.ts`: `setPoison(workId, isPoison)` and `bulkSetPoison(workIds, isPoison)`. Both write only books that change and record `work.poison_changed` for each.
- `PoisonToggle` (book page, beside the gem): one click marks or unmarks.
- `PoisonBadge`: the skull in `accent-red`, with the gem's cover badge style. It shows on grid covers, list rows, table rows, and every book card (dashboard, author, taxonomy, recommender pages, "More by …" and collection rows). Those cards now also show the rare gem.
- Library filter group "Anathema": "Only anathema" or "Hide anathema" (`poison=true` / `poison=false`). It applies to the list, its count and the timeline.
- Bulk toolbar: "Anathema" menu with "Mark as anathema" and "Unmark anathema".
- Activity: "Marked as Anathema" or "Removed the Anathema mark", with a skull icon.

## Completion Notes

- PostgreSQL test `poison.test.ts` (`sln335_test`): toggle, no-op without activity, input checks, bulk counts, filters both ways. `book-links-migration.test.ts` now matches the known work columns, because later migrations add columns.
- Full suite with all database suites: 546/546. Typecheck and lint pass.
- Browser check on a local copy of live data with `0030` applied: the skull toggle on Crash, the cover skull in the grid, both filter choices (1 and 500 of 501 books), the filter menu labels and the activity entry.
