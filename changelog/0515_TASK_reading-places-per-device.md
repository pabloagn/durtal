# Task 0515: Reading places, one row per device

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-665, without History. The eBook page listed every saved place, one row per
file and device id, so a book read on many devices, or by a browser whose
cookie was reset many times, drew hundreds of identical rows and a page of
over 600 KB at 1,000 places. The Reading places section now shows one row per
device, the newest five, with "Show all N devices", and each row opens the
book at that device's place.

## Implementation Details

- `getEbookDetail` takes `places: { deviceId, devices }` for the page
  (`src/lib/ebooks/library-queries.ts`). `positions` is then only what
  Continue needs: the newest 20 places and this device's places. `places`
  is each device's newest place (a device is its label, as one browser can
  hold several device ids), newest first, at most `devices` of them, and the
  number of devices. Without the option it reads every place, as the API did.
- The page (`src/app/(catalogue)/ebooks/[ebookId]/page.tsx`) reads five
  devices, or 200 with `?places=all`.
- `src/components/ebooks/ebook-places.tsx`: one bordered list, a row per
  device with its name, "Opens next" on the device Read opens at, percent and
  chapter, a thin progress bar, when and in which format, and "Read from
  here" on the first line's cap-height center.
- "Read from here" opens `/reader/<id>?from=<device id>` (and `file=` when
  that place's file can still be opened). The entry policy allows `from`
  once, as a device id. `readReaderBook` returns that device's newest place
  as `startPlace` and opens its file; the reader opens there over this
  device's own place and local storage, says "Your place from X" when X is
  another device, and offers none of the places it was chosen over.
- `scripts/qa/seed-places.sql` and `preview-local.py --seed-places N`: N
  places under 40 device names on the first e-book, newest just now.
  `page-weight.json` measures the most recently opened e-book's page
  (`/ebooks?sort=opened`), so with `--seed-places 1000` it is that book.

## Completion Notes

- The reader page read every place too: 518 KB at 1,000 places, over its
  400 KB budget. `readReaderBook` now reads this device's and the chosen
  device's places, each other device's newest, and the furthest other one,
  which is all the offer of another device's place uses: 43 KB.
- Measured on the 6,000 e-book preview with `--seed-places 1000` (40 device
  names): the eBook page went from 631 KB to 79 KB (33 ms), 196 KB with
  `?places=all`.
- Not covered: History (the ticket's other part needs a migration), and the
  reader's place API (`GET /api/reader/[ebookId]/position`), which still
  returns every place when the reader checks for a newer one.
- Tests: `src/__tests__/ui/ebook-places.test.ts`, the entry policy, the
  page-weight config, and database tests in `ebook-library` (1,000 places,
  41 devices) and `reader-core` (`fromDeviceId`).
