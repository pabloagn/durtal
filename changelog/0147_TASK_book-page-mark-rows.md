# Task 0147: Book page rows for marks ("Other Rarities", "Other Anathemas")

**Status**: Completed
**Created**: 2026-09-27
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0146
**Blocks**: None

## Overview

SLN-338: like the collection rows, a book page shows one row of other books for each mark the book has. Each row takes its title from the mark's own vocabulary: "Other Rarities", "Other Anathemas".

## Implementation Details

- `src/lib/constants/marks.ts` is the one vocabulary for marks. Each mark defines `field`, `label` (Rare, Anathema), `noun` (Rarity, Anathema), `plural` (Rarities, Anathemas), `markAction`, `unmarkAction` and `hint`. `otherMarkedTitle()` builds the row title; `marksOf()` lists a work's marks. `src/lib/constants/poison.ts` is gone: badges, toggles, the bulk menu (now built from the registry) and the activity text all read the vocabulary.
- `getWorksWithMark(mark, excludeWorkId, limit)` in `src/lib/actions/works.ts`: other works with the mark, newest first, with the shared card data. `markColumn()` maps a mark to its column.
- `/library/[slug]`: after the collection rows, one `WorkCarousel` per mark the book has, hidden when no other book has it. The title links to `/library?mark=…`.
- Book page header: the gem and skull toggles form one group; every icon sits 12px from its neighbour.

## Completion Notes

- `marks.test.ts` covers the vocabulary, row titles, `marksOf` and URL parsing; `poison.test.ts` covers `getWorksWithMark` (order, limit, exclusion, card data, bad input).
- Browser check on a local copy of live data: a book marked Rare and Anathema shows "Other Rarities" (12 books) and "Other Anathemas" (2 books), each linking to its filter. Header spacing measured: year to gem 12px, gem to skull 12px, one center line.
