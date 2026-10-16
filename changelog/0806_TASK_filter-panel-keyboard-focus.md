# Task 0806: The Filter panel shows the keyboard focus and closes when it leaves

**Status**: Completed
**Created**: 2026-10-16
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-870. The hover and focus survey (`findings/hover-focus-survey-2026-10-15.md`), items 1 to 3, all in the shared Filter panel that every list page uses (`src/components/shared/filter-dropdown.tsx`):
- Tabbing through the options showed nothing: the checkbox is a hidden input and its label had no focus style.
- Tab past the panel's last control left it open over the page, and the next stop (Export on the journal; Grid or the first item on a phone) sat under it.
- The section tabs' rings were cut on both sides by the section rail's scroller.

## Implementation Details
- An option's label draws the ring while its input has keyboard focus (`has-[:focus-visible]`), 2px inside, so the panel's scroller doesn't cut it.
- The panel closes when the focus moves to something outside it, as a menu does. A press outside already closed it; a press on nothing focusable still does, through the mousedown handler.
- Section tabs draw their ring 2px inside (`focus-visible:-outline-offset-2`).

## Completion Notes
- Test: `src/__tests__/ui/filter-panel-focus.test.ts` (3 tests, all fail without the fix).
