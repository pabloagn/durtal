# Task 0610: A person and an eBook show their loading screens

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

From the loading, empty and error states audit of 15 October
(`findings/audit-loading-2026-10-15.md`, findings 1 and 3). The person page
had no loading screen, so a click on a person kept the last page, with no
sign the click registered, until theirs arrived. At 400 ms a database query,
a click on a book's author stayed on the book for 2.1 s, in every browser and
at every width. The eBook page was the same, for shorter.

## Implementation Details

- **`src/app/(catalogue)/people/[slug]/loading.tsx`** draws the person page's
  own layout:
  - the way back, the portrait's 192 by 256 box;
  - the name's row with the favourite, Edit and menu (`SkeletonTitleRow
    row="wide"`, as the page's `DetailTitleRow controls="wide"`);
  - the country and life dates line;
  - then the record and the first books, in the page's `catalogue-grid`.
- **`src/app/(catalogue)/ebooks/[ebookId]/loading.tsx`** draws the eBook page's:
  - the way back to eBooks;
  - the title and the line under it, with Read (under the title on a phone,
    where nearly every title takes the row);
  - then the cover and its author.

A linked eBook always has the line under its title ("The eBook of this
book."). An eBook with no book and no subtitle has none, and its page then
starts 34 px higher than the loading screen.

## Completion Notes

- The checks used a production preview with the database slowed per query,
  and a link prefetched as the app's links are.
  - A click on a book's author shows "Loading the person" within 190 ms in
    Chromium and WebKit; before, it showed nothing for 2.1 s.
  - Each block was measured against the page that replaced it, in Chromium,
    Firefox and WebKit:
    - The person at 1440 and a linked eBook at 1440, 390 and 320: the title,
      the cover, Read and the page body sit at 0.0 px.
    - A name or title that takes two lines moves what is below it, as on
      every record's loading screen (SLN-698).
- `src/__tests__/ui/loading-audit-states.test.ts`: both loading screens say
  what is loading, with their way back.
