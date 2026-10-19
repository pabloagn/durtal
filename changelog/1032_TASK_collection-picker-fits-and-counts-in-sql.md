# Task 1032: The collection picker fits a phone, sees whole books, and counts in SQL

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1058, from findings/collections-survey-2026-10-18.md (items 1, 4 and 12), findings/server-waste-survey-2026-10-18.md (item 4) and findings/regression-sweep-2026-10-18.md. The book page's collection picker was wider than a phone, showed a book held as a whole book as not in the collection (ticking it added an edition beside it), and cut long names with an ellipsis. Every list of collections loaded each membership row only to count it, and in Firefox the focus could drop to the page after Create & add.

## Implementation Details

- `src/lib/collections/counts.ts`: a `MemberTally` (editions, books held through them, whole books, films, perfumes, paintings) is what every count reads. `memberTally` takes a tally counted in SQL or works it out from member rows as before, so `collectionCounts`, `collectionCountLine` and `collectionMembersNoun` accept either.
- `src/lib/actions/collections.ts`:
  - `collectionTallySql()` counts a collection's members in one correlated subquery, a book with an edition there counting through its editions. The outer `"collections"."id"` is written in full: drizzle writes a lone table's columns bare, and a bare `id` would bind to the members' tables.
  - `getCollections` and `getCollectionsForWork` load the active artwork and the tally, not `memberSummary` (removed), and return `editionCount`, `workCount` and `countLine`.
  - `getCollectionSelection` (the picker) loads each collection's id, name, icon and tally, and only the memberships of what was chosen: `editionIds` (chosen editions held) and `workIds` (chosen works, and the chosen editions' books, held whole). Still one wave.
  - `getCollectionTally(id)` reads one collection's counts again after the picker changes it, so the row's count line stays right without the member rows.
- `add-to-collection-dialog.tsx`:
  - A chosen edition counts as in when its book is held whole. Unticking also removes the whole-book membership; ticking skips editions whose book is held whole, so no second membership is made.
  - Names wrap in full (`[overflow-wrap:anywhere]`). The box and icon sit on the name's first line (24px slots), and the count's first line on the same centre.
- `src/hooks/use-focus-through-busy.ts`: a focused control that is now disabled counts as lost focus. WebKit could keep the focus on Create & add (disabled once its name is cleared) past the end of the add and drop it to the page afterwards.

## Completion Notes

- **Width.** The picker uses the dialogs' own width rule (full width below its 512px cap, 24px inner padding), the same as every other dialog. At 390 and 320 in Chromium, Firefox and WebKit, with a long name, a long single word and a mixed count line, Create & add, the counts and Done are in view and nothing scrolls sideways.
- **Whole books.** On Against Nature with Decadents holding it whole: ticked; unticking removes the whole-book membership; ticking adds the editions; reopening with it whole shows it ticked. Three browsers.
- **Focus.** After Create & add, by click and by Enter, the focus stays in the field in all three browsers (WebKit by click had dropped it in 4 of 18 runs; 0 of 10 after the hook change).
- **Timing** (production build, 50 collections of 100 members each, Chromium at 1440, each database request held as given, median of 5 after two warm-ups, from the click to 50 rows shown):

  | Held per request | Main | This change |
  | --- | --- | --- |
  | 0 ms | 387 ms | 270 ms |
  | 40 ms | 457 ms | 381 ms |
  | 200 ms | 552 ms | 491 ms |

  The picker's response went from 392 KB to 12 KB.
- **Tests.** Database: the selection carries only the chosen memberships and the tally, the SQL tally equals the row count for a book collected both ways, and the picker sees a whole book from the book and from one of its editions. UI: a whole book reads ticked, unticking removes it, and ticking never adds an edition beside it; the focus hook moves on from a disabled control (fails without the change).
- Alignment, design, overflow, layout and touch audits clean on the book page with the picker open, /collections, a collection page and the dashboard at 1440, 390 and 320. Page weight passes.
