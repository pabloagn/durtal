# Task 0866: Bound the reading hub and book history

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: HIGH
**Type**: Performance
**Depends On**: SLN-930
**Blocks**: None

## Overview

The reading hub serializes every open reading, and a book page sends every historical reading to its dialogs. Show eight current and eight paused cards, and the open reading plus four recent closed readings on a book. Keep older history reachable through the existing journal and a bounded note chooser.

## Implementation Details

- Select bounded IDs before card/detail enrichment. Preserve all-history ordinals, counts, dates, duration, ratings summary and Start defaults in one book overview query. Refuse duplicate open readings rather than silently choose one.
- Keep the dashboard and palette's existing open-reading contract. Fetch reader links only for the hub's selected works and pace data only for its selected current readings; global pace priors remain unchanged.
- Load an explicitly selected older dialog target with its original full-row fingerprint. The independent timer can still open and stop a reading outside the hub's visible rows.
- Reuse the journal with a validated exact-work filter, shared pagination and matching export scope. Add current Log and paused Resume actions. The book-history return uses the existing NavigationFocus observer, opting in only with #reading and a marked Reading section.
- Let notes choose older readings twenty at a time, retaining an off-page selection, true ordinal and edition label. Keep manual edition/position text, and fence dismissed or superseded loads.
- Reset the nested older-reading chooser's inherited dialog scope so it owns Escape and restores its actual pointer opener; an unavailable selected option cannot detach a note.
- Author guarded PostgreSQL and mounted UI regressions. Full 1k/5k history/statistics and latency acceptance remain a separate phase under task 0867; SLN-930 remains open.

## Completion Notes

Source prepared only. Database tests, full typecheck, normal production build, alignment, design and page-weight acceptance remain pending explicit validation grants. No deployment, live database or runtime changes.
