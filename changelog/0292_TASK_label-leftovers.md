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

### Review fixes

- Language names come from fixed tables, never from the runtime's `Intl`: the language list's labels, then `LANGUAGE_NAMES` (`src/lib/constants/language-names.ts`, 228 English names generated once from Node's `Intl`), then the code. Chrome's `Intl` has no name for `grc` or `ota`, Node's has, so the server rendered "Ancient Greek" and the browser hydrated to "grc". A test runs `languageName` with `Intl.DisplayNames` giving no names and expects the same results.
- On a book card the language badge shrinks first and cuts off its name (`min-w-0 shrink-[999]`, the name in a `truncate` span); the status never does. "Norwegian Bokmål" had cut "Wanted" to "Wa…".
- Browser check in Chrome, Firefox 157 and Safari, on a disposable copy where the first three books of the title-sorted list were given `grc`, `ota` and `nb` (the `nb` one Wanted):
  - each book page shows "Ancient Greek", "Ottoman Turkish" and "Norwegian Bokmål" after hydration, and no page shows a bare code;
  - the library grid at 3 and 4 columns, at 1440, 1024, 768 and 390px: the status ("Accessioned", "Wanted") is never cut and no card row overflows; the language name shows whole on a 327px card and cuts off on narrower ones; at 6 columns (the default) and at 390px the card is too narrow for the badge, as before.
- `pnpm typecheck` clean, `pnpm lint` 0 errors, `pnpm test` and the full suite pass. Page weight: `/library` 313 of 300 KB, as on main (SLN-381).
