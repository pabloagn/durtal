# Task 0229: Book covers show their art; card text stays together

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview
SLN-399 and SLN-401, part of the app-wide design pass. Every book card carried a status chip on its cover, plus rating, priority and mark chips: up to six chips on the most beautiful part of the card. The chips were translucent black with a blur, so on a white or cream cover the status text lost its contrast. And a one-line title left an empty line between the title and the author, while collection cards cut their description to three words.

Now the cover shows its art. Only the marks that make a copy special (rare, poison, digital edition) sit on it, on an opaque chip. Status and rating move to the info row. The author sits right under the title on every card, and collection descriptions get two lines.

## Implementation Details
- `src/components/shared/card-heading.tsx` (new): `CardHeading`, the title and the line under it. An invisible copy built from the fixed `lines-2` / `lines-1` boxes reserves two title lines and one or two subtitle lines in the same grid cell, so cards of one kind keep one height while the visible title and subtitle take only the lines they need. The title clamps with `line-clamp-2`; the tooltip already shows clamped text in full.
- `src/components/books/card-status.tsx` (new): `CardStatus`, a dot in the status color (cap-height centered with `CapAligned`) and the label in `fg-secondary`; its tooltip adds the acquisition priority and the number of copies, which no longer show on the card. `CardRating`: a gold star (cap-height centered) and the number.
- `src/components/books/book-card.tsx`: the cover keeps the rare, poison and digital marks in the bottom-left corner. The status, priority and rating chips are gone from the cover. Info row: status, the language from 200px of card width, the rating from 160px, the year from 160px (220px beside a rating). The copy count leaves the card face (tooltip and list views keep it).
- `src/components/books/cover-chip.ts`: `COVER_CHIP` is `bg-bg-primary/85` with a 10% white border, no blur. Every export name is unchanged (film and perfume cards import them; they get the same opaque chip). New `COVER_CHIP_STROKE`: Lucide's 1.5 stroke draws a 0.6px line at 10px, so the book marks use 3 (1.25px at 10px, 1.5px at 12px).
- `poison-badge.tsx`: the skull on a cover uses `accent-red-text` (4.8:1 on the chip over a real cover, 3.7:1 over pure white; `accent-red` was 2.7:1 there).
- `src/components/authors/author-card.tsx`: the "N books" badge leaves the portrait for the info row, beside the years. `src/components/series/series-card.tsx`: "Complete" leaves the covers for the info row, in gold. `src/components/collections/collection-card.tsx`: two description lines; the image adjustment button shows on hover and keyboard focus, like the other card controls.
- `src/app/page.tsx` (dashboard): the recent author cards and the "Wanted" cards use the same text layout; the wanted cards show their status as `CardStatus` instead of a badge beside the title.
- Docs: `docs/03_DESIGN_LANGUAGE.md` (Book Cards, Tooltips), `CLAUDE.md` (alignment rules).

## Completion Notes
Measured on `scripts/qa/preview-local.py` with the 2026-10-03 22:08 backup (covers served from the live app's image endpoint), headless Chrome with its own profile, grid view, against the live app on :3100 before.

| Page (1440x900) | Before | After |
|---|---|---|
| `/library`, 48 cards | 80 chips on 48 covers, 53 of them status or rating | 5 chips on 5 covers, all marks; 0 status or rating |
| Dashboard | 31 chips on 20 covers, 24 status | 7 chips on 6 covers, 0 status |
| One-line title to author, every card kind | 27.88px more than after a two-line title | the same as after a two-line title (4px margin) |
| Card heights per kind | book 398.75, author 454.75, series 310.41, collection 449.94-449.97 | book 398.75, author 454.75, series 316.41, collection 473.94-473.97: one height per kind |

- At every slider size (2-8 columns, cards 544 to 124px wide, and 135px on a 390px phone): 0 status labels cut, 0 info rows overflowing.
- `scripts/qa/alignment-audit.js`: 0 rows over 0.5px on `/library`, `/`, `/authors`, `/collections` and `/series` at 1440, 768 and 390px (25-37 rows checked per page at 1440). `scripts/qa/design-audit.js`: 0 low-contrast texts on the same pages.
- `pnpm typecheck` and `pnpm lint` pass; `python3 scripts/qa/test-local.py` results in the PR.
- Not changed here: film and perfume cards still carry chips on their images (their threads own those files); they get the opaque chip.
