# Task 0848: Keep full biographies out of the People list payload

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-974: the People list sends complete biographies even when no biography is shown, exceeding its 300 KB budget on the recovery stress fixture.

## Implementation Details

- List reads opt out of biographies; existing API/detail reads retain complete content.
- The optional Bio table column loads the current page's biographies when enabled, with loading and retry feedback.
- No schema or data changes.

## Completion Notes

Validation in progress against disposable fixtures.
