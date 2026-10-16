# Task 0763: A year in review and an import preview show their loading screens

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0613
**Blocks**: None

## Overview

SLN-815, from the third loading and error states survey
(`findings/survey-loading-3-2026-10-15.md`, item 3).
- A year in review and an import preview answered 404 themselves, so #348
  left them outside the reading tabs' loading screen.
- A click on either one kept the last page, with no sign, until it arrived.

## Implementation Details

- **Layouts** (`reading/year/[year]/layout.tsx`, `reading/import/[id]/layout.tsx`)
  check that the record exists before the loading screen starts the
  response, so a missing one still answers 404. The checks are new in
  `src/lib/catalogue/record-exists.ts`:
  - `reviewYearExists` matches the year in review's own rule: four digits, and
    a book finished that year at a known date.
  - `readingImportExists` takes an id, and finds only a reading import
    (`IMPORT_SOURCES`, now exported from `page-data.ts`).
- **Loading screens** (`reading/year/[year]/loading.tsx`,
  `reading/import/[id]/loading.tsx`) draw `ReadingPending`, which moves from
  the tabs folder to `src/components/reading/reading-pending.tsx`. The
  address says what it draws:
  - **A year in review:** "2019 in review", with Print and "Stats for 2019"
    held at their widths.
  - **An import preview:** the reading hub's header and buttons, as the page
    has.
- **Tests**:
  - `not-found-status.test.ts` now lists both pages among those under a
    loading screen.
  - `loading-pass-2.test.ts` checks each screen's title, label and held
    buttons.
  - `record-exists.test.ts` checks both new checks against the database.

## Completion Notes

- **Status codes.** On a production preview, a year with a finished book and
  a reading import answer 200. These answer 404:
  - a year with none;
  - a year that is not a number;
  - an unknown import id;
  - an address that is not an id.
- **The loading screens against the pages.** I compared them in Chromium,
  Firefox and WebKit at 1440, 390 and 320, after a click from the reading hub.
  - The title, the current tab, the held buttons and the first section start
    where the page puts them.
  - At 320 the page's first heading wraps to two lines. For a year that is
    "The year in numbers" beside its link, and for an import it is the file
    name. The screen draws one line there.
  - Opened directly, the tab row on a phone is scrolled to the current tab
    once the page's script runs. This is the same on the reading tabs'
    existing loading screen.
- **Audits.** The alignment, touch and design audits report nothing on both
  pages and both loading screens, in all three browsers at all three widths.
- **Other.**
  - Typecheck is clean, and the tests above pass, including the database
    suite.
  - No migration, no new package.
