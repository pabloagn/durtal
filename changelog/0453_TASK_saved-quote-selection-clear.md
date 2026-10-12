# Task 0453: Clear the saved quote selection (SLN-645)

**Status**: In Progress
**Created**: 2026-10-12
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0451
**Blocks**: SLN-489 runtime acceptance

## Overview
Clear the captured native selection after saving its quote, before opening the saved note.

## Implementation Details
- `reader-tracking.tsx` clears the action-time capture after successful save and annotation refresh, using the existing selection bridge.
- Failed saves, revoked controllers and collapsed captures do not clear a selection. The engine's captured-range guard preserves a newer selection while the original saved quote opens.

## Completion Notes
Implementation is independently reviewed and committed. All nine focused tests passed: five quote cases and four annotation selection cases. The full local suite passed all 6,602 tests. Native WebKit completed all eight quote operations across six lifecycle phases, with zero page errors, console errors or guard violations. Database checks preserved all pre-existing annotations and notes, confirmed the retained quote's detached annotation pointer, and confirmed removal of the requested quote and highlights. The raw browser report still records cancelled lookup requests and response observers interrupted by navigation; it is not a clean network-error result. Merge and deployment are pending.
