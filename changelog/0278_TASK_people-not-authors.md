# Task 0278: People, not authors

**Status**: Completed
**Created**: 2026-10-04
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: 0279

## Overview

SLN-419. Durtal holds books, films, perfumes and paintings, but the people
section still said "Authors" and showed only the people of books. It is now
People: every person of every collection, under `/people`.

## Implementation Details

- Routes: `src/app/authors` moved to `src/app/people` (one commit, no logic
  change). `next.config.ts` redirects `/authors` and `/authors/:path*` to
  `/people` permanently (308). Slugs did not change. `/api/authors` stays.
- Words: sidebar, page titles, headings, search, empty states, dialogs
  ("Add Person", "Merge"), toasts, the command palette, shortcut labels and
  the activity lines say person or people. "Author" stays where it means the
  writer of a book (book credits, the book forms).
- List: every person, not only book people. Two new filters: Collection
  (`person_domains`) and Role (any credited role, "Films: Director"), each
  choice with its number of people (`getPeopleFilterOptions`). The role
  filter reads every credit: `work_authors`, `edition_contributors`,
  `work_credits` and a perfume variant's own perfumers (`PERSON_CREDITS`,
  `src/lib/catalogue/person-boundary.ts`). The map and timeline stay book
  views (places and dates).
- Person page: works for every person. The record has a Credits group
  ("Books: Author 12, Translator 3", "Films: Director 2"). Films, perfumes and
  paintings each get a section listing the works, linked, with the person's
  roles (`getPersonWorkCredits`). A person with no books has no book sections.
- Deleting a person with no books goes through the shared deletion
  (`deletePerson`), which refuses while they still have credits.
- Links: the activity log and the search box link every person to their page (`/people/…`); a director with no book used to open the films list.
- Docs: `docs/04_ROUTES_AND_VIEWS.md`.

## Completion Notes

- Tests: `people-credits.test.ts` (the list covers every collection; the
  collection and role filters; the filter counts; a director's page and
  credits; deleting a person with no books) and `domain-search.test.ts`.
- Browser: Chrome, Safari and Firefox 157, at 1440, 768 and 390 px, on a
  preview with a director, an actor, a perfumer and a painter. `/authors`
  lands on `/people`; no "Author" or "Authors" on the page; "Search people...",
  "Showing … people", "Add Person"; each person page shows its collection,
  the Credits group, and no book section; the Role filter returns the
  director and the perfumer. Alignment and design audits: no deviation in
  Chrome and Firefox. Two findings that predate this task: the portrait
  placeholder's initial is decorative (`fg-muted/20`), and in Safari the
  header's Actions button sits 0.55 px off the title's cap-height center
  (the shared `CapAlignedControls`, on every detail page).
