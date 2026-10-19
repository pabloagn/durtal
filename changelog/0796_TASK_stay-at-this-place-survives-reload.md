# Task 0796: "Stay at this place" holds through a reload

**Status**: Completed
**Created**: 2026-10-19
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1179, from the review of #523. When the reader opens behind the logged
place, the bar offers "Jump to p. N", and "Stay at this place" dismisses it.
A reload forgot the dismissal, so the offer came back each time.

## Implementation Details

- `src/lib/reading/logged-place.ts`: `stayedAt` and `keepStayedAt` keep the
  logged place the jump was dismissed or taken at, per reading, in session
  storage (`durtal-reader-stayed:<reading id>`). Both catch a blocked or
  full storage, which leaves today's behaviour: the dismissal lasts until
  the page reloads.
- `src/components/reading/reader-tracking.tsx`: the dismissal starts from
  the stored place, is stored by "Stay at this place" and by the jump, and
  is read again when the reading changes. A later logged place is another
  place, so it offers the jump again.
- `src/__tests__/reader/stay-at-this-place.test.ts`: mounts the tracking
  control and remounts it as a reload: the offer stays away, a later logged
  place and another reading bring it back, and blocked storage still
  dismisses for the visit.

## Completion Notes

Checked on a local preview in Chromium, Firefox and WebKit: offered behind
the logged place, gone after Stay and after a reload, offered in a new tab,
and offered again after a later log and a reload; no page errors. Typecheck
clean, lint 0 errors, alignment 0 at 1440 and 390 in three engines, page
weight within budget.
