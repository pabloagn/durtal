# Task 0339: Venue opening hours as days, never raw JSON

**Status**: Completed
**Created**: 2026-10-06
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-292's remainder. On main a venue can already be renamed, re-typed,
rated (the edit dialog), starred and deleted, and the venue type labels are
one constant. One criterion was still open: the venue page printed stored
opening hours with `JSON.stringify` in a `<pre>`.

## Implementation Details

- `src/lib/catalogue/opening-hours.ts`: `openingHoursRows(value)` turns
  stored hours into one row per day, Monday first. It reads Google Places'
  `regularOpeningHours` (or the object itself): the day lines
  (`weekdayDescriptions`) when present, else the periods ("9:00–13:00,
  14:30–18:00", "Closed", "Open 24 hours" for one period that never closes).
  Anything else gives null.
- `src/app/places/[slug]/page.tsx`: the Opening hours group lists the rows as
  record fields; with no readable hours it is left out.
- Docs 02 (`venues.opening_hours`) and 04 (Place Detail).

## Completion Notes

- Not done: filling the hours. The create dialog still does not call
  `GET /api/venues/place-details`. That call needs the Google Places key and
  is billed per request, so it waits for Joris's word. Until then the column
  stays empty for new venues.
- `src/__tests__/catalogue/opening-hours.test.ts`: day lines with and
  without `regularOpeningHours`, periods with split and closed days, always
  open, and eight unreadable values that give nothing.
- Chrome, Firefox and WebKit, headless, at 1440 and 390 (390 also with a
  coarse pointer), on a preview with three venues: Google day lines, periods
  with a split day, and unreadable hours. The first two show seven day rows,
  the third shows no Opening hours group; no raw JSON on any; no alignment,
  contrast, naming or overflow finding.

### Review fixes (PR #116)

- A split day no longer breaks inside a range: each range of a day ("10:00
  AM – 1:00 PM", "2:30 – 7:00 PM") is one inline block, so the line breaks
  between ranges, after the comma.

