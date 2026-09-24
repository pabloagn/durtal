# Task 0109: Prevent Orphan Records in Polymorphic Tables

**Status**: Completed
**Created**: 2026-04-06
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0097
**Blocks**: None

## Overview
`comments`, `activity_events`, and `gallery_layouts` tables use polymorphic references (entityType + entityId) without foreign key constraints. When a work or author is deleted, these records become orphans.

## Implementation Details
Option A (recommended): Add application-level cleanup in `deleteWork` and `deleteAuthor` actions:
- Delete from `comments` WHERE entityType='work' AND entityId=workId
- Delete from `gallery_layouts` WHERE entityType='work' AND entityId=workId
- Delete from `activity_events` WHERE entityType='work' AND entityId=workId
- Same for authors

Option B: Add database triggers (more reliable but harder to maintain with Drizzle).

Also: `gallery_layouts` has no foreign key constraints at all — if using Option A, ensure the cleanup runs before the cascade deletes fire.
