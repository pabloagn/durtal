# Task 0529: Notification history

**Status**: Completed
**Created**: 2026-10-14
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0528
**Blocks**: None

## Overview

SLN-567, second part. An error or warning toast was gone once it closed, so a failure missed while looking elsewhere left no trace. Errors and warnings are now kept in a notification history that a bell opens, with read and unread state, Remove, Mark all read and Clear all. The rest of the ticket stays open (see Completion Notes).

## Implementation Details

- `src/lib/notifications/history.ts`: the store, read through `useSyncExternalStore`.
  - Kept in localStorage under `durtal-notifications`: the latest 50 entries for 14 days. Another tab's change arrives through the `storage` event. A storage that refuses keeps the history for the page's life.
  - `record` updates the entry of the same toast id (a pending toast that ends in an error), and counts the same message again within 60 seconds on the newest entry instead of adding one.
  - `markRead` marks only the ids it is given.
- `NotificationRecorder` (`src/components/layout/notification-recorder.tsx`), mounted by `AppToaster`, so on every page and in the reader: it watches Sonner's toasts and records the error and warning ones. Toast ids restart with each page load, so each load prefixes its own.
- `NotificationCentre` (`src/components/layout/notification-centre.tsx`): the bell and a `popover="auto"` glass panel.
  - The panel is placed beside the bell inside a 16px gutter, at most `min(480px, 70vh)` high. It does not scroll; its list does.
  - Entries seen while it is open, including ones that arrive then, count as read when it closes.
  - The kind icon and the Remove cross sit on the cap-height center of the entry's title (`CapAligned`); the cross is 44px on touch. The "unread" marker for screen readers follows the title, so the title is the first thing read and the line the icons align to.
- The bell carries `aria-expanded`. `TooltipLayer` (`src/components/ui/tooltip.tsx`) shows no tooltip on a control whose `popovertarget` panel is open, closes the tooltip when that panel opens, and drops a tooltip that would render after the panel opened. Before, a keyboard-focus tooltip could stay on the bell over the open panel and take the first Escape (Firefox and WebKit, about one try in five). The reading estimate and "Why this" popovers gain the same.
- The bell sits in the sidebar footer (in the icon column, beside the motto) and in the phone bar before Search.
- `docs/03_DESIGN_LANGUAGE.md`, Toasts.

## Completion Notes

- Tests: `src/__tests__/notifications/history.test.ts` and `src/__tests__/ui/notification-centre.test.ts`, 11 tests: retention and the 50 cap, storage that refuses, repeats and updates by id, read state on close, Remove, Mark all read, Clear all, other tabs.
- Headless Chromium, Firefox and WebKit at 1440 and 390, on a production build with 12 seeded entries:
  - the bell opens the panel from the sidebar and from the phone bar; the panel sits in the gutter, does not scroll, and its list does;
  - the alignment audit, overflow audit and design audit on 7 pages, panel closed and open: 84 of 84 passed, 0 alignment deviations.
- Escape with the panel open, keyboard only, seeded with an unread error: 36 of 36 tries in Chromium, Firefox and WebKit at 1440 and 390 close the panel, keep focus on the bell and mark the entry read. Hovering the bell shows its tooltip when closed, none while open, and again after Escape.
- The handoff's open issues 1 (the sidebar bell not opening) and 2 (the panel scrolling) did not reproduce on this build in any of the three browsers.
- Still open in SLN-567: the full lifecycle audit (pending to success or failure across producers, info toasts, expiry rules per kind), live-announcement and reduced-motion checks, and the dialog and reader layout pass.
