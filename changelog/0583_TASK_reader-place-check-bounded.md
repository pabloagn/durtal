# Task 0583: The reader's place check stays small, and QA browsers keep their own label

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0515
**Blocks**: None

## Overview

SLN-665 leftovers from 0515 ("Not covered"):
- The reader's place API still returned every saved place when the reader
  checked for a newer one.
- Nobody had looked into why one Mac and browser showed as several devices.

## Implementation Details

- `GET /api/reader/[ebookId]/position` now answers only the places the
  reader uses (`placesToCheck`, `src/lib/reader/positions.ts`, replacing
  `allDevicePositions`):
  - this device's place in each file;
  - the newest place from another device;
  - the furthest place from another device.

  The reader's refresh (`createPlaceSync`) offers the newest other place and
  the furthest one (`placeToOffer`, `furthestOffer`) and reads nothing else,
  so the reader is unchanged. It is the same bound `readReaderBook` has had
  since 0515.
- `deviceLabelFor` labels a headless Chrome `Headless Chrome`
  ("Mac · Headless Chrome"). See below.
- docs/05 describes both.

## Why one Mac had several device ids

The device id is the `durtal-device` cookie. `src/proxy.ts` sets it on the
first reader page a browser opens without it. Every cookie jar is a new
device:
- a browser profile, a private window or cleared cookies;
- another hostname for the same server (`localhost` and the Mac's network
  name, for example);
- two reader tabs opened at once in a fresh browser, where each request
  makes its own id. SLN-668 (0500) stopped the extra id from blocking sync.

What this branch found and fixed:
- **QA runs**: every headless check (Playwright, the QA scripts) opens a
  fresh profile, so it gets a new id. Its user agent says `HeadlessChrome`,
  which was labelled "Mac · Chrome", the same as Joris's own Chrome.
- **Why that mattered**: the eBook page groups places by label (0515), so a
  check's place could stand in for his Mac's place.
- **Now**: such places are labelled "Mac · Headless Chrome" and stay in a
  row of their own.

Why the five rows showed the same minute: a device that opens a book at
another device's place saves a row straight away, keeping that place's clock
(`reader-view.tsx`, the landing save; review report section 4). So each new
id carried "15:17" whenever it was actually opened. That save is in the
reader's own UI file, which the eBook polish thread owns, so it is left for
that thread.

Not verified on live data: build threads do not read the live database.
This read-only query would confirm it. If several ids share one
`client_updated_at` but have different `updated_at`, the rows were opened
at different times:

```sql
select device_id, device_label, round(progression::numeric * 100, 2) as pct,
       client_updated_at, updated_at
from ebook_positions where device_label like 'Mac%'
order by client_updated_at, updated_at;
```

## Completion Notes

- Tests:
  - `reader-sync`: 62 other devices. The check answers this device's 2
    places plus the newest and the furthest; without a cookie, the newest
    and the furthest.
  - `position-route`.
  - `device`: Playwright's Chromium user agent.
- `pnpm test:local` passes for `reader-sync`, `reader-core` and
  `ebook-library` (25 tests).
- The GET's size no longer grows with the number of places. At 1,000
  places it was the whole table (2.7 MB at 5,000, review section 4); now it
  is at most this device's places plus two rows.
- Not covered: History (needs a migration), and the reader's save on open.
