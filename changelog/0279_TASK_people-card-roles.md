# Task 0279: People cards say what each person is

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0278
**Blocks**: None

## Overview

SLN-420. A person card showed a photo and a name only. Every person card now
has a role line: "Director · Screenwriter", "Author · Translator +1".

## Implementation Details

- `src/lib/catalogue/person-roles.ts`: `formatPersonRoles` puts the role with
  the most credits first (the open collection's roles before the others), shows
  two, then "+N", and gives the full list for the tooltip. One label shows once
  across collections. No credits: no line text, never "Unknown".
- `getPersonRoles(ids)` (`src/lib/actions/authors.ts`): every card's roles in
  one grouped query, with credit counts, from `work_authors`,
  `edition_contributors`, `work_credits` and a variant's own perfumers. Labels
  come from `credit_roles` (the registry in `src/lib/catalogue/credits.ts`).
- `PersonRoles` (`src/components/people/person-roles.tsx`): one 12px line in
  `fg-secondary`, `lines-1`, with a `data-tooltip` when roles are hidden. The
  line is always there, so cards with and without roles keep one height.
- Where: the People grid card and list row, a Roles column in the table view,
  and the dashboard's Recent people. Filtered to one collection, the People
  cards put that collection's roles first. Film and perfume pages list people
  under their role headings already, so they need no line.

## Completion Notes

- Tests: `src/__tests__/catalogue/person-roles.test.ts` and
  `people-credits.test.ts` (`getPersonRoles`).
- Browser: Chrome, Safari and Firefox 157 at 1440, 768 and 390 px, with a
  writer, a writer who translates, a director (and screenwriter), an actor, a
  perfumer, a painter and a person with no credits. All grid cards share one
  height, all list rows share one height. Alignment and design audits: no
  deviation. The low-contrast findings are the decorative initials of
  portrait placeholders, which predate this task.
- `node scripts/qa/page-weight.js`: 17 of 17 routes within budget.
