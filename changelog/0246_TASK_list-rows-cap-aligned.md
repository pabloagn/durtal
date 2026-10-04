# Task 0246: List rows keep their buttons and marks on the title line

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0235 (this branch is stacked on it)
**Blocks**: None

## Overview
Found while measuring SLN-416. In the list view of `/library` and `/authors`, every row's marks, status, copy button and actions menu were centered on the whole two-line row (title over author), so they sat about 15px below the title's cap-height center. The old audit already reported 53 such rows on `/library`; the new one reports 101 there and 96 on `/authors`. The copy count ("0 copies") also wrapped onto two lines in a 56px column.

Now a list row is two clean lines beside its thumbnail. The first line holds the title, then the marks, the priority, the status and the rating, then the copy button or actions menu, all on the title's cap height. The second line holds the author (or nationality), then the year and the copies (or books), on its baseline. In selection mode the checkbox sits on the thumbnail, like on the grid cards, instead of a column of its own.

## Implementation Details
- `src/components/books/book-list.tsx`: the row is `items-start`; the link holds the thumbnail and the two lines; the first line's trailing items go in `CapAlignedControls` (20px), the copy button in its own `CapAlignedControls` (28px, title type) beside the link. New `RowCheckbox` draws the selection mark on the thumbnail. The copy count is 64px wide and never wraps.
- `src/components/authors/author-list-item.tsx`: the same two lines (name and years; nationality and the book count) and `RowCheckbox`; the actions menu on the name's cap height.

## Completion Notes
On `scripts/qa/preview-local.py` (2026-10-03 backup), headless Chrome, 1440x900, with the new audit from #26:

| List view | Before (live app) | After |
|---|---|---|
| `/library`, 48 rows | 101 rows over 0.5px; "0 copies" wrapped | 0 (84 checked); rows 72.88px each |
| `/authors`, 48 rows | 96 rows over 0.5px | 0 (46 checked); rows 68.88px each |
| `/authors` in selection mode | | 0 |

- `scripts/qa/design-audit.js`: 0 low-contrast texts on both. The selection bar's close icon on `/library` is fixed in #26.
- `pnpm typecheck`, `pnpm lint` and `python3 scripts/qa/test-local.py`: see the PR.
