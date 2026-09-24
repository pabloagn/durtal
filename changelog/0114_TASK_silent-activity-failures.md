# Task 0114: Fix Silent Activity Recording Failures

**Status**: Completed
**Created**: 2026-04-06
**Priority**: LOW
**Type**: Fix
**Depends On**: 0097
**Blocks**: None

## Overview
Instance and edition write operations silently skip activity recording when the edition→work chain lookup fails. Also, collection operations mostly lack activity recording entirely.

## Implementation Details
- `src/lib/actions/instances.ts` — `createInstance`, `updateInstance`, `deleteInstance` each resolve workId through a 3-query chain (instance → edition → work); if any step fails, activity is silently skipped
- Fix: Pass workId as input where available, or use a JOIN to resolve in one query
- `src/lib/actions/collections.ts` — `createCollection`, `updateCollection`, `deleteCollection`, `removeEditionFromCollection` have no activity recording
- Add activity recording to collection mutations
