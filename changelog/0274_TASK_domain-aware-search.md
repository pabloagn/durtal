# Task 0274: Domain-Aware Search, Lists and Counts (SLN-371)

**Status**: In Progress
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: SLN-364 (collection homes), 0202 (perfumes), 0213 (films), paintings
**Blocks**: SLN-379, SLN-381

## Overview
The command palette searched every work but showed each as a book and opened
it under `/library`, so a film or a perfume opened a page that does not exist.
People who are not writers opened an author page that refuses them. The
palette now groups works by collection, opens each in its own collection, and
adds people, organizations and places with the page each has today.

## Implementation Details

**Search** (`src/lib/actions/quick-search.ts`, `quickSearch`):
- Works: one query over the open collections, ranked by the shared text
  search, up to five per collection (`row_number() over (partition by kind)`),
  ties broken by title and id. The search text is the title, series and the
  names the work is credited to: book authors; film directors and writers;
  perfumers and the perfume's houses; painters (credited-as names count). ISBN
  still finds a book. Each result carries its collection, address
  (`WORK_DOMAINS[kind].basePath`), makers in the collection's terms and its
  picture (the active poster, else a book edition's cover).
- People: by name or other name (`person_aliases`), with their roles (an
  edition contributor shows their most frequent edition role, such as
  "Translator"). A person
  with books opens `/authors/[slug]`; anyone else opens their collection's
  list filtered to them. A person with no credit is left out: no page shows
  them yet.
- Organizations: by name or other name; a publishing profile opens
  `/publishers/[slug]`, a perfume house or brand `/perfumes?house=`, a museum
  or gallery `/paintings?institution=`. Others are left out until the
  organization pages (SLN-369) are on main.
- Places: by name or address, archived venues left out.
- No new SQL pattern: every match goes through `textSearchCondition`, whose
  words are `search_normalize`d letters and digits, so `%` and `_` are never
  wildcards and accents never matter.

**Palette** (`src/components/layout/command-palette.tsx`): a group per open
collection (headings from `WORK_DOMAINS`), then People, Organizations and
Places; the best match is selected first. The placeholder reads "Search the
catalogue, or type a command...".

**Lists**: the film, perfume and painting homes already filter and sort in SQL
before paging, end every order with the work id and count on the same
predicate (tasks 0202, 0213 and the painting gallery). No change was needed;
the new tests pin it for every film sort.
