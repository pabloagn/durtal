# Task 0412: Readable, responsive catalogue cards

**Status**: Completed
**Created**: 2026-10-08
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0411
**Blocks**: None

## Overview

SLN-558 fixes cramped related-book and collection cards. Fixed 160px shelves and a favourite column squeezed titles and authors into fragments. Card names and identifying metadata now remain visible as the available space changes.

## Implementation Details

- Grids treat the density preference as a maximum, with a 208px readable minimum or the available width when narrower. Related shelves use container-relative 208–256px cards.
- Shared headings wrap naturally, without title/author clamps. Favourites occupy only the first title line; metadata uses the full card width and follows the title immediately. Descriptions can increase card height.
- Flexible card bodies align row footers while preserving natural text height. Related captions wrap outside their card without overflowing the shelf. Publisher, recommender, place, collection-member, taxonomy and reading cards follow the same readability rules.
- Labels, badges and metadata wrap when needed. Location controls retain first-line alignment, card website links have full touch targets, and publisher header actions wrap on narrow screens.
- Cover-size estimates and their existing tests reflect the new breakpoints. Design guidance replaces the old fixed-line requirement. No dependency, schema or live-data changes.

## Completion Notes

- Full local suite: 3,275 tests pass, zero skipped, with 93 isolated database suites and all three Python suites.
- Typecheck, production build and Docker build pass. Lint: zero errors and the existing 75 warnings.
- 255 unique route/viewport combinations verified across headless Chrome, WebKit and Firefox at 1440×900, 768×640, 390×844, 320×568 and 844×390. Measured alignment, contrast, overflow, touch targets and text clipping pass, including targeted rechecks of corrected locations, recommenders and publishers.
- Long-text stress checks pass in all three browsers at 180/208/256/400px card widths. Titles, multiple creator names and collection descriptions remain inside their card as height grows.
- Related-book and collection favourites toggle without navigating; artwork edit dialogs still open and close. Checks use disposable fixtures only.
- Page-weight checks pass for every populated route; four optional routes lack fixture records. Library HTML is 101KB against its 300KB budget.
