# Task 0725: Two ghost buttons on the text edge, and four count slips

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Follow-ups the reviews of #362 and #364 found outside those PRs (SLN-792).

- Settings, Reader: "Show 50 more" under the lookup history, and the
  dictionaries' Cancel when it wraps under its status on a phone, started
  10 to 12px inside the text's edge (docs/03: a ghost button that starts a
  row under text pulls out by its own padding).
- The e-book library's header would read "1 eBooks"; the review-all dialog
  "Review these 1 eBooks" and "Skip 1 unavailable review rows".
- The e-book suggestion line printed "1200", where the count beside it
  reads "1,200".

## Implementation Details

- `lookup-history.tsx`: Show 50 more and Try again sit in one row pulled out
  by a md button's padding (`-ml-3`).
- `dictionaries.tsx`: the busy row stacks under 640, with Cancel pulled out
  (`-ml-2.5`); from 640 Cancel stays beside the status.
- `ebooks/page.tsx`: "1 eBook". `review-all-dialog.tsx`: "Review this
  eBook", "Skip 1 unavailable review row". `ebook-suggestion-line.tsx`:
  grouped thousands.
- Tests: `src/__tests__/ui/ghost-pull-out-and-plurals.test.ts`;
  `review-all.test.ts` follows the new label.

## Completion Notes

- Headless Chromium, Firefox and WebKit at 1440, 390 and 320 (touch at 390
  and 320) on a production preview, with 25 lookups seeded in the browser
  and the dictionaries' first load held open:
  - Show 50 more's icon starts on the entries' text edge (x 525 at 1440,
    522 in WebKit; 37 at 390 and 320).
  - Cancel's icon starts on the status's edge at 390 and 320; at 1440 it
    sits beside it. WebKit has no private file storage here, so it shows the
    "needs a secure address" line and no Cancel.
- Alignment, overflow, layout, touch and design audits are clean on
  /settings/reader, /ebooks and a person in all nine runs.
- Page weight passes every route. Typecheck clean, lint no new warnings. No
  migration, no new package.
