# Task 0090: Activity Timeline & Comments Linear-Style Overhaul

**Status**: Completed
**Created**: 2026-04-02
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0080, 0081
**Blocks**: None

## Overview
Complete overhaul of the activity timeline and commenting system to match Linear.app's design and behavior. The previous implementation had misaligned timeline, plain-text value labels, comments rendered as a separate section (not inline), no optimistic updates, and the comment editor at the top instead of the bottom.

## Implementation Details

### Files Modified
- `src/lib/activity/event-config.ts` — Rebuilt description system to return structured segments (`text` | `label`) instead of plain strings. Added `formatEventDescriptionSegments()` and `DescriptionSegment` type. Field value changes now render as styled inline labels instead of quoted text.
- `src/components/activity/activity-event-item.tsx` — Rebuilt with proper timeline alignment (icon dot on the vertical line with bg-bg-primary punch-through). Added `DescriptionText` component that renders structured segments with styled labels for values.
- `src/components/activity/comment-item.tsx` — Rebuilt as an inline timeline entry. Comment card sits in the timeline flow with a `MessageSquare` icon dot on the line, header with timestamp, rendered HTML body, and hover edit/delete actions.
- `src/components/activity/activity-timeline.tsx` — Rebuilt with proper Linear-style layout: vertical timeline line on the left, comment editor at the bottom (not top), optimistic comment insertion, and a small dot connecting the editor to the timeline.
- `src/components/activity/comment-editor.tsx` — Simplified collapsed state to minimal "Leave a comment..." input. Toolbar moved to footer in expanded state. Now passes back created comment data (id, eventId, contentHtml, contentJson) for optimistic timeline insertion.
- `src/app/api/comments/route.ts` — Comment creation now inserts activity event synchronously (not fire-and-forget) and returns the event ID in the response for optimistic update reconciliation.

### Real-time Activity Refresh System
- `src/lib/activity/refresh-event.ts` — New custom event system (`triggerActivityRefresh()` + `onActivityRefresh()`) that dispatches a DOM event whenever any mutation occurs. The ActivityTimeline listens for this event and re-fetches.
- Added `triggerActivityRefresh()` to ALL mutation components on both detail pages:
  - Work detail: `work-edit-dialog`, `work-taxonomy-edit-dialog`, `edition-add-dialog`, `edition-edit-dialog`, `edition-delete-button`, `instance-add-dialog`, `instance-edit-dialog`, `instance-status-button`, `instance-delete-button`, `work-media-section`
  - Author detail: `author-edit-dialog`, `author-merge-dialog`
  - Shared: `media-manager-dialog`, `author-media-manager-dialog`, `add-to-collection-dialog`, `match-again-dialog`

### Key Changes
1. **Comment editor at the bottom** — Matches Linear's layout with the input below all activity.
2. **Optimistic updates** — Comments appear instantly in the timeline on submit; background reconciliation syncs with server. Deletes are also instant.
3. **Proper timeline alignment** — Single vertical line with icon dots centered on it, using `bg-bg-primary` backgrounds to punch through the line.
4. **Styled value labels** — Field changes (e.g., priority from "high" to "medium") render with `bg-bg-tertiary` monospace labels instead of plain quoted strings.
5. **Comments inline in timeline** — Comments are activity items with icon dots, not a separate section.
6. **Real-time activity refresh** — Every mutation on the detail page (edit work, change rating, add edition, update taxonomy, upload media, etc.) instantly triggers an activity timeline re-fetch via a custom DOM event system. No more stale timelines.

## Completion Notes
All changes pass `pnpm typecheck`. The `ActivityTimeline` component interface is unchanged (`entityType` + `entityId`), so no updates needed in consuming pages (work detail, author detail).
