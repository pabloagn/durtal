# Task 0846: Finish taxonomy management and hierarchy controls

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: SLN-957, SLN-958, SLN-959, SLN-942
**Blocks**: SLN-960, SLN-961

## Overview

Offer valid taxonomy deletion and merge choices, preserve the selected ordering, and make the hierarchy readable and keyboard accessible.

## Implementation Details

- Return expected taxonomy refusals through the shared UI boundary while preserving unexpected-error protection.
- Keep linked items and parents protected in direct deletion, including custom families whose foreign keys allow cascades.
- Offer sibling merge/reassignment targets and explain when children must move first.
- Respect incoming sort order; allow dragging only in the unfiltered manual view of orderable families.
- Reorder selected slots without moving unlisted rows or introducing tied positions; append new items under the same lock.
- Reserve identical hierarchy control space for leaf/parent rows, use fixed 20px indentation, wrap names and name controls per item.

## Completion Notes

Implementation and validation in progress. No live taxonomy writes, migrations or deployment.
