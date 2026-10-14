# Task 0528: Every toast has its own dismiss cross

**Status**: Completed
**Created**: 2026-10-13
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-567, first part. A toast such as "Image adjustments saved" had no way to close it: it stayed until its timer ran out. Every toast now has a small cross in its top-right corner that dismisses that toast alone. The rest of the ticket stays open: the notification history, read and unread state, and the pending to success lifecycle.

## Implementation Details

- `AppToaster` (`src/components/layout/app-toaster.tsx`) is the one toaster. It replaces the three copies of the same Sonner setup:
  - the catalogue and reader branches of `Shell`;
  - the reader's `ReaderRuntimeProvider`.
- It turns on Sonner's close button with a Lucide `X` (14px, 1.5px stroke) and the label "Dismiss", and keeps at most three toasts in view. Sonner already stacks toasts with their own identities, spreads the stack on hover and holds the timers while it is pointed at.
- `globals.css` moves the cross from Sonner's circle on the corner to a 20px box 6px inside the corner, in the app's colours, with an accent focus ring. The toast keeps 36px clear on its right (44px on touch), so the text and an Undo never sit under the cross or its 44px touch area.
- Sonner gives its cross no way to take attributes, so `TooltipLayer` (`src/components/ui/tooltip.tsx`) shows a toast cross's label as its tooltip.
- `docs/03_DESIGN_LANGUAGE.md`, Toasts.
- On the Identify editions page, "Open the book" is a 44px target on touch: the audit of that page found it 20px high at 320.

## Completion Notes

- New `src/__tests__/ui/app-toaster.test.ts`:
  - two toasts each get a cross labelled "Dismiss" (an icon, no text);
  - keyboard focus on the cross shows the "Dismiss" tooltip;
  - the cross dismisses its own toast; the other stays and the Undo is not run.
- Headless Chromium, Firefox and WebKit at 1440 (mouse) and 390 (touch in Chromium and WebKit), on `/library/identify` with three "kept without an ISBN" toasts, each with Undo:
  - every cross sits 6px inside the corner, inside its toast;
  - neither its box nor its 44px touch area overlaps the text or the Undo button;
  - pointing at the stack spreads it with no toast overlapping another;
  - clicking the front toast's cross removes it alone, 3 to 2.
- `browser-audit.mjs` on `/` and `/library/identify` in all three browsers at 320, 390, 768 and 1440: 24 of 24 page loads passed.
- `page-weight.js`: every route within budget.
