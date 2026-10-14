# Task 0600: Loading screens for books, and skeletons that match their pages

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-697 and SLN-698, pieces A and B of the SLN-641 slice 3 audit (loading,
error, busy and empty states). The book page and the books list had no
loading screen: for as long as the server took, the old page stayed up with
nothing to say a tap was taken. The film skeleton drew its own guess at the
film header, so on a phone the poster jumped 79px and the title 78px when the
film arrived; the painting and publisher skeletons were off by 6 to 31px.

## Implementation Details

- **Shared pieces** (`src/components/shared/`):
  - `back-link.tsx`: `BackLink`, the "Back to …" link the detail pages and
    their loading screens draw alike. The book, film, painting and publisher
    pages use it in place of their own copy.
  - `skeleton.tsx`: `SkeletonBlock` (a picture, button or row of known size),
    `SkeletonLine` (one line box of a given type, `h-[1lh]`),
    `SkeletonTitleRow` (the title and its actions; on a phone the actions
    below it) and `SkeletonFacts` (the 24px fact rows, the rating's own row on
    a phone).
- **Books list**: the page moves to `library/(list)/page.tsx`, so its loading
  screen covers the list only, as `films/(list)` does. `library-header.tsx`
  holds the header (title, collection tabs, Identify editions, Add) and the
  wait (`LibraryPending`), drawn by both the page and
  `library/(list)/loading.tsx`, with the filters bar between them.
- **Book page**: `library/[slug]/loading.tsx` draws the page's own layout: the
  way back, the 176×256 cover box (`work-poster-box.ts`, shared with
  `WorkPosterImage`), the title row, author, marks, Start reading and badges,
  then the reading column and the record.
  - The layout now checks the book first (`bookRecordExists` in
    `record-exists.ts`), so a missing book still answers 404 under the loading
    screen (`not-found-status.test.ts` covers the library now).
  - A book with no poster used to have no cover in its header, so the
    loading screen's cover box would have collapsed when the book arrived.
    The header now shows the first edition's cover, and with no cover at all
    a 176×256 placeholder with the title's letter (`WorkPosterPlaceholder`,
    the card's `CoverPlaceholder`): every book keeps its cover's place.
- **Film, painting and publisher skeletons** are redrawn from their pages'
  layouts: the film poster at the left edge in `w-36 sm:w-44`, the painting
  in the shape a painting takes when its own is not known (`paintingRatio`,
  4:5) inside the page's `78vh` limit, the publisher's 160px logo tile.

## Completion Notes

Measured on a production build (disposable preview, `--seed-large 5`): from
each list a record's link was tapped with its page held 4 seconds; the
loading screen was read 1.2 s after the tap and again once the page arrived.

- A loading screen showed within 1.2 s on every navigation (book, film,
  painting, publisher, and films to books).
- Book page: way back, cover, title and the start of the reading column within
  0px of the page at 1440, 390 and 320 in Chromium, and at 390 in Firefox and
  WebKit.
- Film and publisher: way back, poster or logo tile and title within 0px at
  every width and engine.
- Painting: title and picture land exactly when the painting is 4:5; the seed
  painting is not, so its title is 26px lower at 390 (the picture's own
  height, which no loading screen can know).
- Below the title, rows that depend on the record (a film's writers and cast,
  a publisher name that wraps at 320) can move what follows; the rows every
  record has are drawn.
- Books list: title, tabs, actions and filters stay in place; the books
  follow.
- Browser audits (alignment, design, overflow, touch) on /library, a book, a
  film, a painting and a publisher: 45 of 45 loads clean in Chromium, Firefox
  and WebKit at 1440, 390 and 320. Page weight within budget.
