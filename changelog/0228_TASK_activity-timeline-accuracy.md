# Task 0228: Activity timeline accuracy (SLN-297)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: LOW
**Type**: Fix
**Depends On**: 0080
**Blocks**: None

## Overview
Some activity events were wrong or missing, so the work and author activity trail was not reliable.

- A taxonomy save recorded one generic `work.taxonomy_added` event, with no item names. This happened also when the save only removed items.
- An author merge recorded nothing on the author that remains.
- "Show more" paged with `created_at < cursor`. Events that shared a timestamp at a page edge were skipped.

## Implementation Details
- `updateWorkTaxonomy` (`src/lib/actions/taxonomy.ts`) reads the current links of each family in the input before the write. After the write, it records one `work.taxonomy_added` or `work.taxonomy_removed` event for each item that changed. Each event holds `taxonomyType` (for example "theme"), `targetId` and `targetName`. A save that changes nothing records nothing. The families come from `WORK_TAXONOMY_FIELDS` and the system taxonomy registry.
- `mergePeople` (`src/lib/actions/people.ts`) records `author.merged` on the target author, with the source author's id and name. `mergeAuthors` calls `mergePeople`, so both paths record it. The event config already had the key.
- `getActivityTimeline` (`src/lib/actions/activity.ts`) pages on the keyset `(created_at, id)` and orders by both columns. It returns `nextCursor`. The cursor holds the database's text form of `created_at`, so it keeps microseconds; a JS `Date` cuts them to milliseconds. Encode and decode are in `src/lib/activity/cursor.ts`.
- `ActivityTimeline` (`src/components/activity/activity-timeline.tsx`) keeps the server's `nextCursor` and sends it for "Show more".
- No change for collection removal: main already records `work.collection_removed` in `removeEditionsFromCollection`.

## Completion Notes
- New database suite `src/__tests__/integration/activity-timeline.test.ts` (database `sln297_test`):
  - Seven events, five with one timestamp, paged two at a time: every event appears once, in order.
  - Two themes added, then one removed: two added events and one removed event with names. "Removed theme Dread" is the text. A save with no change adds no event.
  - An author merge records `author.merged` on the target with the source name.
- New unit test `src/__tests__/activity/cursor.test.ts` for the cursor encode and decode.
- No schema change and no migration. Old generic taxonomy events stay in the database as they are.
