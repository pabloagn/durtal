# Task 0292: Readable Labels, the Last Raw Values (SLN-400)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-400 merged this morning (#35). A scan of main found no snake_case key or raw enum value on the book, author, publisher, place, perfume, film and painting pages, nor in empty searches. Four places still printed a stored value as text; this task gives them their label.

## Implementation Details

- Language names in their short form (`languageName`, `src/lib/utils/language.ts`) instead of the code:
  - the dashboard's wanted-book cards (`src/app/page.tsx`): "es" became "Spanish";
  - every book card's language badge (`src/components/books/book-card.tsx`);
  - the language column of the book table (`src/components/books/book-data-table.tsx`).
- The add-book wizard's review step (`src/app/library/new/wizard.tsx`): the catalogue status ("accessioned"), the priority ("high priority") and each copy's format and condition ("very good" from `very_good`) through `catalogueStatusLabel`, `priorityLabel` and `enumLabel` (`src/lib/utils/labels.ts`).
- The series list's status badge already shows the status config's label; unchanged.

## Completion Notes

- Scan of main before the change (headless Chrome, disposable restore with one perfume, film and painting): the pages above show no snake_case key or bare enum value. The scan's only language code was "es" on the dashboard; the book card and table carry the same code in their source.
- After: on `/` at 1440 and 390 px the wanted cards show "Spanish", not clipped, and the card row does not overflow.
- `alignment-audit.js` and `design-audit.js` on `/`, `/library`, `/library?q=de` and `/library/new` at 1440, 768 and 390 px: 0 deviations, 0 unnamed or nested controls, no overflow, no console errors. The only low-contrast text is the faint initial on a book card without a cover, unchanged from main.
- Not seen in the browser: a book card or table row with a non-English book (none on the pages checked), and the wizard's review step, which needs a whole entry; they use the same label functions.
- `node scripts/qa/page-weight.js`: `/` 290 KB, `/library` 313 of 300 KB as on main.
- `pnpm typecheck`, `pnpm lint` (0 errors), `python3 scripts/qa/test-local.py` (1,611 tests in 130 files, 0 skipped): pass.
- SLN-402 (empty lists) needs nothing more: on main, `/reader` with no books shows only its empty state, and an empty search on `/library`, `/authors`, `/publishers`, `/places`, `/perfumes`, `/films`, `/paintings` and `/series` shows "No results" with Clear and no pagination.
