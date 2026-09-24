# Task 0111: Remove Duplicate /library/collections Route

**Status**: Completed
**Created**: 2026-04-06
**Priority**: LOW
**Type**: Fix
**Depends On**: 0097
**Blocks**: None

## Overview
Two collection routes exist: `/collections` (primary, with create dialog) and `/library/collections` (simpler, no management actions). The spec only defines `/collections`. The duplicate creates confusion and inconsistent UX.

## Implementation Details
- Remove `src/app/library/collections/page.tsx`
- Verify no internal links point to `/library/collections` (search codebase)
- The primary `/collections` page at `src/app/collections/page.tsx` is the canonical route
