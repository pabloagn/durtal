# Task 0550: Decorative marks are marked

**Status**: Completed
**Created**: 2026-10-14
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-641 design contract, piece 10. Slice 1 found two kinds of decorative mark that the design audit counted as interface icons over 16px: the 24px mark on about 13 list pages' empty states, and the 40px mark on an empty `/provenance`. docs/03 allows a decorative mark to be larger, but the audit could not tell one from an interface icon. Slice 1's third case, the people page's placeholder initial, has been marked since.

## Implementation Details

- **`data-decorative`** (and `aria-hidden`) on:
  - the `EmptyState` mark (`src/components/ui/empty-state.tsx`), which every list page's empty state uses;
  - the empty `/provenance` package;
  - a collection's folder placeholder when it has no poster;
  - the Upload marks on the two import pages. In the reading import, the icon was already `aria-hidden`.
- **`scripts/qa/design-audit.js`**: an icon inside `data-decorative` is not counted in `iconSizes` or `iconStrokes`. Contrast already skipped decorative text.

## Completion Notes

I ran the design audit on an empty preview in Chromium at 1440 and 390, with main's audit and with this branch's. The pages: /series, /places, /reading/journal, /reading/notes, /reading/next, /locations, /films, /library, /perfumes, /recommenders, /publishers, /paintings, /organizations, /collections, /people, /provenance, /ebooks/highlights, /library/import and /reading/import.

- **Icons**: the only change is that the 24px empty-state marks and the 40px provenance mark, with its 1px stroke, are no longer counted. Every other icon count is unchanged.
- **Contrast**: none before or after.
- **Browser runner**: 42 of 42 page loads pass on seven of these pages in 3 browsers at 1440 and 390.
- **UI tests**: 81 files, 496 tests.
- **From review.** The decorative skip could hide a real oversized icon in a control inside a marked box. The audit still skips the empty-state and placeholder marks, but it now counts the icon of a control inside a decorative box. A placeholder mark inside a card's link is still skipped. `src/__tests__/ui/design-audit-decorative.test.ts` covers all three cases.
