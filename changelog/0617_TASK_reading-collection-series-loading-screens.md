# Task 0617: The reading tabs, a collection and a series show their loading screens

**Status**: Completed
**Created**: 2026-10-15
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0610
**Blocks**: None

## Overview

From the second loading audit of 15 October
(`findings/audit-loading-2-2026-10-15.md`, findings 1 and 3; SLN-749 and
SLN-751). No reading page, collection or series had a loading screen, so a
click kept the last page, with no sign it registered, until the new one
arrived. With every query slowed to 800 ms:

| Page | Nothing shown for |
| --- | --- |
| Reading, Stats | 2.6 s |
| Up Next, Suggestions | 1.75 s |
| A collection, a series | 1.8 s |
| Journal, Notes, Years, Import | 0.9 s |

## Implementation Details

- **The reading tabs** moved into a route group,
  `src/app/(catalogue)/reading/(tabs)/`, with one loading screen
  (`loading.tsx`, drawn by `reading-pending.tsx`):
  - the page's header, "Reading" or "Year in review", with the clicked tab
    current;
  - each tab's header buttons, held at their labels' widths, so on a phone they
    go under the title where the page's do;
  - then the first section, held.
- A prefetched link draws one loading screen for every tab in the group, so the
  screen takes its title and buttons from the address.
- A year in review and an import answer 404 for a missing one from their own
  pages (SLN-546). They stay outside the group (`reading/year/[year]`,
  `reading/import/[id]`), with no loading screen.
- **Up Next** read the locations uncached before its queue, a round trip on its
  own. It now uses the cached `getLocations`.
- **A collection and a series** draw their pages' layout while they load:
  - a collection: the way back, the poster's box, the name, the counts line and
    its four controls, held at their widths;
  - a series: the way back, the title row with its star and menu (under the
    title in a narrow row), the authors line and the counts.
- Their layouts now check the record first with `collectionExists` and
  `seriesExists` (`src/lib/catalogue/record-exists.ts`) through `liveRecord`, as
  the book and person layouts do. A missing one still answers 404, and a merged
  one still redirects, in the same single query as before.

## Completion Notes

- Production preview, every query slowed to 800 ms, a click from Settings,
  Chromium, Firefox and WebKit at 1440:

  | Page | Loading screen, prefetched | Before | Page |
  | --- | --- | --- | --- |
  | Reading | 53 to 64 ms | nothing for 2.6 s | 2.6 s |
  | Stats | 56 to 61 ms | nothing for 2.6 s | 2.6 s |
  | Up Next | 41 to 69 ms | nothing for 1.75 s | 0.9 s (was 1.75 s) |
  | Suggestions | 44 to 71 ms | nothing for 1.75 s | 1.75 s |
  | A collection | 43 to 78 ms | nothing for 1.8 s | 1.75 s |
  | A series | 50 to 62 ms | nothing for 1.8 s | 1.7 s |

  - Unprefetched, a reading tab shows its screen within 225 ms.
  - Unprefetched, a collection or a series shows its screen at about 0.9 s,
    after its record check, as a book does. The app prefetches its links.
- Measured against the page that replaced it in the three browsers at 1440,
  390 and 320:
  - Reading, Up Next, Notes, Stats, Suggestions and Years: the title, the tabs
    and the header's end: 0 px.
  - A collection: the way back, the name's line, the counts and the header's
    end: 0 px.
  - A series: the way back, the title, the authors and counts at 1440: 0 px.
    An author line that wraps on a phone, and the eBook and next-to-read lines
    some series add, move what is below them.
- 404 for a missing or malformed collection, series, year in review and
  import; 200 for real ones and for every reading tab.
- Tests:
  - `src/__tests__/ui/loading-pass-2.test.ts`: each tab's title and held
    buttons, nothing pressable; the collection's and series' way back.
  - `src/__tests__/cross-layer/not-found-status.test.ts`: the collection and
    series pages sit under a loading screen with a layout check; a year in
    review and an import stay outside one.
  - `src/__tests__/integration/record-exists.test.ts`: a collection and a
    series by id.
