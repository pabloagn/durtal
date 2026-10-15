# Task 0638: The reader's error leads back to the eBook

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-818. When the reader failed, its error screen led back to the library,
far from the book being opened. It now leads to that eBook's own page.
Try again was already the primary action (#376) and opens the book anew.
The fallback screens' headings also no longer set one word to a line.

## Implementation Details

- `src/app/reader/error.tsx`: the way back reads the eBook from the address
  (`/reader/<id>`) and links to `/ebooks/<id>` as "Back to the eBook". When the
  address names no eBook (`/reader/offline`, a malformed id) it keeps "Back to
  library".
- `src/components/shared/route-fallback.tsx`: the heading's row sat in a
  centred column, where its `w-min` title took its narrowest width, so "This
  eBook could not be opened" was set in five lines at every width. The heading
  now has the column's width, up to 576px. The reader's error and not-found
  screens, the app's global not-found and global error use it.

## Completion Notes

- With the preview's database paused, so the reader fails: Chromium, WebKit
  and Firefox at 1440, 390 and 320 show Try again as the primary button and
  "Back to the eBook" to `/ebooks/<id>`; the heading takes one line at 1440 and
  two on a phone. 0 alignment, design-audit, overflow and touch findings.
- `/reader/<unknown id>` ("eBook not found") in the same engines and widths:
  heading on one line, 0 findings.
- `page-weight.js` within budget.
- `loading-audit-states.test.ts` covers the way back for `/reader/<id>`,
  `/reader/offline` and a malformed id.
- The reader's not-found still leads to the library; SLN-685 takes it to
  /ebooks.
- No migration and no new packages.
