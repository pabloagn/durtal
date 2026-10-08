# Task 0392: The dashboard's Wanted shelf, and a person's films, perfumes and paintings, show cover cards

**Status**: Completed
**Created**: 2026-10-07
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-542, Joris's report. The dashboard's Wanted shelf showed each wanted
book as a text box (title, author, status, language, year) while Recent
additions and Highest rated, on the same page, show the library's cover
card. Its View all, `/library?status=wanted,shortlisted`, already shows
covers in every view.

A sweep of every page for other text boxes standing in for cover cards
found one more: a person's page lists their films, perfumes and paintings
as text rows with role badges, under a grid of book cards.

## Implementation Details

- `src/app/page.tsx`: the Wanted shelf renders `BookCard` through
  `workToCardProps`, the mapping Recent additions and Highest rated use: the
  active poster, else the edition's cover, else the card's placeholder
  letter. Its four unused imports go.
- `src/lib/actions/works.ts`: `getLibraryStats` gives the wanted works
  `readingExtras`, as the other two shelves have it, so a wanted book being
  read shows "Reading 44%" as it does in the library. The same fields join
  `wantedWorks` in `GET /api/stats`, as `recentWorks` already has them.
- In `getLibraryStats` the three shelves' cards take a work's first edition
  in the library's order (`createdAt`, then `id`). They took `limit: 1` with
  no order, so after an edit to a work's first edition PostgreSQL could hand
  back its second, and a shelf showed that edition's cover, year and
  language while the library showed the first's (found in review).
- `src/app/page.tsx`: the shelves' cover addresses carry the library's
  version (`&v=`, the poster's `createdAt`, else the edition's
  `updatedAt`), so the dashboard and the library ask for the same address
  and the browser keeps one immutable copy instead of checking each cover
  again on every visit. `getLibraryStats` loads those two dates.
- `src/app/people/[slug]/page.tsx`: the films, perfumes and paintings a
  person is credited on load through `loadFilmCards`, `loadPerfumeCards`
  and `loadPaintingCards` (as `/collections/[id]` does) and show as
  `FilmCard`, `PerfumeCard` and `PaintingCard` in the books grid's columns.
  The person's roles ("Director", "Cast, Screenwriter") are a caption under
  each card, as on the related rows of a film or perfume page. Every credit
  still shows; the order is the credits' order.
- `src/app/people/[slug]/author-detail-header.tsx`: the portrait
  placeholder's letter is decoration (`aria-hidden`, `data-decorative`), as
  the book card's is. A person with no portrait and no books (most
  directors and perfumers) failed the design audit's contrast check on it.
  #163 (SLN-513) made the same change and landed first; the merge keeps its
  copy.

No schema change, no new package.

## Completion Notes

- `src/__tests__/integration/reading-library.test.ts`: the wanted shelf's
  paused book carries `readingState` and `readingPercent`, and
  `cardReadingOf` reads them. It fails on main and passes here. A second
  test gives a wanted book two editions, corrects the first's year, and
  expects the Wanted card and the library card to show the first's cover:
  it fails without the edition order and passes with it.
- Production builds of main (0517d385) and this branch on the preview's
  synthetic catalogue, with the eight wanted books of Joris's screenshot
  added, five of them with a synthetic cover, and `--seed-large 50` for the
  person page (seed-person-429: 14 films, a perfume and a painting, eight
  with a synthetic poster):
  - `/`: the Wanted shelf shows eight cover cards, three of them with the
    placeholder letter. Page weight 152 KB on main, 154 KB here.
  - `/people/seed-person-429`: 16 cards instead of 16 rows, 74 KB on main,
    175 KB here (about 6 KB a card, as a library card; the budget is
    400 KB).
- Headless Chrome 141, Firefox 142 and WebKit 26 (Playwright 1.56.1) at
  1440, 768 (mouse) and 390 px (touch) on `/`, `/library`,
  `/library?status=wanted,shortlisted`, `/people`, `/people/ernesto-sabato`
  and `/people/seed-person-429`: the alignment, design, overflow and touch
  audits find nothing (54 of 54 page loads). `page-weight.js`,
  `phone-audit.mjs`, `interaction-audit.mjs` on the four touched routes and
  the perfume, film and painting journeys pass.
- After the review fixes, merged with main 2f696f56: every cover address
  on the dashboard's shelves (15 on that seed) is one the library's
  `/library?status=wanted,shortlisted` also uses. The audits in the three
  browsers on `/`, that View all, and both person pages find nothing (36 of
  36 page loads); page weight `/` 155 KB, `/people/seed-person-429`
  175 KB; `phone-audit.mjs` and `interaction-audit.mjs` pass.
- Typecheck clean. Lint: 0 errors, 75 warnings as on main 2f696f56.
  `pnpm deadcode` clean.
