# Task 0835: Removes keep the focus

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0834 (SLN-1028)
**Blocks**: None

## Overview

SLN-1029, from findings/focus-survey-2026-10-18.md (cause 3) and findings/recommenders-acquisitions-survey-2026-10-18.md (item 3). A remove with no confirmation, or one whose list FocusKeeper did not know about, took its row and the focus fell to the page body: a work's linked work, a source, an acquisition target, a venue's institution.

## Implementation Details

- `work-relations.tsx`, `sources-section.tsx`, `acquisition-targets.tsx` and `places/[slug]/venue-institutions.tsx` mark their lists `relations`, `sources`, `acquisition-targets` and `venue-institutions`, each row, and the section's Add (`data-focus-empty`). The focus goes to the next row's Remove, else the one before, else the Add.
- A book page leaves out its Linked works section once the last link goes, and keeps Link a work in its actions menu. `EntityActionMenu` takes `focusEmpty`, and the book's menu takes the focus then (`work-actions-menu.tsx`).
- `focus-keeper.tsx`: a list's rows are its outermost rows. A linked book's card marks itself a row (0834), inside the link's row, so the index counted both and the focus could land on the card's link instead of the next Remove. `placeOf` takes the row of the list around the focus, walking out past a list inside a row.
- The source and target Removes are busy, not disabled, while they run, so the focus stays on them until the row goes. The source Remove is 44px on touch, as a chip's cross is (it was 20px).
- Remove target hides its row as soon as the action succeeds. The action revalidates the page, but the new list it brought was sometimes dropped on the book page, with or without a `router.refresh()` of its own: in about half the presses in Chromium, Firefox and WebKit the removed target stayed on the page until a reload (the database had it cancelled, and the server rendered the new list). Removed from the transition too, so a stuck refresh never holds every control busy.
- The notification centre was already done in #499 (SLN-922).

## Completion Notes

Checked in Chromium, Firefox and WebKit at 1440 on the preview: after each remove (first of three, second of two, the last) the focus is on the next row's Remove, the row before's, or the section's Add; on a book page, on its actions menu after the last link. Alignment, design, overflow, layout and touch audits clean on a book page, a film page and a venue page at 1440, 390 and 320; page weight passes. Typecheck, lint and unit tests pass; the book page reading, film sources, typed acquisitions, venue pages and work relations database suites pass. A new FocusKeeper test covers a row's own card, and fails on the old row counting.
