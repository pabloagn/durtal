# Task 0328: Mixed card rows

**Status**: In Progress
**Created**: 2026-10-05
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-478. Joris: "The cards are fucked. You designed a perfume card that does not play well with the other cards for other content." The dashboard's "Recent additions" row put a perfume beside three books: a short square frame, a title about 130px higher than the books' titles, a floating house name and no info row. Every work card now has one anatomy, the book card's, so cards of different collections line up.

## Implementation Details
- `src/components/shared/work-card.tsx` (new): `WORK_CARD` and `WORK_CARD_BODY` (the card and its text padding), `WorkCardInfo` (the book card's info row: status or reading, language, rating, year) and `WorkCardArt` (a 2:3 frame that contains any picture whole over a blurred, dimmed copy of it, or a stand-in).
- `BookCard` takes its info row from `WorkCardInfo`: the same markup, in one place.
- `DomainTileCard` (the dashboard's tiles for films, perfumes and paintings) is cut like a book card: `WorkCardArt`, `CardHeading`, `WorkCardInfo` with the status, the rating and the date. `DomainTile` carries the status, rating, tone and the count held (`src/lib/catalogue/domain-homes.ts`).
- `PerfumeCard`, `FilmCard`, `PaintingCard`: `CardHeading` (title with the favourite star, then the house, directors or painters) and `WorkCardInfo` (status, rating, release or creation date) replace their three free lines. They keep their own frame in their own grids. The card queries return `catalogueStatus` (`perfume-store.ts`, `film-store.ts`, `painting-store.ts`).
- Related films and perfumes put the reason ("With Kurt Russell") under the card, as related books do, instead of in the facts line.
- Docs: `docs/03_DESIGN_LANGUAGE.md`, Work cards.

## Completion Notes
SUMMARY
