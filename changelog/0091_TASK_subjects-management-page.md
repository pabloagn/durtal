# Task 0091: Subjects Management Page

**Status**: Completed
**Created**: 2026-04-06
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0014
**Blocks**: None

## Overview
Add a dedicated management page for subjects at `/subjects` and include it in the sidebar navigation. Subjects are work-level thematic classifications (e.g. Existentialism, Postcolonialism) linked to works via the `work_subjects` junction table.

## Implementation Details
- Created `src/app/subjects/page.tsx` with two sections: "In use" (subjects with work counts) and "Unused"
- Added `getSubjectsWithWorkCounts` cached server action in `src/lib/actions/taxonomy.ts` using a left join with count aggregation
- Added "Subjects" entry with Bookmark icon to sidebar navigation in `src/components/layout/sidebar.tsx`

## Completion Notes
Page follows the same pattern as `/tags` but adds work count display and in-use/unused grouping. 238 pre-seeded subjects from knowledge base.
