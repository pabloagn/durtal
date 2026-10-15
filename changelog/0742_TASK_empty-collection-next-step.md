# Task 0742: An empty collection and an empty publisher offer a next step

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview
Design polish pass 2, item 5 (`findings/design-polish-2-2026-10-15.md`). An empty collection said "Nothing yet" under its title, then a dashed box with a book icon and "Build your collection" with no button; the Add button sat above, away from it. An empty publisher's Books section said why it was empty but offered nothing to do.

## Implementation Details
- `src/app/(catalogue)/collections/[id]/page.tsx`: `memberCounts` returns `null` for an empty collection and the count line is left out (the controls keep their 16px gap). The dashed box is the shared `EmptyState` with the collections icon, "Nothing in this collection yet", what can go in it (`collectableNouns`, the kinds that are on), and an "Add to the collection" button.
- `src/components/collections/collection-controls.tsx`: `AddToCollectionButton` sends a window event that `CollectionControls` listens for, so the empty state's button opens the same add dialog as the header's Add, at once and with no round trip (the pattern of `editPublisherLinks`).
- `src/components/ui/empty-state.tsx`: `heading` also takes `h2`, for an empty state right under a page's own title.
- `src/app/(catalogue)/publishers/[slug]/page.tsx`: the empty Books section keeps its reason and gains the shared add-a-book link (`DomainAddLink`), unless its Review line (editions that look like this house) is already the next step (SLN-784).
- Review fix: the empty state's button opens the dialog from the header's Add, which outlives the empty state, so focus returns there after an add or Escape.
- Test: `src/__tests__/ui/empty-collection-next-step.test.ts`.

## Completion Notes
Count nouns on collection cards and pages (item 6) are a separate change.
