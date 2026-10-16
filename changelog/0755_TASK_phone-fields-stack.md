# Task 0755: Fields side by side stack on a phone, so their values show whole

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-848. Design polish pass 5, item 2 (`findings/design-polish-5-2026-10-15.md`).

Pairs of fields stood side by side at every width and cut their values on a phone:
- Edit work, at 390 and 320: the Series field read "Les Vies de Dur…", and the Goodreads and StoryGraph placeholders were cut.
- Edit person, at 320: Gender and Nationality read "Not spe…", and the birth and death place searches read "Search a…".
- Settings > Display, at 320: every list's selects were cut ("6 per r…", "48 per p…"), 12 values over nine lists, in all three browsers.

## Implementation Details
- Edit work and Edit person: each pair stands side by side from the `sm` width (640px), where the dialog gives each field room; below it they stack, one a row. This covers `work-form.tsx` (language and year, work type and anthology, the two statuses), `series-fields.tsx` (series and position), `book-links-fields.tsx`, and `author-form.tsx` (first and last name, gender and nationality, the birth and death places, the two catalogue IDs).
- Settings > Display (`display-settings.tsx`): below a 22rem card each list's selects stack under its name, one a row. From 22rem they share a row under the name, and from 640px they keep their columns beside it.

## Completion Notes
See the PR for the browser checks.
