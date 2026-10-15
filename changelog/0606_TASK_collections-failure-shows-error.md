# Task 0606: A failing collections query shows the error view

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: 0602
**Blocks**: None

## Overview

SLN-714. The SLN-641 slice 3 audit forced a database outage by taking the
works table away, and `/collections` still drew "No collections yet". The
audit could not tell whether a real failure there would also show the empty
state instead of an error.

## Implementation Details

- It would not. The page's list awaits `getCollections` and
  `getCollectionCount` with no catch, so a failing query throws to the
  catalogue's error view. The audit's outage left the collections query
  working: it reads collections, their members and editions, never works,
  and the seed had no collections.
- No code change. `src/__tests__/ui/collections-page-failure.test.ts` holds
  it: a failing list query or count throws out of the page's list, and
  "No collections yet" is drawn only when the query answers with none.

## Completion Notes

- With the test's catch added to the page as a check, its two failure cases
  fail.
- On a disposable preview with the `collections` table renamed, `/collections`
  shows "Something went wrong" with Try again and Go to the dashboard, in the
  app shell, in Chromium at 1440, 390 and 320 and in Firefox and WebKit at
  390. Alignment 0, touch targets 0.
