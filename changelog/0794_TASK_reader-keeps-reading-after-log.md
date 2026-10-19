# Task 0794: Reading after a log in the reader is recorded

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1192, found while re-checking SLN-677. After Log progress in the reader
(ahead of the reader's place or behind it), the rest of that visit's reading
was not recorded, and nothing said so. Track, Log progress 50/300, then turn
three pages (3.59% to 14.34%, about 10 s): no sitting and no session for those
pages; the next visit recorded again.

Every reading edit retires the reader's sittings on the server
(`guardReading`, `reading_edited`), so the edit and the sessions stay
consistent. The reader kept saving under the retired sitting's id, and the
server ignores saves to a retired sitting.

## Implementation Details

- `src/components/reading/reader-tracking.tsx`: when a reading change is
  saved in the reader (the dialogs' `changed`, which raises the activity
  refresh), the tracker sends what it has, then starts a fresh sitting at the
  reader's place, as Pause already does. It then takes the reading as it now
  is: a finished reading saves nothing more, and the bar shows the new
  reading. During the Undo of a new reading the held sitting is left alone.
- A change that did not touch the reading only splits the sitting; the two
  parts join into one session on the server, as consecutive sittings do.

## Completion Notes

- `reader/tracking-after-log.test.ts`: after a log, the reading goes in a
  second sitting from the reader's place (10 to 14, then 14 to 18), not the
  retired one; after a finish nothing more is saved. The first fails without
  the change (one sitting, 10 to 18, under the retired id).
- Production build on the preview database (`--seed-reader`), E01, Chromium,
  Firefox and WebKit: Track, Log progress 50/300 or 10/300, turn three pages,
  open Reading actions, leave. Each run now records a 12 s sitting from 3.59%
  to 14.34%; before, none.
- After a log ahead of the reader (50/300), that sitting's session starts
  where the log put the reading (p. 50) and ends behind it (p. 43), so it
  counts its time and no pages, by the existing session rule (`planPositions`).
- 0 alignment findings on the reader at 1440 and 390 in all three engines; no
  interface change; page weight within budget on every route.
- No migration and no new packages.
