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

- Statuses with curl on a seeded preview: `/places/no-such-place`,
  `/taxonomy/no-such-family` and `/taxonomy/art-movements/no-such-item`
  answer 404; `/places/seed-museum-1`, `/taxonomy/art-movements` and
  `/taxonomy/art-movements/baroque` answer 200. Before, all six answered 200.
- The session dialog in headless Chrome, WebKit and Firefox, on the reading
  journey's book: after a session at 06:00 for 30 minutes, a new one at 06:15
  for 30 minutes shows "Overlaps the session from 06:00 to 06:30" under the
  start time and Add session is off; at 06:30 for 10 minutes the message goes
  and Add session is on.
- `alignment-audit.js` and `design-audit.js` on a place, a taxonomy family, a
  taxonomy item and the reading journey's book at 1440 and 390: no finding.
- `python3 scripts/qa/test-local.py`: 215 files, 2,385 tests. New: the order
  delete message (`order-status-sync.test.ts`), overlaps by hand and by an
  edit (`reading-sessions.test.ts`), `session-overlap.test.ts`.

### Review fixes (PR #120)

- An edit to a session that already shared time with another (one saved
  before this rule) was refused, even for a note, and the dialog kept Save
  off. `newOverlap` leaves out the sessions the stored one already crossed:
  `updateSession` and the dialog refuse an edit only for time it newly takes;
  `addSession` is unchanged. Tests: `session-overlap.test.ts` (keep, stretch,
  move, new) and `reading-sessions.test.ts` (a note on an overlapping session
  saves; a new end over another session is refused).
