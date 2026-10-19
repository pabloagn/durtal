# Task 1010: An unreadable saved sitting is set aside, and tracking stays on

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1231. The reader keeps unsent sittings in `localStorage`. The queue
decoded them all when it started, and one entry that failed today's schema
threw out of it. Tracking turned off for that book on that device for good,
and the valid sittings beside it were never sent. In a browser it was worse
than the code read: the tracker's failure surface itself crashed (React
error 130), so the reader showed "This eBook could not be opened".

## Implementation Details

- `src/lib/reading/reader-sitting-queue.ts`: entries are decoded one by one.
  One that fails moves, word for word, to
  `durtal:tracker-recovery:v1:<device>:<e-book>:<sitting>` and the rest load
  and send. A stored field this release no longer knows is dropped before
  the strict schema reads it. If the recovery key can't be written, the
  entry stays put and is set aside again next time. `setAside(count)`
  reports how many. On each open, a set-aside entry that now reads (one set
  aside by another release, say) goes back in the queue and is sent; one
  that still doesn't stays and isn't counted again.
- `src/components/reading/reader-tracking.tsx`: after the first send, a
  toast says once that a saved sitting could not be read and was set aside.
- `src/components/reader/bridge.tsx`: the plug-in host gave the server-built
  failure surface its code and Retry with `cloneElement`. That element can
  reach the client as a lazy node, which `cloneElement` turns into an element
  of undefined type. The host now passes them by context
  (`useReaderControllerFailureProps`), so "Reading tracking is unavailable"
  shows with Retry tracking.
- `src/__tests__/reader/sitting-queue-set-aside.test.ts`: one bad and two
  good entries (two sent, the bad one kept under the recovery key), a
  dropped field, full storage, and the failure surface as a lazy node with
  its Retry. All four fail on main. A fifth: a readable set-aside entry is
  sent on the next open, and an unreadable one stays uncounted.

## Completion Notes

Production preview, Chromium, Firefox and WebKit, with one unreadable and
two valid sittings stored for the book: the reader opens, both valid
sittings are sent and saved, the bad one is under the recovery key, the
toast shows once, and tracking records the next pages. With the timer
unreachable, the failure surface shows with Retry tracking and no plug-in
crash is logged.
