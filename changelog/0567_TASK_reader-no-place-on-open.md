# Task 0567: Opening a book saves no place until the reader moves

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0515
**Blocks**: None

## Overview

SLN-665 follow-up, found by #271's look at one Mac showing five devices whose
places all said 15:17. When a device opened a book for the first time at
another device's place, the reader saved that landing at once as this
device's place, under the other place's clock. Every new cookie jar (a
private window, another profile, a headless check) left a row that looked
like reading at that minute, without having moved. Separately, two saves
under one clock could move a place back: the browser's store let the later
one win the tie, the server the first.

## Implementation Details

- `reader-view.tsx`: the save on open now runs only when the place opened
  at is this device's own, carried to another file or found again in a
  changed one, and it keeps that place's clock as before. Opening at
  another device's place, or at the start, only primes the unchanged-place
  guard. The first real move saves under the time of that move.
- `positions.ts` (`savePosition`): a save under the same `client_updated_at`
  replaces the row only when its `progression` is greater. The clock is
  still the first key.
- `store.ts` (`enqueue`): the local latest place uses the same rule. Under
  one clock, the further place wins, whichever came first.
- `docs/02_DATA_MODEL.md` (ebook_positions) and `docs/05_API_REFERENCE.md`
  (POST position) state the tie rule.

## Completion Notes

- Tests:
  - `reader-view.test.ts`: a never-opened device commits no place on open.
  - `reader-sync` (database): two saves under one clock keep the further,
    in either order, on two devices. It fails on main.
  - Native IndexedDB check (`reader-offline-store.mjs`): under one clock the
    further place is the latest, in either order. It fails on main ("An echo
    under the same clock moved the place back").
- `test-local.py` reader-sync and reader-core pass (18 tests).
- Not changed: Go there still saves the place taken under its source's
  clock (the resume clock), so taking another device's place does not look
  like newer reading.
- No migration and no new packages.
