# Task 0911: Lists share one toolbar, and people cards count every work

**Status**: Completed
**Created**: 2026-10-18
**Priority**: LOW
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-1025, items 1 and 2 (from items 10 and 11 of
`findings/kinds-parity-survey-2026-10-16.md`). The other items of the ticket
(card actions, Copy and Export, the Detailed view and Select for films,
perfumes and paintings) follow in their own PRs.

- **Toolbar.** Films, perfumes, paintings, organizations and places put the
  pager in the middle of the count row and Per page at the right; people put
  them straight after the count. At 1440 Books' view switch wrapped onto a
  second row, because its eight sort chips did not fit.
- **People cards.** An author's card counted their books ("2 books"); a
  director, actor, perfumer or painter showed no count at all.

## Implementation Details

- `shared/pagination.tsx`: above the list (`compact`) the count, the pager
  and Per page pack from the left, and the list's action (Select) sits at the
  right, on every list. The pager below the list still spreads across the row.
- `shared/entity-filters.tsx`: a list with more than six sorts picks its sort
  from the menu and direction arrow that phones already use, at every width.
  Only Books has more than six, so its toolbar now fits one row at 1440. The
  other lists keep their chips.
- `getPersonWorkCountsByKind` (`lib/actions/authors.ts`): the works each person
  is credited on, per collection, with the same credits as
  `getPersonWorkCounts` (written, edition contributions, film and painting
  credits, perfumers), each work once. The People page reads it in place of
  the total and sums it for the table's Works column, so it is still one query.
- `formatWorkCounts` (`lib/catalogue/person-roles.ts`) and `WorkCounts`
  (`components/people/person-roles.tsx`): "14 films · 1 perfume", in the
  collections' order, broken only after a "·". The person card and the
  People list row show it in place of "N books"; in the row it takes the next
  line when it does not fit beside the nationality.
- `docs/03_DESIGN_LANGUAGE.md`: the sort menu rule and the count row.

## Completion Notes

- Tests: `formatWorkCounts` (2 cases), the per-collection counts in
  `people-credits.test.ts`, and Books' sort tests now use the menu
  (`library-sort.test.ts`, `library-busy.test.ts`), with a case that a short
  list keeps its chips.
- Browser audit (alignment, contrast, overflow, touch) on /library, /people,
  /films, /perfumes, /paintings, /organizations, /places and /publishers at
  1440, 390 and 320 in Chromium, Firefox and WebKit: 72 of 72 loads pass.
  Every list's toolbar is one row at 1440. Page weight passes.
