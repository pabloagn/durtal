# Task 1031: Touch long-press and icon-only toggles

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1150, from findings/phone-pass-survey-2026-10-18.md (items 7 and 8). On touch, a long-press on a cover opened its menu, and the menu closed again as the finger lifted. Icon-only controls (Mark as rare, Mark as anathema, the view buttons, Delete collection and others) had no way to say what they do on touch, because tooltips skip touch. Some of them changed the record on the first tap.

## Implementation Details

- `use-cover-menu.ts`: the `touchend` that ends a long-press is cancelled. The browser then sends no mousedown and click after it, and that mousedown is what closed the menu. The cover link carries `data-long-press`, and `globals.css` sets `-webkit-touch-callout: none` on it, so iOS's link preview stays away.
- `tooltip.tsx`: a 500ms long-press on a `data-tooltip` control shows its tooltip. The lift does not press the control: the `touchend` is cancelled, and so is the system's long-press menu. The tooltip fades 1.5s after the lift. A touch `pointerout` no longer hides it.
- `-webkit-touch-callout: none` also applies to `[data-tooltip]`.
- `mark-toggle.tsx`: a new `confirmMarkOnTouch` shows "Marked as rare", "No longer rare", "Marked as anathema" or "No longer anathema" on a coarse pointer. `hunt-assessment-control.tsx` and `poison-toggle.tsx` call it after the save. A date change says nothing, and a mouse keeps its tooltip and hover card. This follows the coordinator's design call: a toast, with no visible labels, and the accessible names unchanged.
- `library-header.tsx`: Identify editions, which is icon-only on phones, has a tooltip while its label is hidden.

## Completion Notes

- Chromium, with real touches through CDP at 390:
  - A long-press on a library cover opens its menu, which is still open a second after the lift. A tap still opens the book.
  - A long-press shows the tooltip of each of these without pressing it: Mark as rare, Mark as anathema, Add to collection, Copy book title and author, Grid, List, Mosaic, Delete collection, Choose a collection icon and Identify editions. The record was unchanged, and no dialog or view opened.
  - Tapping rare and anathema toasts what changed.
- Firefox and WebKit: Playwright cannot send a real long-press there, so the touch events were dispatched in the page. The tooltip shows and stays after the lift, the lift is cancelled, and the cover's menu stays open.
- `-webkit-touch-callout` is inferred for iOS, not seen: Playwright's WebKit does not report the property.
- Alignment, design, overflow, layout and touch audits clean on the library, a book page, a collection page and People, at 1440, 390 and 320. Page weight passes.
- Tests: `tooltip-long-press.test.ts`, `mark-touch-toast.test.ts`, and a new case in `cover-menu.test.ts`. Unit tests pass except `leader-menu-focus.test.ts`, which fails the same way on main.
