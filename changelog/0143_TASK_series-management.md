# Task 0143: Series that show their books, and can be managed

**Status**: Completed
**Created**: 2026-09-27
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0141
**Blocks**: None

## Overview

SLN-331: Almost no series showed its books, and series could not be edited. 148 series existed but only 1 work had `works.series_id`. The series came from the old knowledge-base spreadsheet (`Book_Series`); the import never linked the books. Many rows were pairs of separate books ("The Trial and The Castle"), not series.

## Implementation Details

- Server (`src/lib/actions/series.ts`): list with the shared search engine (title and original title), sort Title/Books/Recent, counts (books, owned) and up to four member covers; detail in numeric reading order ("2" before "10", "2.5" between, blanks last); create (unique slug), update, delete (books stay, lose only series and position); add books (next whole position, a book in another series moves, members ignored), remove, set position (validated: 1, 2, 2.5), move up/down (swaps positions, numbering the series first if any position is blank); work picker search by title or author.
- Suggestions: books whose titles match the series title or its parts ("A and B", "A, B, and C", "Trilogy: A, B"), ignoring accents, in the order the series title names them, flagging books already in another series. Nothing is linked until the user confirms (Link, or Link all).
- `/series`: shared toolbar (search as you type, Best match/Title/Books/Recent, grid/list, size), cover-strip cards, Add Series, and a link to suggested books when there are any.
- `/series/[id]`: header (titles, "N books of M", owned, complete), Add books, Edit and Delete menu, ordered books with editable positions, move up/down and remove, and suggested books for that series.
- `/series/suggestions`: every suggestion grouped by series.
- The book edit dialogs keep their series and position fields; both sides write the same columns.

## Data cleanup (live, approved by the user)

- Backed up the `series` table, then deleted the 66 pair-style rows (two or more separate books joined by "and" or commas, plus two rows that were one book under two titles). None held books; the deletion ran in one transaction that refused any row with books or any unknown title. 82 series remain. Kept on purpose: real series whose names contain "and" ("Joseph and His Brothers"), the Beckett "Trilogy: Molloy, …", the Confucian Four Books, and titles that are single books.

## Completion Notes

- PostgreSQL tests: create/edit/delete with books kept, adding and moving between series, numeric order, position validation, move with blank positions, suggestions (accents, parts, title order, other-series flag), list counts and covers, picker search by author. Full suite with every database suite: 529 passed. Typecheck, lint, production compile pass.
- Browser check on a throwaway database: list and cards, series page, adding by author search (with a typo), editing a position, moving up, Link all from the suggestions page, editing volumes and completion.
