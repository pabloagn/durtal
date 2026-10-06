# Task 0353: SLN-410 Author enrichment, pass 2: the people without books

**Status**: In Progress
**Created**: 2026-10-06
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0204
**Blocks**: None

## Overview

Task 0204 enriched the 407 authors with books from Wikidata. This second
pass is for the people without books: the canon of directors, painters,
theorists and other people the catalogue knows by their roles (1,744 in the
6 Oct backup). This task lands the code. The dry run, the review, the backup
and the apply on live wait for the owner's go-ahead.

## Implementation Details

- **Roles as evidence** (`roleCheck`, `ROLE_FIT` in
  `src/lib/authors/enrichment.ts`): the roles the catalogue gives a person
  (`author_contribution_types`) are checked against their Wikidata
  occupations and description. A fit counts as evidence; a misfit holds the
  match; among several close candidates the medium pick is the one person
  whose occupation fits. Roles that name no profession (patron, subject)
  are not checked. The script loads the occupation labels, and skips the
  works query for a person without books.
- **`--scope canon`** (`CANON_SCOPE_SQL`): no `work_authors` row, in the
  book directory (`person_domains` 'book'), and not someone credited only on
  films, paintings or perfumes. `work_credits` holds non-book works only, so
  a person there stays only with an edition credit
  (`edition_contributors`). A canon director now credited on a film, with
  nothing in books, is left out.
- **Julian days**: a Julian statement whose Gregorian day is the stored one
  agrees, and a missing month is the Gregorian one (Pushkin: Wikidata's 26
  May 1799 Julian is the catalogue's 6 June). Not when the two calendars put
  the day in different years (25 December 1642 Julian is 4 January 1643).
- A reviewed correction can set the circa flag (`approximate`), so the
  review can record Lie Yukou (stored as 450 to 375, positive) as c. 450 to
  375 BC.
- The report names the roles, birth year and nationality of a held person
  without books, and lists every twin of an author with books.
- `docs/02_DATA_MODEL.md`, authors: roles as evidence, the Julian day rule
  and the canon scope.

## Completion Notes

- Scope on a copy of the 6 Oct 20:13 backup: the old canon scope has
  1,744 people, the new one 1,743. The one left out is a perfumer. Live has
  no film or painting credits yet.
- Tests: the author enrichment unit tests (36) and the new database suite
  `author-enrichment-scope` pass. `pnpm test`: 160 files pass, 78 database
  suites skipped. `test-local.py`: 2,626 of 2,627 tests pass. The one
  failure, twice, is the reading timer test ("expected 299 to be greater
  than or equal to 300"), which this task does not touch: `pauseTimer`
  stores the app's clock and `resumeTimer` subtracts it from Postgres's
  `now()`, so a database clock a few milliseconds behind gives 299.
- Typecheck is clean; lint has 0 errors.
- Not yet run on live: no dry run against live, no backup, no apply. The
  Wikidata cache from the 3 Oct dry run is kept at
  `~/personal/durtal-backups/author-research/wikidata-cache.json`.
