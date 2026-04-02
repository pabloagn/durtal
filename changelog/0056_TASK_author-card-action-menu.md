# Task 0056: Author Card Action Menu (Three-Dots)

**Status**: Completed
**Created**: 2026-03-30
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0055
**Blocks**: None

## Overview
Author cards in grid and list views currently have no action menu (three-dots button on hover). Book cards have this already. Authors need the same treatment, with actions tailored to authors.

## Implementation Details
- Add a three-dots action menu on hover for author cards (grid and list views)
- Actions should include: Copy Name, Edit, Delete (Merge is a detail-page-only action)
- Follow the same visual pattern as book card action menus
- Use the squared container style (2px border radius, per design system) -- not round
- Position to avoid overlapping with other card content
- Consistent with the fixes in Task 0053
