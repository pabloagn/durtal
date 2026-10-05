# Task 0325: The People timeline counts every collection's works

**Status**: Completed
**Created**: 2026-10-04
**Priority**: LOW
**Type**: Fix
**Depends On**: 0278
**Blocks**: None

## Overview

Review note on SLN-419. The People table's Works column counts each person's
works in every collection (task 0278), but the Timeline view still said
"N works" from the books alone: a director who also wrote showed only the
books.

## Implementation Details

- `getAuthorsForTimeline` (`src/lib/actions/author-timeline.ts`) takes its
  counts from `getPersonWorkCounts`, one grouped query for the whole
  timeline, instead of each person's book links. It no longer loads those
  links. The "works" sort follows.

## Completion Notes

- Test: `people-credits.test.ts`, "the People timeline counts works in every
  collection" (a book and a film, two roles on the film: 2).
