# Task 0520: Series show their authors

**Status**: Completed
**Created**: 2026-10-13
**Priority**: HIGH
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview

SLN-636. A series named no author: My Struggle did not say it was Karl Ove Knausgård's. A series page now names its authors under its title, each linked to the person, and the series cards and rows on `/series` name them too.

## Implementation Details

- The authors are read from the series' books, with no new table. The coordinator ruled out a migration for now: migrations from 0089 on have no path to the live database yet.
- `getSeriesAuthors` (`src/lib/actions/series.ts`) reads, in one query for any number of series:
  - only people credited as writer or co-author of a volume (`work_authors` with `WORK_AUTHOR_ROLES`), so a translator or editor (an edition credit) never becomes a series author;
  - each person once, the one with most volumes first, then by name.
- `getSeriesDetail` returns `authors` (id, name, slug, volumes). `getSeriesList` returns each row's author names.
- The series header shows them under the original title. A name links to `/people/[slug]`; a person with no slug is plain text. The cards show the names under the title, wrapped in full; a list row shows them on one line, cut like its title. They are not links, since the whole card or row is one.
- `docs/04_ROUTES_AND_VIEWS.md`: the Series and Series detail sections.

## Completion Notes

Built in the quick-wins thread (as task 0472) and landed from the SLN-631 thread under this number.

What this does not do, because it needs a stored association (a new table):
- authors chosen and edited by hand in the series dialog;
- an author on a series with no books;
- an author that stays when the books change.

Those parts of SLN-636 wait until migrations have a path to live.
