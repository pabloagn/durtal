# Task 1011: Tracking keeps going when the Mac was out of reach while the tab was away

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: 1010
**Blocks**: None

## Overview

SLN-1274. A book is open with tracking on; the person leaves the tab while
the Mac can't be reached, then comes back. The timer read failed, and
`ReaderTracking` swapped itself for its failure surface for the rest of the
visit, so nothing read after that was saved until a reload. The failure
surface itself crashed (React error 130), which 1010 fixed. A failed refresh
of the marks also showed "Your mark could not be saved" though no mark was
made. Two smaller items from the failure resilience survey ride along.

## Implementation Details

- `src/components/reading/timer-provider.tsx`: the value carries `known`,
  true once the timer has loaded (or arrived with the page). It reads again
  on the `online` event as well as on focus and visibility.
- `src/components/reading/reader-tracking.tsx`: tracking fails only when the
  timer has never been known. An unreachable timer keeps it mounted; the
  sitting queue keeps sittings in `localStorage` and sends them when the
  connection returns. The timer's own notice still says changes to the timer
  wait for it. The tracker's "has not synced" notice, with Retry sync, goes
  once a later send gets through; it used to stay for the visit.
- `src/lib/reader/annotation-controller.ts`: a failed server refresh in
  `pull` still shows in the snapshot (the marks panel's "Annotations could
  not be refreshed" with its Refresh), but no longer calls `onError`, which
  the reader turns into the save notice. A failure reading this device's
  own stored marks still does.
- `src/lib/reading/reader-controller.ts`: "Track this book" clicked before
  the reader has a place starts at the reader's landing instead of doing
  nothing. Stopping, a new reading or a manual timer drops the wish.

## Completion Notes

- Measured on a production build, private preview, headless Chromium,
  Firefox and WebKit: tracking on, the tab hidden and shown again while
  every request to the server fails, then the connection returns and 12 page
  turns follow over 30 s (`reader_sitting_receipts`).

  | Build | Chromium | Firefox | WebKit |
  | -- | -- | -- | -- |
  | Main with 1010 | tracking off, nothing after | same | same |
  | This change | 46 s sitting to 47.86% | 46 s, same | 48 s, same, 5 runs of 5 |

  Without 1010 the reader also crashed. In WebKit, keeping Playwright's
  request interception on after the return dropped the closing beacon's
  body in some runs; the runs above remove it when the connection returns.

- Tests: `src/__tests__/reader/tracking-unreachable-timer.test.ts` runs the
  real timer provider through hidden, unreachable, shown and back online:
  tracking stays, the 30 s read while unreachable are sent after, and the
  "has not synced" notice goes once a send gets through. It
  fails without the guard change and without the `online` read. Two
  controller tests cover the early click (the first fails without the
  change). `annotation-offline-admission.test.ts` now expects a failed
  server refresh in the snapshot and no `onError`.
- "Track this book" on a freshly opened book started on the first click in
  all three engines on this build and on main in my runs, so the early-click
  case is covered by the controller test rather than reproduced. With another
  device's place on offer, the bars stay hidden until it is answered, which
  is by design.
- WebKit offline: no unhandled rejection reached the page in my runs. It
  logs "Failed to load resource" and "Beacon API cannot load" for each
  failed request; those are the browser's own network messages, which page
  code cannot catch.
