# Task 0463: Series show the catalogue status, and count Accessioned volumes

**Status**: Completed
**Created**: 2026-10-13
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

A series page replaced a volume's catalogue status with an "Owned" badge
whenever it had a copy, so an On Order volume with a copy read "Owned", and
the header counted "4 of 6 owned" from copies, checking only each volume's
first edition. Owned is not a catalogue status (SLN-635). Each volume now
shows its own status (Accessioned, On Order, Wanted and the rest), and the
series page and the series list both count "N of M accessioned" by catalogue
status, each volume once.

## Implementation Details

- `src/components/series/series-books.tsx`: the row badge is always the
  volume's `STATUS_CONFIG` label in its own colour.
- `src/app/(catalogue)/series/[id]/page.tsx`: the header counts volumes whose
  `catalogue_status` is `accessioned`; nothing there reads copies any more.
- `src/lib/actions/series.ts`: `getSeriesList` returns `accessionedCount`
  (same predicate) in place of the copy-based `ownedCount`; `getSeriesDetail`
  no longer loads the first edition's copies.
- `src/components/series/series-card.tsx`: "N accessioned".
- The series row did not fit a 390px phone: the badge and controls pushed
  the page 31px sideways ("Accessioned" is longer than "Owned", but the row
  overflowed before too), and the controls and title were under 44px on
  touch. Under `sm` the status and reading badges now sit on the author line
  and the read, move and remove controls on a row of their own; from `sm` up
  they stay beside the title, cap-aligned, at 44px on touch. Titles and
  authors wrap in full instead of clamping to one line. The position field is
  44px tall on touch.
- `src/components/reading/book-picker.tsx`: the reading book picker showed
  "Owned" over the status in the same way; it now shows the status. Its
  owned-first order is a holdings rule and stays.
- Left as they are on purpose: the publisher page's Owned count and filter,
  and the library's holding filter, are holdings (a copy that is not
  deaccessioned), not catalogue statuses.

## Completion Notes

- `browser-audit.mjs` on `/series`, a six-volume series (one long title,
  one On Order volume with a copy) and `/reading` in Chromium, Firefox and
  WebKit at 1440, 768 and 390: 27 of 27 page loads passed (before the row
  change, 3 failed at 390 on overflow and touch size).

- `src/__tests__/integration/series.test.ts`: five Accessioned volumes (one
  with no copy, one with copies in two editions) and one On Order volume with
  a copy in its second edition give 5 accessioned in the list and the same 5
  from the detail, with every status kept.
