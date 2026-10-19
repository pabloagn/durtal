# Task 0704: A well-used book's page, lighter and in three waves

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1163, from the book page survey (findings/book-page-survey-2026-10-18.md, items 1 and 3). The survey's heavy book (rare and poison, volume 3 of a long series, 12 editions, 16 copies, 40 quotes, 10 collections) had an 836 KB page against its 400 KB budget, and took 1.19 s at 200 ms a query. The series shelf had no limit, the page waited five rounds of queries, and `page-weight.js` only ever measured an ordinary book.

## Implementation Details

- **The series shelf is capped at 12**, the volumes nearest this one (`getOtherWorksInSeries` in `lib/actions/series.ts`). The window is a subquery of the card query: rank the series in reading order, then take the 12 closest places to this book, the earlier volume first on a tie. Near the start the later volumes fill it; at the end, the earlier ones. The shelf's title still links to the whole series.
- **Three waves instead of five** (`library/[slug]/page.tsx`). Each read that needs another starts when that one returns, not after the slowest read of its wave:
  - the creator, similar and mark shelves are picked, then load their cards (`relatedBookRows` / `relatedGroupsFrom`, `rankSimilarWorks` / `similarWorksFrom`, `markedWorkIds` / `markedWorkCards`, in `lib/catalogue/`; the server actions keep their signatures and call them);
  - the cards' e-book marks are read from the picks, beside the cards; the book's own e-books and their reach are read at once;
  - the reading estimates and the prediction start from the reading overview; the collection covers from the collections;
  - `getCollectionsForWork` reads its two memberships and the collections in one wave (the collections through subqueries).
- **Three creator and publishing shelves at most** (`relatedBookRows`, `RELATED_SHELVES` in `lib/catalogue/related-groups.ts`). The page made a shelf for every author, translator and publisher of every edition. Now only the first three shelves that have other books come back: authors first, then translators, then publishers, each in its usual order. A creator with no other books takes no place. Each person and publisher stays one click away from the book's header and Details.
- **Shelf cards are slimmer.** A cover's chip, its icon and its corner are one class each (`cover-chip`, `cover-chip-icon`, `cover-corner-*` in globals.css), the constants in `cover-chip.ts` naming them. The rare, poison and e-book marks draw from the icon sprite (`CoverMark`, `gem`, `skull`, `book-open`) instead of inline Lucide SVGs; the stroke (3 in the 24-unit box) moved from `COVER_CHIP_STROKE` to `cover-mark`. The cover letter's classes are the `cover-letter` utility, as in 0719 (SLN-939).
- **A fixture for the worst case.** `scripts/qa/seed-heavy-book.sql` (`preview-local.py --seed-heavy-book`) adds the survey's heavy book with a 30-volume series and full shelves, on the disposable preview only. `scripts/qa/page-weight-heavy.json` gives it the 400 KB / 1 s budget, run with `PAGE_WEIGHT_CONFIG`. The gated book rows skip it, since its 40 quotes would make it the most-quoted book.

## Completion Notes

- **Server time** (production build, survey seed on the scale seed, TTFB / total in ms, best of three):

  | Page | 40 ms before | 40 ms after | 200 ms before | 200 ms after | Waves |
  | -- | -- | -- | -- | -- | -- |
  | Heavy book | 375 | 268–344 | 1,152 | 748–758 | 5 to 3 |
  | Against Nature | 288 (survey) | 206–219 | 1,093 (survey) | 686–689 | 5 to 3 |
  | Another Survey Book 1 | 248 (survey) | 186–208 | 888 (survey) | 669–694 | |
  | Empty book | 228 (survey) | 184–196 | 876 (survey) | 661–680 | |

- **Weight:** the heavy book went from 854 KB to 782 KB on the survey's data; on the fixture it is 839 KB, so `page-weight-heavy.json` fails, as expected. Its 400 KB budget needs SLN-1132 (editions, about 204 KB) and SLN-1079 (notes, about 100 KB): with every shelf removed the page would still be about 570 KB. Against Nature 140 KB, the empty book 102 KB.
- **Shelf cap** (Linear sync, 18 Oct: every scale book page was over 1 s at 200 ms, and the related shelves had no cap). The fixture now gives the heavy book ten translators who each translated a sibling volume, plus three publishers, two of which published siblings. That makes thirteen shelves before the cap and three after. Measured on a production build with the fixture and `seed-scale-valid.sql`, best of three:

  | Page | Shelves before / after | Size before | Size after | 200 ms total |
  | -- | -- | -- | -- | -- |
  | Heavy book (fixture) | 12 / 3 | 902 KB | 858 KB | 734–752 ms |
  | Scale book 6 (author, translator, two publishers) | 4 / 3 | 404 KB | 357 KB | 692–694 ms |
  | Scale book 2250 (series, two publishers) | 3 / 3 | 467 KB | 467 KB | 710–723 ms |
  | Scale book 1 | 3 / 3 | 348 KB | 348 KB | 703–717 ms |

  On main, the scale recheck measured these pages at 1,109–1,130 ms at 200 ms. The three waves above bring them under 1 s, and the cap brings no further time change. The scale books with four or more shelves get lighter.
- **Same page:** the same sections and headings; the series shelf shows 12 volumes, not 20; e-book marks still show on shelf cards (The Cathedral, Doctor Faustus) and Read on Against Nature.
- **Cover marks** measured in Chromium, Firefox and WebKit: 20px chips with 12px icons at 1440 and 16px with 10px at 390, inset 8px and 4px, icons centred, stroke 3, tint 0.18 on the gem and skull, none on the e-book mark; film, perfume and painting chips unchanged.
- **Alignment audit:** 0 issues and no overflow on the heavy, ordinary and empty books, /library and /films, in three browsers at 1440, 390 and 320.
- **`page-weight.js`:** exit 0 with the heavy seed loaded.
- **Tests:** `pnpm test` passes. New `src/__tests__/catalogue/heavy-book-page.test.ts`; the series suite gains the nearest-12 window, with a volume at position "1-2" that sorts last and breaks nothing (`integration/series.test.ts`; the review of #534 found that the window's position test had lost its backslash), and the similar works suite the three-shelf cap, authors first, with shelves that have no other books taking no place (`integration/similar-works.test.ts`); the series, similar works, collections, collection media, poison, domain isolation and alphabetical works DB suites pass locally.
