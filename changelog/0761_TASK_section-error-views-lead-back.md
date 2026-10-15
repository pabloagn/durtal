# Task 0761: Places, organizations, recommenders, taxonomy and locations errors lead back

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0612, 0619
**Blocks**: None

## Overview

SLN-813, from the third loading and error states survey
(`findings/survey-loading-3-2026-10-15.md`, item 4). Five sections had no
error view of their own. Their failures fell through to the catalogue's view,
which said only "An error occurred while loading this page." and led to the
dashboard. The sections were Places, Organizations, Recommenders, Taxonomy
and Locations.

## Implementation Details

Each section gets an `error.tsx` built on `ListSectionError`, as Collections,
Publishers and (since 0619) Series have:
- **The list** says "<Section> could not be loaded." and leads to the
  dashboard.
- **A record** says "This place / organization / recommender / family could
  not be loaded." and leads back to the list.
- **A deeper page**, such as a taxonomy item, leads back to the list.
- **Locations** has only its list.

Try again is primary and the way back secondary, through `SectionError`.

Test: `src/__tests__/ui/loading-audit-states.test.ts` gains a row per view.

## Completion Notes

- Typecheck is clean, and the error view tests pass.
- No migration, no new package.
