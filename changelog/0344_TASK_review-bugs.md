# Task 0344: Small bugs from review

**Status**: Completed
**Created**: 2026-10-06
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Four small bugs that review found in earlier PRs: SLN-482, SLN-483,
SLN-484 and SLN-486. A fifth, SLN-485 (`/api/s3/read` in a preview), is in
#119, which already changes that route.

## Implementation Details

- **SLN-482, order messages.** A refused order delete quoted the stored
  status (`Cannot delete a "delivered" order`). `deleteOrder`, the transition
  error of `updateOrderStatus` and the status-history note of a deleted order
  now use `orderStatusLabel` and `acquisitionMethodLabel`, the labels #114
  made one list: `Cannot delete a "Delivered" order.`
- **SLN-483, overlapping sessions.** `src/lib/reading/session-overlap.ts`
  holds the rule: a session's time runs from its start to its end, else its
  start plus its length; a running timer runs to now; a session without a
  start time takes no time on the clock. One that starts as another ends is
  fine. `addSession` and `updateSession` refuse a session that crosses
  another of the same reading: "Overlaps the session from 14:00 to 14:45.
  Change the start time or the time read." The session dialog loads the
  reading's sessions (and its running timer) for an edit too, shows the same
  message under the start time as it is typed, and keeps Save off.
- **SLN-484, 404s.** `/places/[slug]`, `/taxonomy/[familySlug]` and
  `/taxonomy/[familySlug]/[itemSlug]` called `notFound()` inside their page's
  Suspense, after the 200 had gone out. Each now checks its record in its
  layout first, as changelog 0286 did for the other detail pages. The
  loaders moved to a `load.ts` beside each route (`React.cache`), so the
  layout, the page and its title read the record once per request.
- **SLN-486, unused code.** `DomainHomeFilters` and `loadDomainHome` had no
  caller. They go, with the sort list and the count functions only they used;
  the tile test moves to `loadRecentTiles`, which the dashboard uses.
- **Not changed: `storygraph.ts`.** The StoryGraph mapper reads Read Count two
  ways: with dated reads, an open book ignores the count; without them, the
  count is the number of finished reads before the open one. Which is right
  depends on what StoryGraph's export counts, which neither the code nor its
  hand-made fixture settles, so it waits for a real export.

## Completion Notes
