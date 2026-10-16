# Task 0750: Every blank picture is the title's letter

**Status**: Completed
**Created**: 2026-10-15
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0654, 0748
**Blocks**: None

## Overview
SLN-830. Design polish pass 4, item 2 (`findings/design-polish-4-2026-10-15.md`).

A missing cover shows the title's letter everywhere (0654, `CoverLetter`). Five places still didn't:
- Films and paintings (cards, list rows, the mosaic, the film and painting pages, a collection's items) showed a framed title card with the name and year (`TitleCard`).
- Perfumes showed a drawn bottle with two initials on its label ("SP", `Flacon`), on cards, rows, formulations and the dashboard.
- Places' cards showed "MUSEUM / Online": the kind, and "Online" for any place without an address (`PlacePlate`). The place's own page already showed the letter.
- The Books and Collections mosaics still used the title card.

## Implementation Details
- `FilmPoster`, `PaintingImage` and `PerfumeImage`: with no picture, `CoverLetter` in a `COVER_BLANK` box. Their `small` prop (a title card or bottle with no lettering) and `year` prop are gone, and every caller drops them.
- `VenueCard`: the name's letter. A place's own color stays the frame's background.
- `DomainTileCard` (the dashboard's recent additions, similar works, related works): the letter for every kind, perfumes included, instead of the bottle or a monogram.
- `library-view.tsx` and `collections-view.tsx` mosaics: the letter. A collection with members' covers keeps its fan.
- `src/components/shared/no-photo.tsx`: `TitleCard`, `Flacon` and `PlacePlate` are removed, with the `flacon` utility in `globals.css`. People keep their initials (`Monogram`), and series their shelf of spines.
- Docs: `docs/03_DESIGN_LANGUAGE.md` (Cards without a photo, type sizes, page weight) and `docs/04_ROUTES_AND_VIEWS.md` (film, perfume and painting cards).
- Test: `src/__tests__/ui/blank-pictures-letter.test.ts`.

## Completion Notes
See the PR's checks.
