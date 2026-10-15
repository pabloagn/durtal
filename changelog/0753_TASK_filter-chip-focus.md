# Task 0753: Removing a filter chip keeps focus in the filters

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-838. On Books, removing a filter chip dropped focus to the page body, so a keyboard user started again from the top of the page. The same happened after Clear all.

## Implementation Details
- `ListPendingProvider` (`src/components/shared/list-pending.tsx`): when the control that started a wait is gone once the results are in, focus moves on instead of dropping:
  - in a `data-focus-group`, to the next `data-focus-item`, or the previous one when the removed item was the last;
  - with none left, to the list's Filter button (`data-list-focus="filters"`), else its search field (`data-list-focus="search"`).
  - Focus is moved only when it fell to the page; a control the user moved to keeps it. A control that is still there gets focus back, as before.
- `ActiveFilters`: the chip row is a focus group and each chip an item. Clear all is not an item, so it goes straight to the Filter button.
- `FilterDropdown`'s trigger and `EntityFilters`' search field carry `data-list-focus`, so every list in a provider gets the fallback.
- Test: `src/__tests__/ui/list-pending.test.ts`.

## Completion Notes
See the PR's checks.
