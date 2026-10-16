# Task 0670: A name that is one long word no longer pushes a page sideways on a phone

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-846, from `findings/long-word-survey-2026-10-15.md`. With a name that is one 50-letter word, seven pages scrolled sideways on a phone, 35 to 190px, in Chromium, Firefox and WebKit: a book, a person, a publishing house, a series, a museum and Locations. Six spots could not break such a word, three of them shared.

## Implementation Details

Each spot takes `[overflow-wrap:anywhere]`, as `CardHeading` and `DetailFacts` already do:

- `src/components/shared/detail-layout.tsx`: `RecordField`'s `dd`, the side facts of every record (a book's series, a person's sort name, a house's founding place).
- `src/components/shared/facts-row.tsx`: `FactsRow`, the facts line under a header ("Founded in ..."), and every other caller. It keeps the `small` size #399 added for list rows; `WorkRow` already passed the same class and is unchanged.
- `library/[slug]/edition-detail-card.tsx` and `places/[slug]/page.tsx`: the tag rows. The class on the row lets a `Badge` shrink and break inside; `Badge` is unchanged.
- `series/[id]/page.tsx`: the authors line under a series' title.
- `places/[slug]/page.tsx`: a museum's place line with the pin.
- `locations/location-card.tsx`: a shelf's address link.

Normal names do not change: the class only lets a word break when it cannot fit on a line by itself.

## Completion Notes

- **Test:** `ui/long-words-wrap.test.ts` renders `RecordField` and `FactsRow` and checks the class, and checks each page spot's line carries it.
- **Browser checks** on the seeded production preview, with a 50-letter one-word series title, author, author sort name, edition tag, place (a house's founding place, a museum's place), museum tag and shelf city. Sideways scroll, in Chromium, Firefox and WebKit at 390 and 320 (touch except in Firefox):
  - a book, a person, a publishing house, a series, a museum and Locations: 0px with this change on every page;
  - with the class turned off on the page, the same pages scroll 23 to 169px.
- **Audits:** the alignment and design audits found nothing on those six pages at 1440 and 390, in all three engines.
- **Page weight:** every route is within budget.
- `pnpm typecheck` is clean.
- **Rebuilt on main after #399 and #417 landed** and checked again: none of the six pages scrolls sideways in any engine at 390 or 320, and the audits found nothing on them or on the Films list.
