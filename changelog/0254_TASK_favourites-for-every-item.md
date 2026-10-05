# Task 0254: Favourites for Every Item (SLN-426)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0043 (shared curation, `works.is_favourite`)
**Blocks**: None

## Overview
Every item can be starred as a favourite with one click, and every list can
show only favourites. One star component, one server action and one URL
parameter serve books, films, perfumes, paintings, people, collections,
series, recommenders, places, publishers and organizations.

## Implementation Details
- Data: migration `0061_favourites` adds `is_favourite BOOLEAN NOT NULL
  DEFAULT false` to `authors`, `collections`, `series` and `recommenders`. It is
  additive: no existing row changes. `works.is_favourite`,
  `publishing_houses.is_favourite` and `venues.is_favorite` (US spelling kept,
  mapped in code) already existed. Organizations are publishing houses with
  roles, so they share that column. `docs/02_DATA_MODEL.md` lists the columns.
- Server: `src/lib/actions/favourites.ts`. `setFavourites({ entity, ids,
  favourite })` validates its input with zod, writes only the rows that
  change and returns how many. `setFavourite` does one item and throws when
  there is no such item. Publisher paths keep to houses with a publisher kind,
  as before. Work and person changes go to the activity log
  (`work.favourite_changed`, `author.favourite_changed`); so do the favourites
  saved through a film, painting or perfume's curation.
- One control: `src/components/shared/favourite-toggle.tsx`. Lucide `Star`,
  1.5px stroke, 16px, `accent-gold`, filled when on. The path is drawn once
  per page (`favourite-star.tsx`, in the root layout) and each star is a
  `<use>` of it, so a star costs about 510 bytes of HTML instead of 1.1 KB.
  It flips at once and turns back with a toast when the save fails. `aria-pressed`, an
  `aria-label` with the item's name and a `data-tooltip`. On a detail page it
  takes `shortcut`: F toggles it (registered with `useShortcut`, so it shows
  under "This page" in the shortcuts sheet) and its tooltip shows the key.
  The publishers' `favourite-button.tsx` and the curation heart are gone:
  publishers, places and `CurationFavourite` (films, paintings, perfumes) use
  this one.
- Cards: `CardHeading` takes an `action`, placed on the cap-height center of
  the title's first line. Cards whose whole body was one link (books, people,
  films, perfumes, paintings) now use a link layer under the text, so the star
  is not a control inside a link. The films', perfumes' and paintings' heart
  chip on the cover is replaced by the star beside the title. Book covers keep
  only the rare, poison and digital marks.
- Rows: the star sits after the row's link (books and people on the title's
  cap-height center, beside the copy button and the actions menu).
- Detail pages: books, people, places, publishers, collections, series,
  recommenders, films, paintings and perfumes.
- Filters: Favourite joins `WORK_MARKS`, so the books' Marks group, the
  publisher page's book list, the book page rows ("Other Favourites") and the
  bulk Marks menu include it. People, places, collections, series and
  recommenders filter with `?favourites=true` (`FAVOURITES_PARAM`; places
  moved from `?favorite=`). Collections, series and recommenders, which had no
  filter menu, get `FavouritesFilter`. Films, paintings and perfumes keep
  their existing Favourites filter.
- Bulk: books through the Marks menu; people through `FavouriteBulkMenu`.
- Tests: `src/__tests__/integration/favourites.test.ts` (database:
  `sln426_test`) covers the bulk and single action, the activity log, each
  list filter and count, the places column, the publisher boundary and bad
  input. `marks.test.ts` and `organizations.test.ts` follow the changes;
  `work-kind-migration.test.ts` and `image-adjustment-migration.test.ts` now
  accept the new `is_favourite` columns (always false after the migration).

## Completion Notes
Checked on a disposable local database (`scripts/qa/preview-local.py`) with
seeded items: one click stars and unstars and the state survives a reload;
`?favourites=true` and the Marks group return the right items and counts; F
toggles the star on detail pages. `scripts/qa/alignment-audit.js` and
`scripts/qa/design-audit.js` on the library, a book, people, a person, places,
a place, collections, a collection, series, a series, recommenders, a
recommender, publishers and a publisher at 1440, 768 and 390px, and films, a
film, paintings and perfumes at 1440px: no deviation over 0.5px from the star, 0 unnamed and 0
nested controls, no sideways scroll. The one alignment report on the book
page (the Add to collection icon in an edition row, 8.69px) is older than this
task. Lint: 0 errors; typecheck passes; `pnpm test:local` passes.

Page weight (`scripts/qa/page-weight.js`, on the live app at `main`): `/` is
at 298 of 300 KB, so the dashboard's book cards show no star. `/library` is
already over its budget on `main` (321 of 300 KB); its 48 stars add about
24 KB. Lists of people, series and collections stay well under theirs.

Not done here: the library's Detailed (table) view has no star column.

Migration 0061 is not applied to the live database by this task: it needs the
backup and rehearsal the issue asks for before it goes live.

Not in scope, as the issue says: orders, copies, editions, taxonomy terms and
storage locations. Organizations have no list or page yet, so their star has
no place to show; the action supports them.
