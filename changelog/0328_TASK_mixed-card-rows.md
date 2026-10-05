# Task 0328: Mixed card rows

**Status**: Completed
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
- `DomainTileCard` (the dashboard's tiles for films, perfumes and paintings) is cut like a book card: `WorkCardArt`, `CardHeading`, `WorkCardInfo` with the rating and the date. `DomainTile` carries the rating and the picture's tone (`src/lib/catalogue/domain-homes.ts`).
- `PerfumeCard`, `FilmCard`, `PaintingCard`: `CardHeading` (title with the favourite star, then the house, directors or painters) and `WorkCardInfo` (rating, release or creation date) replace their three free lines. They keep their own frame in their own grids. No status: a film, perfume or painting keeps the books-only catalogue_status at its compatibility default, tracked (works_nonbook_lifecycle_check), so every one of them would read Tracked, which on a book means not owned.
- Related films and perfumes put the reason ("With Kurt Russell") under the card, as related books do, instead of in the facts line.
- Removed `DomainHomeShell` and `DomainTileRow` (`domain-home-shell.tsx`, `domain-tile.tsx`): no page used them; the collection homes have their own grids.
- Docs: `docs/03_DESIGN_LANGUAGE.md`, Work cards.

## Completion Notes
Where collections mix: the code search of the 12 places in SLN-478 finds one row that mixes card types, the dashboard's recent additions. Collections already give every member one 80x128 frame and fixed lines (`MemberCard`); organization pages give each collection its own row; recommender, taxonomy, people and publisher pages and the work carousels show books only.

Checked on a production build (`pnpm build`, `preview-local.py --start`, a backup of the catalogue with one perfume without a picture, one film and one painting among the newest additions, pictures read from localhost:3100), in Chrome, Safari and Firefox at 1440, 768 and 390px:
- Dashboard: in every row of cards, every card has one height and its title and info row sit at the same offsets (largest spread 0.02px). At 1440px each card is 538.75px tall, title at 408px, info row at 503.75px, books and the perfume, film and painting alike.
- `/perfumes`, `/films`, `/paintings` (grid): one height per row, the same offsets (spread 0).
- `alignment-audit.js` and `design-audit.js` on all four pages: 0 deviations, 0 low contrast, 0 unnamed controls; no sideways scroll.
- `page-weight.js`: `/` 247 / 300 KB, `/library` 299 / 300 KB, every other route within budget. `/reading/import/*` has no page to measure on the backup (no import there), so the script reports no link.
- `pnpm typecheck` clean, lint 0 errors, `test-local.py` 2,126 tests pass (on main 862f87b merged in).

Review fixes: film, perfume and painting cards show no status (every one read Tracked, the books-only default), so the card queries no longer return catalogueStatus; the year in the info row drops whitespace-nowrap, which its shrink-0 parent made redundant, so book cards weigh what they did on main.
