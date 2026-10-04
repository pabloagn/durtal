# Task 0223: Painting Gallery, Large-Image Detail and Original-Location Editing

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0213 (film pages, SLN-367: the shared catalogue components)
**Blocks**: SLN-379, SLN-380, SLN-381

## Overview

SLN-368. The painting model (SLN-359), whereabouts (SLN-360) and their services were on main, but `/paintings` was a generic tile home with no detail page, no form and no way to record where an original is. This task builds the painting screens. The collection stays closed: opening it (the switch and the database check) is a separate change.

## Implementation Details

**Home** (`src/app/paintings/page.tsx`): a gallery of painting cards with search, sorts, grid and list views, paging, and filters by painter, movement, genre, technique, medium, support, owning institution, current venue, what you own, favourites and date range.

- `src/lib/catalogue/painting-params.ts`: the URL query, unknown values dropped. `src/lib/catalogue/domain-switch.ts` keeps these filters when switching to Paintings (the painting line only).
- `getPaintingFilterOptions` (`src/lib/actions/paintings.ts`): each option with the number of paintings it matches; a broader family item counts its narrower ones, objects included.
- `PaintingCard` / `PaintingRow` / `PaintingGrid` / `PaintingFilters` (`src/components/paintings/`). The card frame is a fixed 4:5, contained, so cards of a grid share one height; `loadPaintingCards` now returns the picture's tone.

**Detail** (`src/app/paintings/[slug]/page.tsx`): the picture in its own proportions (image, else the original's size; kept between 1:3 and 3:1), about half the page wide and at most 78vh tall, beside the identity; stacked on a phone. The identity names the painters with their attribution, the date, movements, the original's owner, where it is now (custody, display, since, how long ago checked; stale after a year) and what you own. The reading column lists the original and versions, then reproductions, each with owner, holding and location history; the record column has details, classification and media.

**Editing**:
- `PaintingForm`: title, painters (attribution; "Unknown"), date, movements, the four painting families, description. Items of other families are kept on save.
- `ArtObjectDialog`: original, version or reproduction (explicit control; a reproduction may name the object it reproduces), date, size, own attribution, owner (institution with collection and accession, private collection, you, unknown); an object you own adds status, storage, acquisition and disposal.
- `WhereaboutsDialog`: move, loan, return (to the last permanent-collection venue), history entry (any certainty and period) and edit. Places: venue, private, unknown, lost, destroyed; custody choices follow the place. "Checked today" stamps the record. History items can be edited, checked today or deleted.
- `PaintingActions`: edit, images, delete (blocked while you own objects of it).

Pure helpers in `src/lib/catalogue/painting-labels.ts` (names, owners, places, sizes, frame ratio, painter input). `getPaintingChoices` lists the art movements.

Shared pieces come from the film work (SLN-367, commit 7dff304): `src/components/catalogue/*`, `TitleCard`, `TaxonomyAssignments`, and `ChoiceListField` from `src/components/films/film-fields.tsx`. No shared component is copied.

## Completion Notes

Built on the films branch (commit 7dff304, PR #12), so this PR merges after it. The collection stays closed; no migration.

**Verification:**

- `pnpm typecheck`: passes. ESLint on the new and changed files: 0 problems.
- `python3 scripts/qa/test-local.py`: **1,512 tests across 110 files pass, 0 failed, 0 skipped**, plus the Python book-ingestion checks. New: `painting-home.test.ts` (names, owners, places, sizes, frame ratio, painter input, URL query, collection switch) and a `painting-services` case for the filter options and movement choices. The URL test found a duplicated item when one id was listed under two family keys; the query now lists it once.
- Browser, on `scripts/qa/preview-local.py` with the painting switch turned on locally and the kind check dropped in the disposable database only: added "The Garden of Earthly Delights" (painter created from the search, 1490–1510, a movement, a technique); added its original (205.5 × 384.9 cm, Museo del Prado, P002823); recorded a move (Prado, permanent collection, on display, since 1939), a loan (Noordbrabants Museum, exhibition, 2016; the Prado record closed on 2016) and its return (Prado, 2017); added a museum poster reproduction of the original that you own (€25.00). The header showed the original's owner, where it is now and the poster in the collection. A tall painting (91 × 73.5 cm), a square one (79.5 × 79.5 cm, private collection) and a lost one with a probable contradicting claim rendered as expected.
- `alignment-audit.js` and `design-audit.js`, headless with an own profile, on the home, the home filtered by holding, the add page and four detail pages at 1440, 768 and 390 px: 0 deviations over 0.5 px, 0 low-contrast texts, 0 unnamed or nested controls, no horizontal scroll, no console errors.

**Not in this task:** opening paintings (the switch and a migration widening `works_kind_enabled_check`); object classification in the object dialog (an object inherits the painting's techniques, media and supports, and existing object items are kept on edit); painting pictures need the S3 media manager, which the local preview has no access to. `DomainHome` (`src/components/domains/domain-home.tsx`) is no longer used by any route now that films, perfumes and paintings have their own homes.
