# Task 0772: A saved page shows its new content at once

**Status**: Completed
**Created**: 2026-10-18
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None (also fixes SLN-1242 and SLN-1225, the dropped redraws)

## Overview

SLN-1141, and the dropped redraws of SLN-1242 and SLN-1225. After Save in Edit film, Edit perfume or Edit painting, Delete on a
bottle, or a favourite toggle, the dialog closed and the toast showed, but the
page kept the old content for about 4 s. It changed when the toast left or the
pointer moved. A keyboard or touch user who didn't move the pointer waited
with stale content.

## Implementation Details

- The server answered in about 100 ms and the refresh had its data by 0.4 s.
  The wait was all in React on the client.
- React's root showed the refresh's transition lanes both pending and
  suspended, with no ping and nothing scheduled. Every ping listener React
  attached did fire. The last one fired during the render itself: the Flight
  chunk it waited on had its data but was still unread, so its `then` read it
  and answered at once. React drops a ping that arrives while it is still
  rendering the lane that suspended, so the lane stayed suspended on data it
  already held. The favourite toggle loses its answer the same way, on the
  async action's own thenable.
- Any urgent update clears a root's suspended lanes and retries them. That is
  why the toast's removal or a pointer move released the page.
- `src/components/shared/transition-release.tsx`: a `PerformanceObserver` on
  resource entries. When a `fetch` finishes, one urgent update follows on the
  next frame (several in a frame share one). The waiting refresh is retried and
  commits. With nothing waiting it renders nothing. Mounted once in the
  catalogue layout beside `NavigationFocus`.
- Without `PerformanceObserver` it does nothing, so the page is as before.

## Completion Notes

- Production preview, headless Chromium, Firefox and WebKit, time from Save to
  the new title on the page:
  - Before: about 4.0-4.4 s in most saves (perfume 4 of 5 in the survey; my
    Chromium runs on `seed-perfume-2` 4.0 s).
  - After: perfume 0.2-0.4 s (9 of 9), film 0.2-0.4 s (12 of 12), painting
    0.2-0.4 s (9 of 9). The favourite button's busy state ends at 0.28-0.40 s
    (6 of 6).
- `src/__tests__/ui/transition-release.test.ts`: one update per finished
  request, one per frame, none for images or scripts, the observer stops on
  unmount, and the layout mounts it.
- The same drop left lists stale after a revalidating action (SLN-1242).
  On main, a book's Add target and Remove target redrew in 2-4 s or not
  within 6 s, and a collection Move redrew within 6 s in 16 of 40 presses
  (Chromium 6 of 20, Firefox 6 of 10, WebKit 4 of 10). With this change,
  every press redrew: Add and Remove target in 0.16-0.29 s, 50 of 50 each
  (20 in Chromium, 10 in Firefox, 10 in WebKit, plus 10 more in Chromium);
  Move in 0.11-0.26 s, 50 of 50. The extra `router.refresh()` after a
  revalidating action costs a second server render but does not drop the
  redraw once the ping is recovered.
- The book page's Hunting for section no longer hides a removed target
  itself (added by SLN-1029 because the new list was sometimes dropped). The
  page's own redraw takes the row away. Remove keeps its busy state, which
  holds the focus until the row goes. On the rebased build, in Chromium,
  Firefox and WebKit: Add and Remove target 10 of 10 each, in 0.11-0.51 s; a
  collection Move 10 of 10, in 0.09-0.15 s; after Remove with two targets the
  focus moves to the other Remove, and after the last one to Add target, 3 of
  3 each.
