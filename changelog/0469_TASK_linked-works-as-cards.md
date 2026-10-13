# Task 0469: Linked works as cover cards

**Status**: Completed
**Created**: 2026-10-13
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-637. A work page's "Linked works" listed each linked work as a line of
text ("The Oresteia · Book, Aeschylus", "Source: The book's title") with a bin
icon beside it. Each linked work is now its card, as in the related rows below
it: a book's cover card, or the picture card of a film, perfume or painting.
The link's source, its notes and "Remove link" sit under the card.

## Implementation Details

- `getWorkRelations` (`src/lib/actions/work-relations.ts`) gives each link
  `other.card`, the `SimilarWork` the Similar Works row draws. The cards load
  in two batched reads whatever the number of links: `loadRelatedBooks` for
  the books and `loadRelatedTiles` for the other collections. A work linked
  twice (two types, or both ways) is loaded once and keeps both links.
- `LinkedWorksSection` (`src/components/catalogue/work-relations.tsx`) keeps
  the groups and their labels. Each group is a `catalogue-grid` with
  `catalogue-density-compact` in an `@container`, so a phone keeps two cards
  a row, as the homepage does. Each item spans two subgrid rows, the card and
  its caption, so the cards in a row are one height and the captions start
  level. A book is `RelatedBookCard`, anything else `DomainTileCard`.
- The caption: "Source: ..." (a link with its external mark when the source
  has an address), the notes, and a "Remove link" text button (accessible
  name "Remove link to {title}", a 44px target on touch). It opens the same
  confirmation as before; the removal still keeps both works and the source.
- A linked book's card carries its e-book mark like every other book card.
  The book page adds the linked books to its one availability read; the film,
  perfume and painting pages read them with `linkedWorkEbooks`
  (`src/lib/catalogue/linked-work-ebooks.ts`), which reads nothing when no
  book is linked.
- `docs/04_ROUTES_AND_VIEWS.md`, Linked works.

## Completion Notes

- `work-relations.test.ts`: each link carries the right card (a film's
  poster, a perfume with no picture, a book with its edition), with its
  source beside it; a work linked twice stays two links with the same card.
